import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect, Schema } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

interface Metadata {
  [key: string]: any
}

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

/**
 * Raised when the LLM calls a tool with arguments that fail the parameter
 * schema. This is the canonical "rewrite the input" tool error: the typed
 * error class makes it matchable upstream, and its `message` getter produces
 * the model-facing prose that the AI SDK feeds back as the tool result.
 */
export class InvalidArgumentsError extends Schema.TaggedErrorClass<InvalidArgumentsError>()(
  "ToolInvalidArgumentsError",
  {
    tool: Schema.String,
    detail: Schema.String,
  },
) {
  override get message() {
    return `The ${this.tool} tool was called with invalid arguments: ${this.detail}.\nPlease rewrite the input so it satisfies the expected schema.`
  }
}

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: SessionV1.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<PermissionV1.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[]
}

export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
export type DefWithoutID<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> = Omit<Def<Parameters, M>, "id">

export interface Info<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends Schema.Decoder<unknown>, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any>
    ? Schema.Schema.Type<P>
    : T extends Effect.Effect<Info<infer P, any>, any, any>
      ? Schema.Schema.Type<P>
      : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

/**
 * Keys some models use to wrap an entire tool argument object one level too
 * deep, e.g. `{"arguments": {"command": "ls"}}` or
 * `{"arguments": "{\"command\": \"ls\"}"}`.
 */
const WRAPPER_KEYS = new Set(["arguments", "arguments_json", "input", "args", "parameters"])

/**
 * Strip one redundant envelope layer around a tool call's arguments.
 *
 * Several models (notably the DeepSeek and GLM families, served through local
 * relays) emit the whole parameter object inside a single extra key instead of
 * emitting the object itself. The declared schema then rejects an otherwise
 * correct call with a misleading "Missing key at [\"command\"]".
 *
 * Unwrapping only happens when the envelope is unambiguous: the payload has
 * exactly one key, that key is a known wrapper name, and its value is either a
 * JSON object or a string containing one. Everything else is returned
 * untouched, so tools that legitimately take `{ input: "<freeform text>" }`
 * keep working.
 *
 * @param args Raw, untrusted arguments as produced by the model.
 * @returns The unwrapped object, or `args` unchanged when it is not an envelope.
 */
export function unwrapToolArguments(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args
  const entries = Object.entries(args as Record<string, unknown>)
  if (entries.length !== 1) return args
  const [key, value] = entries[0]!
  if (!WRAPPER_KEYS.has(key)) return args
  let inner: unknown = value
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner)
    } catch {
      return args
    }
  }
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return args
  if (Object.keys(inner as Record<string, unknown>).length === 0) return args
  return inner
}

/**
 * Lenient variant of {@link unwrapToolArguments}, used only as a last resort
 * after the raw payload already failed to decode: accepts a single-key envelope
 * whatever the key is named. A payload that is not an envelope is returned
 * unchanged, and a payload whose inner object still fails to decode simply
 * loses this extra attempt, so it cannot make a valid call invalid.
 *
 * @param args Raw, untrusted arguments as produced by the model.
 * @returns The unwrapped object, or `args` unchanged.
 */
function unwrapAnySingleKey(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args
  const entries = Object.entries(args as Record<string, unknown>)
  if (entries.length !== 1) return args
  let inner: unknown = entries[0]![1]
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner)
    } catch {
      return args
    }
  }
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return args
  if (Object.keys(inner as Record<string, unknown>).length === 0) return args
  return inner
}

/**
 * Append one line describing an unparseable tool call to a temp log.
 *
 * When a model keeps emitting a shape the schema rejects, the only way to fix
 * it is to see the exact payload, and the model-facing error deliberately
 * hides it. Never throws: diagnostics must not break the tool path.
 *
 * @param tool Tool id.
 * @param args Payload as received.
 * @param error The validation error raised for it.
 */
function logToolArgumentFailure(tool: string, args: unknown, error: unknown) {
  try {
    const detail = {
      tool,
      rawType: Array.isArray(args) ? "array" : typeof args,
      keys: args && typeof args === "object" ? Object.keys(args as object).slice(0, 8) : undefined,
      raw: JSON.stringify(args)?.slice(0, 800),
      error: String((error as { message?: string })?.message ?? error).slice(0, 400),
    }
    fs.appendFileSync(
      path.join(os.tmpdir(), "opencode-toolargs.log"),
      `${new Date().toISOString()} ${JSON.stringify(detail)}\n`,
    )
  } catch {
    // Diagnostics are best-effort.
  }
}

function wrap<Parameters extends Schema.Decoder<unknown>, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      const decode = Schema.decodeUnknownEffect(toolInfo.parameters)
      const execute = toolInfo.execute
      const attempt = (input: unknown) =>
        decode(input).pipe(
          Effect.mapError(
            (error) =>
              new InvalidArgumentsError({
                tool: id,
                detail: toolInfo.formatValidationError ? toolInfo.formatValidationError(error) : String(error),
              }),
          ),
        )
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        // Ordered candidates: the payload as the model sent it, then progressively
        // unwrapped variants. The first one that satisfies the schema wins, so a
        // valid raw call behaves exactly as before.
        const candidates: unknown[] = []
        for (const candidate of [args, unwrapToolArguments(args), unwrapAnySingleKey(args)]) {
          if (!candidates.some((seen) => seen === candidate)) candidates.push(candidate)
        }
        const tryAt = (index: number, first?: InvalidArgumentsError): Effect.Effect<any, InvalidArgumentsError> =>
          attempt(candidates[index]!).pipe(
            Effect.catch((error) =>
              index + 1 < candidates.length
                ? tryAt(index + 1, first ?? error)
                : Effect.fail(first ?? error),
            ),
          )
        return Effect.gen(function* () {
          // Report the error from the raw payload, never a synthetic one: that is
          // the text the model has to reason about when it rewrites the call.
          const decoded = yield* tryAt(0).pipe(
            Effect.catch((error) => {
              logToolArgumentFailure(id, args, error)
              return Effect.fail(error)
            }),
          )
          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(result.output, {}, agent)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      return toolInfo
    })
}

export function define<
  Parameters extends Schema.Decoder<unknown>,
  Result extends Metadata,
  R,
  ID extends string = string,
>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function init<P extends Schema.Decoder<unknown>, M extends Metadata>(
  info: Info<P, M>,
): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}

export * as Tool from "./tool"
