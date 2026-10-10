import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import type { DiscoverModelsError } from "@opencode-ai/sdk/v2"

const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

export type DiscoverableProvider = {
  providerID: string
  baseURL: string
  apiKey?: string
}

/**
 * Providers whose model set can be re-read from the endpoint itself. Anything
 * else (official providers, MCP-backed entries) has no list to fetch.
 */
export function discoverableProviders(config: {
  provider?: Record<string, { npm?: string; options?: Record<string, unknown> } | undefined>
}): DiscoverableProvider[] {
  const entries = config.provider ?? {}
  return Object.entries(entries)
    .filter(([, value]) => value?.npm === OPENAI_COMPATIBLE)
    .flatMap(([providerID, value]) => {
      const baseURL = value?.options?.baseURL
      if (typeof baseURL !== "string" || !baseURL.trim()) return []
      const apiKey = value?.options?.apiKey
      return [{ providerID, baseURL: baseURL.trim(), ...(typeof apiKey === "string" ? { apiKey } : {}) }]
    })
}

export function discoverErrorMessage(language: ReturnType<typeof useLanguage>, error: DiscoverModelsError) {
  switch (error.kind) {
    case "invalidUrl":
      return language.t("dialog.model.discover.error.invalidUrl")
    case "blocked":
      return language.t("dialog.model.discover.error.blocked")
    case "noCredential":
      return language.t("dialog.model.discover.error.noCredential")
    case "unauthorized":
      return language.t("dialog.model.discover.error.unauthorized")
    case "invalidFormat":
      return language.t("dialog.model.discover.error.invalidFormat")
    case "timeout":
      return language.t("dialog.model.discover.error.timeout")
    case "tooLarge":
      return language.t("dialog.model.discover.error.tooLarge")
    default:
      return error.message || language.t("dialog.model.discover.error.failed")
  }
}

export function useModelDiscovery() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [pending, setPending] = createSignal<string[]>([])

  const config = () => serverSync().data.config

  const discoverable = () => discoverableProviders(config())

  const isPending = (providerID: string) => pending().includes(providerID)

  /**
   * Fetch the provider's model list. Resolves with the error rather than
   * throwing so callers can still offer manual entry when discovery fails.
   */
  const discover = async (
    target: DiscoverableProvider,
  ): Promise<{ ids?: string[]; error?: DiscoverModelsError }> => {
    setPending((current) => [...current, target.providerID])
    try {
      const result = await serverSDK().client.provider.discover({
        discoverModelsPayload: {
          // The server resolves the credential and the base URL from its own
          // config by provider ID; nothing here carries a secret.
          providerID: target.providerID,
          baseURL: target.baseURL,
          ...(target.apiKey ? { apiKey: target.apiKey } : {}),
        },
      })
      if (result.error) throw result.error
      const data = result.data
      if (!data) return { error: { ok: false, kind: "failed" } }
      if (!data.ok) return { error: data }
      return { ids: data.ids }
    } catch (error) {
      return {
        error: {
          ok: false,
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    } finally {
      setPending((current) => current.filter((id) => id !== target.providerID))
    }
  }

  const providerConfig = (providerID: string) => config().provider?.[providerID]

  /** Merge newly picked IDs into the provider's configured model map. */
  const addModels = async (providerID: string, ids: readonly string[]) => {
    const existing = providerConfig(providerID)
    const models = { ...(existing?.models ?? {}) }
    for (const id of ids) if (!models[id]) models[id] = { name: id }
    await serverSync().updateConfig({
      ...config(),
      provider: { ...config().provider, [providerID]: { ...existing, models } },
    })
  }

  return { discover, addModels, providerConfig, discoverable, isPending }
}