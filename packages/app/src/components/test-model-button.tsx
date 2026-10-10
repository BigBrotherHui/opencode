import { createSignal, Show, type Component } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

type TestResult =
  | { ok: true; firstTokenMs: number; totalMs: number; inputTokens?: number; outputTokens?: number; text: string }
  | { ok: false; kind: string; message?: string }

function errorText(language: ReturnType<typeof useLanguage>, kind: string, message?: string) {
  switch (kind) {
    case "modelNotFound":
      return language.t("dialog.model.test.error.modelNotFound")
    case "unauthorized":
      return language.t("dialog.model.test.error.unauthorized")
    case "timeout":
      return language.t("dialog.model.test.error.timeout")
    case "rateLimited":
      return language.t("dialog.model.test.error.rateLimited")
    default:
      return message || language.t("dialog.model.test.error.failed")
  }
}

/**
 * Sends one short prompt through the server so the result reflects the same
 * credential wiring and transport a real chat turn would use. Latency comes
 * from a single request, so it is indicative rather than a benchmark.
 */
export const TestModelButton: Component<{
  providerID: string
  modelID: string
  modelName: string
  class?: string
}> = (props) => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [busy, setBusy] = createSignal(false)

  const run = async () => {
    if (busy()) return
    setBusy(true)
    try {
      const response = await serverSDK().client.provider.test({
        testModelPayload: { providerID: props.providerID, modelID: props.modelID },
      })
      if (response.error) throw response.error
      const result = response.data as TestResult | undefined
      if (!result) {
        showToast({ title: language.t("dialog.model.test.failed", { model: props.modelName }) })
        return
      }
      if (!result.ok) {
        showToast({
          title: language.t("dialog.model.test.failed", { model: props.modelName }),
          description: errorText(language, result.kind, result.message),
        })
        return
      }
      const tokens =
        typeof result.outputTokens === "number"
          ? language.t("dialog.model.test.tokens", { count: result.outputTokens })
          : undefined
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.model.test.passed", { model: props.modelName }),
        description: [
          language.t("dialog.model.test.latency", { ms: Math.round(result.totalMs) }),
          tokens,
          result.text ? `“${result.text}”` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      })
    } catch (error) {
      showToast({
        title: language.t("dialog.model.test.failed", { model: props.modelName }),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <IconButtonV2
      type="button"
      variant="ghost-muted"
      size="small"
      class={props.class}
      disabled={busy()}
      onClick={() => void run()}
      icon={<IconV2 name={busy() ? "status" : "check"} class="text-v2-icon-icon-muted" />}
      aria-label={language.t("dialog.model.test.action", { model: props.modelName })}
    />
  )
}