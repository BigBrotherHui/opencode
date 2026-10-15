import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"

const emptyProviderCatalog: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }

type DirectoryCatalog = {
  ready: boolean
  providers: NormalizedProviderListResponse
}

type ProviderCatalogInput = {
  explicit?: boolean
  directory?: string
  catalog?: DirectoryCatalog
  global?: NormalizedProviderListResponse
}

// The directory's own catalog is authoritative once loaded. Until then the global one is
// used, including for explicit (directory-scoped) callers: the two are byte-identical
// unless the project configures providers itself, and the directory catalog is loaded
// lazily, so returning empty here would blank out model names and the model picker.
export function selectProviderCatalog(input: ProviderCatalogInput) {
  if (input.directory && input.catalog?.ready) return input.catalog.providers
  return input.global ?? emptyProviderCatalog
}

export function resolveDefaultModel(
  current: NormalizedProviderListResponse["defaultModel"],
  legacy: string | undefined,
) {
  if (current !== undefined) return current ?? undefined
  if (!legacy) return undefined
  const [providerID, modelID] = legacy.split("/")
  return { providerID, modelID }
}
