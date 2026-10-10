import { For, type Component } from "solid-js"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { MODALITIES, type Modality, type ModelRow } from "./dialog-custom-provider-form"

const CAPABILITY_TOGGLES = [
  { key: "reasoning", label: "model.tooltip.reasoning" },
  { key: "attachment", label: "provider.custom.models.capability.attachment" },
  { key: "temperature", label: "provider.custom.models.capability.temperature" },
  { key: "toolCall", label: "provider.custom.models.capability.toolCall" },
] as const

const MODALITY_LABELS: Record<Modality, string> = {
  image: "model.input.image",
  audio: "model.input.audio",
  video: "model.input.video",
  pdf: "model.input.pdf",
}

export type CapabilityEditorProps = {
  row: ModelRow
  onToggleFlag: (key: (typeof CAPABILITY_TOGGLES)[number]["key"]) => void
  onToggleModality: (modality: Modality) => void
  onLimitInput: (key: "contextLimit" | "outputLimit", value: string) => void
}

/**
 * The capability fields of one model, shared by the custom-provider creation
 * form and the per-model editor so both describe a model the same way.
 */
export const CapabilityEditor: Component<CapabilityEditorProps> = (props) => {
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weak">{language.t("provider.custom.models.capabilities.label")}</span>
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <For each={CAPABILITY_TOGGLES}>
            {(toggle) => (
              <Checkbox checked={props.row[toggle.key]} onChange={() => props.onToggleFlag(toggle.key)}>
                {language.t(toggle.label)}
              </Checkbox>
            )}
          </For>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weak">{language.t("provider.custom.models.modalities.label")}</span>
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <For each={MODALITIES}>
            {(modality) => (
              <Checkbox
                checked={props.row.inputModalities.includes(modality)}
                onChange={() => props.onToggleModality(modality)}
              >
                {language.t(MODALITY_LABELS[modality])}
              </Checkbox>
            )}
          </For>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-12-medium text-text-weak">{language.t("provider.custom.models.limit.label")}</span>
        <div class="flex gap-2 items-start">
          <div class="flex-1">
            <TextField
              label={language.t("model.tooltip.context.label")}
              hideLabel
              placeholder="128k"
              value={props.row.contextLimit}
              onChange={(v) => props.onLimitInput("contextLimit", v)}
              validationState={props.row.err.limit ? "invalid" : undefined}
              error={props.row.err.limit}
            />
          </div>
          <div class="flex-1">
            <TextField
              label={language.t("provider.custom.models.limit.output.label")}
              hideLabel
              placeholder="32k"
              value={props.row.outputLimit}
              onChange={(v) => props.onLimitInput("outputLimit", v)}
            />
          </div>
        </div>
        <p class="text-12-regular text-text-weak">{language.t("provider.custom.models.limit.description")}</p>
      </div>
    </div>
  )
}