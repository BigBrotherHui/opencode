import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { batch } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"
import { CapabilityEditor } from "./capability-editor"
import {
  type Modality,
  type ModelRow,
  modelConfigEntry,
  modelRow,
  parseLimit,
} from "./dialog-custom-provider-form"

export type ModelEditorTarget = {
  providerID: string
  modelID: string
  /** Display name used in the dialog title. */
  modelName: string
}

type ExistingModel = {
  name?: string
  reasoning?: boolean
  attachment?: boolean
  temperature?: boolean
  tool_call?: boolean
  modalities?: { input?: string[] }
  limit?: { context?: number; output?: number }
}

function rowFromExisting(existing: ExistingModel | undefined, fallbackName: string): ModelRow {
  const base = modelRow()
  if (!existing) return { ...base, name: fallbackName, id: fallbackName }
  const input = existing.modalities?.input ?? ["text"]
  return {
    ...base,
    id: fallbackName,
    name: existing.name ?? fallbackName,
    reasoning: existing.reasoning === true,
    attachment: existing.attachment === true,
    temperature: existing.temperature === true,
    // Tool calling defaults to on for a custom provider, so an absent flag means on.
    toolCall: existing.tool_call !== false,
    inputModalities: input.filter((item): item is Modality => item !== "text") as Modality[],
    contextLimit: existing.limit?.context ? formatLimit(existing.limit.context) : "",
    outputLimit: existing.limit?.output ? formatLimit(existing.limit.output) : "",
  }
}

function formatLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) return ""
  if (value % 1_000_000 === 0) return `${value / 1_000_000}m`
  if (value % 1_000 === 0) return `${value / 1_000}k`
  return String(value)
}

/**
 * Edits the capability fields of one already-configured model. Custom providers
 * have no models.dev record, so context window, modalities and the rest can
 * only come from here.
 */
export function DialogEditModel(props: ModelEditorTarget & { onSaved?: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSync = useServerSync()

  const providerConfig = () => serverSync().data.config.provider?.[props.providerID]
  const existing = () => providerConfig()?.models?.[props.modelID] as ExistingModel | undefined

  const [form, setForm] = createStore<ModelRow>(rowFromExisting(existing(), props.modelName))
  // Only an explicit acknowledgement is allowed to leave the context window
  // unset, because the runtime reads it as "never compact".
  const [optOut, setOptOut] = createSignal(false)

  const toggleFlag = (key: "reasoning" | "attachment" | "temperature" | "toolCall") => {
    setForm(key, (current) => !current)
  }

  const toggleModality = (modality: Modality) => {
    setForm("inputModalities", (current) => {
      const next = [...current]
      const at = next.indexOf(modality)
      if (at === -1) next.push(modality)
      else next.splice(at, 1)
      return next
    })
  }

  const setLimit = (key: "contextLimit" | "outputLimit", value: string) => {
    batch(() => {
      setForm(key, value)
      setForm("err", "limit", undefined)
    })
  }

  const save = async () => {
    const name = form.name.trim() || props.modelID
    const context = parseLimit(form.contextLimit)
    const output = parseLimit(form.outputLimit)

    if (Number.isNaN(context) || Number.isNaN(output)) {
      setForm("err", "limit", language.t("provider.custom.error.limit.format"))
      return
    }
    if ((context === undefined) !== (output === undefined)) {
      setForm("err", "limit", language.t("provider.custom.error.limit.pair"))
      return
    }
    // An unset context window is not a safe default: the runtime treats
    // `limit.context === 0` as "never compact", which silently disables
    // overflow protection. Require it unless the user explicitly opts out.
    if (context === undefined && !optOut()) {
      setForm("err", "limit", language.t("dialog.model.edit.contextRequired"))
      return
    }

    // Rebuild from the row so capabilities that were turned off are removed
    // rather than left behind as stale `true` values from a previous save.
    const entry = modelConfigEntry(form, name)
    const models = { ...(providerConfig()?.models ?? {}) }
    models[props.modelID] = entry

    try {
      await serverSync().updateConfig({
        ...serverSync().data.config,
        provider: { ...serverSync().data.config.provider, [props.providerID]: { ...providerConfig(), models } },
      })
      dialog.close()
      props.onSaved?.()
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Dialog title={language.t("dialog.model.edit.title", { model: props.modelName })} transition>
      <div class="flex flex-col gap-6 px-2.5 pb-3 max-h-[70vh] overflow-y-auto">
        <p class="text-14-regular text-text-base px-2.5">{language.t("dialog.model.edit.description")}</p>
        <div class="px-2.5">
          <TextField
            label={language.t("provider.custom.models.name.label")}
            value={form.name}
            onChange={(v) => setForm("name", v)}
          />
        </div>
        <div class="px-2.5">
          <CapabilityEditor
            row={form}
            onToggleFlag={toggleFlag}
            onToggleModality={toggleModality}
            onLimitInput={setLimit}
          />
        </div>
        <div class="px-2.5">
          <Checkbox
            checked={optOut()}
            onChange={(checked) => {
              setOptOut(checked)
              if (checked) setForm("err", "limit", undefined)
            }}
          >
            {language.t("dialog.model.edit.noContext")}
          </Checkbox>
          <p class="mt-1 text-12-regular text-text-weak">{language.t("dialog.model.edit.noContext.description")}</p>
        </div>
        <div class="px-2.5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}