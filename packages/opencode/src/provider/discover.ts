export * as ProviderDiscover from "./discover"

import { Schema } from "effect"

const DEFAULT_TIMEOUT = 10_000
// A `/v1/models` payload is a small JSON list. Anything larger is not a model
// list, and reading it whole would let a hostile endpoint exhaust memory.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export class DiscoverError extends Schema.TaggedErrorClass<DiscoverError>()("ProviderDiscoverError", {
  kind: Schema.Literals([
    "invalidUrl",
    "blocked",
    "noCredential",
    "unauthorized",
    "invalidFormat",
    "timeout",
    "tooLarge",
    "failed",
  ]),
  message: Schema.optional(Schema.String),
}) {}

export type DiscoverInput = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

// Cloud instance-metadata endpoints hand out credentials to anything that can
// reach them. Loopback and LAN stay allowed on purpose: Ollama, LM Studio and
// similar local runtimes are the main reason to discover models at all.
const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
])

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase()
  return BLOCKED_HOSTNAMES.has(host) || host.endsWith(".metadata.google.internal")
}

/**
 * Resolve the `/models` endpoint for a base URL. Configured base URLs already
 * carry a version segment (`https://host/v1`), so appending `/v1/models`
 * absolutely would drop that prefix; append `models` relative instead.
 */
export function resolveModelsUrl(baseURL: string) {
  const trimmed = baseURL.trim()
  if (!/^https?:\/\//i.test(trimmed)) throw new DiscoverError({ kind: "invalidUrl" })
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new DiscoverError({ kind: "invalidUrl" })
  }
  if (isBlockedHost(url.hostname)) throw new DiscoverError({ kind: "blocked" })

  const hasVersionPath = /\/v\d+($|\/)/.test(url.pathname)
  if (!hasVersionPath) return new URL("/v1/models", url)
  // A relative resolution against a path without a trailing slash treats the
  // last segment as a filename, which would turn `/v1` into `/models`.
  const base = url.pathname.endsWith("/") ? url : new URL(url.href + "/")
  return new URL("models", base)
}

function resolveApiKey(apiKey: string | undefined, headers: Record<string, string>) {
  const value = apiKey?.trim()
  if (!value) return
  // `{env:NAME}` indirection keeps the secret out of the config file. An
  // unresolvable reference is reported rather than silently dropped, otherwise
  // the request goes out unauthenticated and reads as a 401 from the provider.
  const envMatch = value.match(/^\{env:([^}]+)\}$/)
  if (envMatch) {
    const resolved = process.env[envMatch[1] ?? ""]
    if (!resolved) throw new DiscoverError({ kind: "noCredential", message: envMatch[1] })
    if (!headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${resolved}`
    return
  }
  if (!headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${value}`
}

/**
 * Hosts that plausibly serve models without a credential. A remote endpoint
 * that is sent no key would answer 401, which reads as "bad key" when the real
 * cause is that none was ever configured for the provider.
 */
function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host.startsWith("127.")) return true
  if (host.startsWith("192.168.") || host.startsWith("10.")) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

export async function discoverOpenAICompatibleModels(input: DiscoverInput): Promise<string[]> {
  const url = resolveModelsUrl(input.baseURL)

  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  const hasAuthHeader = Boolean(headers.Authorization || headers.authorization)
  resolveApiKey(input.apiKey, headers)
  // A remote endpoint sent no credential answers 401, which reads as "bad key"
  // when nothing was configured for this provider at all. Local runtimes are
  // expected to be unauthenticated, so they are exempt.
  if (!hasAuthHeader && !headers.Authorization && !isLocalHost(url.hostname)) {
    throw new DiscoverError({ kind: "noCredential" })
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new DiscoverError({ kind: "timeout" })
    }
    throw new DiscoverError({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
  }

  if (response.status === 401 || response.status === 403) throw new DiscoverError({ kind: "unauthorized" })
  if (!response.ok) throw new DiscoverError({ kind: "failed", message: `status ${response.status}` })

  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new DiscoverError({ kind: "tooLarge" })

  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) throw new DiscoverError({ kind: "tooLarge" })

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new DiscoverError({ kind: "invalidFormat" })
  }

  if (!isModelList(json)) throw new DiscoverError({ kind: "invalidFormat" })
  return [...new Set(json.data.map((item) => item.id.trim()).filter(Boolean))].sort()
}

function isModelList(value: unknown): value is { data: { id: string }[] } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false
  const data = (value as { data: unknown }).data
  if (!Array.isArray(data)) return false
  return (
    data.length > 0 &&
    data.every(
      (item) =>
        typeof item === "object" && item !== null && "id" in item && typeof (item as { id: unknown }).id === "string",
    )
  )
}