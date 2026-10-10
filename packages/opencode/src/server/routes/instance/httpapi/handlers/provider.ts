import { Provider, ModelNotFoundError } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Auth } from "@/auth"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError, DiscoverModelsPayload, DiscoverModelsResult, TestModelPayload, TestModelResult } from "../groups/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderDiscover } from "@/provider/discover"
import { generateText } from "ai"

const decodeDiscoverResult = Schema.decodeSync(DiscoverModelsResult)
const decodeTestResult = Schema.decodeSync(TestModelResult)

const PROBE_PROMPT = "Reply with the single word: ok"
const PROBE_TIMEOUT_MS = 60_000
const PROBE_TEXT_LIMIT = 500

/** Turn a provider/SDK failure into a class the UI can act on. */
function classifyProbeError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/abort|timeout|timed out/i.test(text)) return "timeout" as const
  if (/401|403|unauthor|invalid.?api.?key|forbidden/i.test(text)) return "unauthorized" as const
  if (/429|rate.?limit|too many requests/i.test(text)) return "rateLimited" as const
  return "failed" as const
}

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const credentials = yield* authStore.all().pipe(Effect.orDie)
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    // The server performs the probe so browser CORS does not apply. Failures are
    // reported as data rather than thrown, so a dead endpoint cannot look like a
    // server fault and the UI can explain what went wrong.
    const discover = Effect.fn("ProviderHttpApi.discover")(function* (ctx: { payload: typeof DiscoverModelsPayload.Type }) {
      // Credentials the provider actually uses live in the auth store keyed by
      // provider ID, not in `provider.*.options.apiKey`. Resolving both the URL
      // and the credential from the server's own config keeps a stored secret
      // bound to the host it was configured for; a caller-supplied base URL is
      // only honored when no stored credential is involved.
      const config = yield* cfg.get()
      const configured = ctx.payload.providerID ? config.provider?.[ctx.payload.providerID] : undefined
      const configuredBaseURL = configured?.options?.baseURL
      // A stored credential is only ever sent to the provider's own configured
      // host. Without one, the caller's URL and key are used together, so a
      // secret can never be paired with an attacker-chosen endpoint.
      const storedBaseURL =
        typeof configuredBaseURL === "string" && configuredBaseURL.trim() ? configuredBaseURL.trim() : undefined
      const baseURL = storedBaseURL ?? ctx.payload.baseURL

      const stored = storedBaseURL && ctx.payload.providerID ? yield* authStore.get(ctx.payload.providerID).pipe(Effect.orDie) : undefined
      const storedKey = stored?.type === "api" ? stored.key : undefined

      /**
       * Several providers can share one upstream account and therefore one
       * credential (for example `dli`, `dli-gpt` and `dli_deepseek` all point at
       * the same host). Reuse the exact-ID credential first; otherwise borrow a
       * credential from another provider that targets the same base URL, but
       * only when the reference is unambiguous.
       */
      const sharedKey = yield* Effect.gen(function* () {
        if (storedKey || !storedBaseURL) return undefined
        const all = yield* authStore.all().pipe(Effect.orDie)
        const candidates: string[] = []
        for (const [id, info] of Object.entries(all)) {
          if (info.type !== "api") continue
          const other = config.provider?.[id]?.options?.baseURL
          if (typeof other !== "string" || other.trim() !== storedBaseURL) continue
          candidates.push(info.key)
        }
        const unique = [...new Set(candidates)]
        return unique.length === 1 ? unique[0] : undefined
      })

      const apiKey = storedKey ?? sharedKey ?? ctx.payload.apiKey

      const outcome = yield* Effect.promise(async () => {
        try {
          const ids = await ProviderDiscover.discoverOpenAICompatibleModels({
            baseURL,
            ...(apiKey ? { apiKey } : {}),
            ...(ctx.payload.headers ? { headers: ctx.payload.headers } : {}),
            ...(typeof ctx.payload.timeoutMs === "number" ? { timeoutMs: ctx.payload.timeoutMs } : {}),
          })
          return { ok: true as const, ids }
        } catch (error) {
          if (error instanceof ProviderDiscover.DiscoverError) {
            return error.message
              ? { ok: false as const, kind: error.kind, message: error.message }
              : { ok: false as const, kind: error.kind }
          }
          return { ok: false as const, kind: "failed" as const }
        }
      })
      return decodeDiscoverResult(outcome)
    })

    // Sends one short prompt through the same resolved model the chat path would
    // use, so the probe reflects real latency and real credential wiring rather
    // than a separate HTTP call that could succeed or fail differently.
    const test = Effect.fn("ProviderHttpApi.test")(function* (ctx: { payload: typeof TestModelPayload.Type }) {
      const started = Date.now()
      const providerID = ProviderV2.ID.make(ctx.payload.providerID)
      const modelID = ModelV2.ID.make(ctx.payload.modelID)

      // Everything below resolves through the provider service so instance
      // scope, credentials and per-provider loaders behave exactly as they do
      // for a real chat turn. Failures are reported as data, so a dead endpoint
      // never looks like a server fault.
      const probe = Effect.gen(function* () {
        const model = yield* provider.getModel(providerID, modelID)
        const language = yield* provider.getLanguage(model)
        const result = yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: language,
              prompt: ctx.payload.prompt?.trim() || PROBE_PROMPT,
              maxOutputTokens: 64,
              abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            }),
          catch: (error) => error,
        })
        const usage = result.usage
        return {
          ok: true as const,
          firstTokenMs: Date.now() - started,
          totalMs: Date.now() - started,
          ...(typeof usage?.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage?.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
          text: (result.text ?? "").trim().slice(0, PROBE_TEXT_LIMIT),
          ...(result.finishReason ? { finishReason: String(result.finishReason) } : {}),
        }
      })

      const outcome = yield* probe.pipe(
        Effect.catch((error) =>
          Effect.succeed(
            error instanceof ModelNotFoundError
              ? { ok: false as const, kind: "modelNotFound" as const }
              : {
                  ok: false as const,
                  kind: classifyProbeError(error),
                  message: error instanceof Error ? error.message : String(error),
                },
          ),
        ),
      )

      return decodeTestResult(outcome)
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
      .handle("discover", discover)
      .handle("test", test)
  }),
)
