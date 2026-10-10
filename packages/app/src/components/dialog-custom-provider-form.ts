const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type Modality = "image" | "audio" | "video" | "pdf"

export const MODALITIES: readonly Modality[] = ["image", "audio", "video", "pdf"]

export type ModelErr = {
  id?: string
  name?: string
  limit?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  temperature: boolean
  toolCall: boolean
  inputModalities: Modality[]
  contextLimit: string
  outputLimit: string
  expanded: boolean
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

const LIMIT_UNITS: Record<string, number> = { k: 1_000, m: 1_000_000 }

/**
 * Parse a token limit written as a plain number, optionally with a `k`/`m`
 * suffix (`128k`, `2M`). Returns `undefined` for an empty field and `NaN` when
 * the text is present but not a positive number, so callers can tell "not set"
 * apart from "invalid".
 */
export function parseLimit(raw: string) {
  const text = raw.trim().toLowerCase().replace(/[,_]/g, "").replace(/\s+/g, "")
  if (!text) return undefined
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(text)
  if (!match) return Number.NaN
  const value = Number(match[1]) * (match[2] ? LIMIT_UNITS[match[2]] : 1)
  return value > 0 ? value : Number.NaN
}

/**
 * Build one `provider.models.<id>` entry. Fields are only emitted when they
 * differ from the runtime defaults applied to a custom provider with no
 * models.dev record, so untouched rows stay as small as before.
 */
export function modelConfigEntry(row: ModelRow, name: string) {
  const entry: Record<string, unknown> = { name }

  if (row.reasoning) entry.reasoning = true
  if (row.attachment) entry.attachment = true
  if (row.temperature) entry.temperature = true
  // Tool calling defaults to true for custom providers, so only the opt-out is written.
  if (!row.toolCall) entry.tool_call = false

  const modalities = ["text", ...row.inputModalities].sort()
  if (modalities.length > 1) entry.modalities = { input: modalities }

  const context = parseLimit(row.contextLimit)
  const output = parseLimit(row.outputLimit)
  if (context !== undefined && output !== undefined && !Number.isNaN(context) && !Number.isNaN(output)) {
    entry.limit = { context, output }
  }

  return entry
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined

    // The config schema requires both `limit.context` and `limit.output`, so a
    // half-filled pair has to be rejected rather than silently defaulted.
    const context = parseLimit(m.contextLimit)
    const output = parseLimit(m.outputLimit)
    const limitError =
      Number.isNaN(context) || Number.isNaN(output)
        ? input.t("provider.custom.error.limit.format")
        : (context === undefined) !== (output === undefined)
          ? input.t("provider.custom.error.limit.pair")
          : undefined

    return { id: idError, name: nameError, limit: limitError }
  })
  const modelsValid = models.every((m) => !m.id && !m.name && !m.limit)
  const modelConfig = Object.fromEntries(
    input.form.models
      .filter((m) => m.id.trim())
      .map((m) => [m.id.trim(), modelConfigEntry(m, m.name.trim())]),
  )

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  reasoning: false,
  attachment: false,
  temperature: false,
  toolCall: true,
  inputModalities: [],
  contextLimit: "",
  outputLimit: "",
  expanded: false,
  err: {},
})
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })