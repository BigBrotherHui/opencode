type Capabilities = {
  reasoning?: boolean
  attachment?: boolean
  toolcall?: boolean
  input?: { text?: boolean; image?: boolean; audio?: boolean; video?: boolean; pdf?: boolean }
  output?: { text?: boolean; image?: boolean; audio?: boolean; video?: boolean; pdf?: boolean }
}

export type SummaryModel = {
  capabilities?: Capabilities
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number }
}

const MODALITY_ORDER = ["image", "audio", "video", "pdf"] as const

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(0))}k`
  return String(value)
}

/**
 * Compact "what is this model" line for the settings list: the facts that are
 * invisible otherwise (input modalities, context window, cost) since neither
 * `/v1/models` nor a hand-typed config entry necessarily states them.
 */
export function formatModelSummary(model: SummaryModel): string[] {
  const out: string[] = []
  const input = model.capabilities?.input
  if (model.capabilities) {
    const modalities = MODALITY_ORDER.filter((name) => input?.[name])
    out.push(modalities.length ? `text + ${modalities.join(", ")}` : "text")
  }

  const context = formatCount(model.limit?.context ?? 0)
  if (context) out.push(`${context} ctx`)

  const output = formatCount(model.limit?.output ?? 0)
  if (output && model.limit?.output !== model.limit?.context) out.push(`${output} out`)

  if (model.capabilities?.reasoning) out.push("reasoning")
  if (model.capabilities?.toolcall === false) out.push("no tools")

  const costIn = model.cost?.input ?? 0
  const costOut = model.cost?.output ?? 0
  if (costIn > 0 || costOut > 0) out.push(`$${costIn}/$${costOut} per Mtok`)

  return out
}