import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ProviderV2 } from "@opencode-ai/core/provider"

const root = "/provider"

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])
export class ProviderAuthApiError extends Schema.ErrorClass<ProviderAuthApiError>("ProviderAuthError")(
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(ProviderV2.ID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

const DiscoverModelsErrorKind = Schema.Union([
  Schema.Literal("invalidUrl"),
  Schema.Literal("blocked"),
  Schema.Literal("noCredential"),
  Schema.Literal("unauthorized"),
  Schema.Literal("invalidFormat"),
  Schema.Literal("timeout"),
  Schema.Literal("tooLarge"),
  Schema.Literal("failed"),
])

export const DiscoverModelsPayload = Schema.Struct({
  providerID: Schema.optionalKey(Schema.String),
  baseURL: Schema.String,
  apiKey: Schema.optionalKey(Schema.String),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  timeoutMs: Schema.optionalKey(Schema.NumberFromString),
}).annotate({ identifier: "DiscoverModelsPayload" })

export const DiscoverModelsResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    ids: Schema.mutable(Schema.Array(Schema.String)),
  }).annotate({ identifier: "DiscoverModelsOk" }),
  Schema.Struct({
    ok: Schema.Literal(false),
    kind: DiscoverModelsErrorKind,
    message: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "DiscoverModelsError" }),
]).annotate({ identifier: "DiscoverModelsResult" })

export const TestModelPayload = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  prompt: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "TestModelPayload" })

const TestModelErrorKind = Schema.Union([
  Schema.Literal("modelNotFound"),
  Schema.Literal("unauthorized"),
  Schema.Literal("timeout"),
  Schema.Literal("rateLimited"),
  Schema.Literal("failed"),
])

export const TestModelResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    /** Milliseconds from request start to the first streamed token. */
    firstTokenMs: Schema.Finite,
    /** Milliseconds to the end of the streamed response. */
    totalMs: Schema.Finite,
    /** Tokens reported by the provider, when it reports usage at all. */
    inputTokens: Schema.optionalKey(Schema.Finite),
    outputTokens: Schema.optionalKey(Schema.Finite),
    /** Model text, trimmed for display. */
    text: Schema.String,
    finishReason: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "TestModelOk" }),
  Schema.Struct({
    ok: Schema.Literal(false),
    kind: TestModelErrorKind,
    message: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "TestModelError" }),
]).annotate({ identifier: "TestModelResult" })

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          query: WorkspaceRoutingQuery,
          success: described(ProviderAuth.Methods, "Provider auth methods"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
        HttpApiEndpoint.post("discover", `${root}/discover`, {
          query: WorkspaceRoutingQuery,
          payload: DiscoverModelsPayload,
          success: described(DiscoverModelsResult, "Discovered model IDs or error"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.discover",
            summary: "Discover models from an OpenAI-compatible base URL",
            description:
              "Probe an OpenAI-compatible endpoint at `{baseURL}/v1/models` and return the list of model IDs. " +
              "Resolves env-var API keys on the server and bypasses browser CORS. Loopback and LAN hosts stay " +
              "reachable so local runtimes can be discovered; cloud instance-metadata endpoints are blocked. " +
              "Requires the same authorization as config writes.",
          }),
        ),
        HttpApiEndpoint.post("test", `${root}/test`, {
          query: WorkspaceRoutingQuery,
          payload: TestModelPayload,
          success: described(TestModelResult, "Model connectivity and latency result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.test",
            summary: "Send a probe request to one model",
            description:
              "Send a single short prompt to a configured model and report time to first token, total time, " +
              "token usage, and the reply text. A failed probe is returned as data with a classified reason so " +
              "the UI can distinguish a bad credential from an unreachable endpoint.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Experimental HttpApi provider routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
