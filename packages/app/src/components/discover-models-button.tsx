import { Show, type Component } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { DiscoverModelPicker } from "./dialog-discover-models"
import { useModelDiscovery, discoverErrorMessage } from "./model-discovery"

/**
 * "Fetch available models" affordance for a custom provider row. Renders
 * nothing unless the provider is in the config as an OpenAI-compatible entry
 * with a base URL, which is the only case where there is a list to fetch.
 *
 * Discovery is best-effort: when it fails the picker still opens with the
 * failure reason and a manual ID field, so a provider is never unreachable
 * just because its `/v1/models` endpoint is not.
 */
export const DiscoverModelsButton: Component<{
  providerID: string
  providerName: string
  class?: string
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const discovery = useModelDiscovery()

  const supported = () => discovery.discoverable().some((item) => item.providerID === props.providerID)

  const openPicker = (ids: readonly string[], unavailable?: string) => {
    const existing = Object.keys(discovery.providerConfig(props.providerID)?.models ?? {})
    // Layered over the settings dialog rather than replacing it, so confirming
    // or cancelling returns to the provider list the user came from.
    void dialog.push(() => (
      <DiscoverModelPicker
        providerName={props.providerName}
        ids={ids}
        selected={existing}
        unavailable={unavailable}
        onCancel={() => dialog.close()}
        onConfirm={async (picked) => {
          dialog.close()
          if (!picked.length) return
          await discovery.addModels(props.providerID, picked)
        }}
      />
    ))
  }

  const run = () => {
    const target = discovery.discoverable().find((item) => item.providerID === props.providerID)
    if (!target) return
    // The probe is bounded by the server's own timeout, so wait for the result
    // and open the picker once: opening first and reopening would flash.
    void discovery.discover(target).then((result) => {
      if (result.ids) {
        openPicker(result.ids)
        return
      }
      const reason = result.error
        ? discoverErrorMessage(language, result.error)
        : language.t("dialog.model.discover.error.failed")
      openPicker([], reason)
    })
  }

  return (
    <Show when={supported()}>
      <ButtonV2
        variant="ghost-muted"
        size="small"
        class={props.class}
        disabled={discovery.isPending(props.providerID)}
        onClick={run}
      >
        {language.t("dialog.model.discover.action")}
      </ButtonV2>
    </Show>
  )
}