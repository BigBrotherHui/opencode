import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@/utils/toast"
import { batch, ErrorBoundary, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ExternalLink } from "@/components/external-link"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import {
  type FormState,
  type Modality,
  type ProviderConfigShape,
  MODALITIES,
  formFromProviderConfig,
  headerRow,
  modelRow,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

type Props = {
  onBack: () => void
  /** When present the form edits this existing provider instead of creating one. */
  initial?: {
    providerID: string
    config: ProviderConfigShape
  }
}

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

export function DialogCustomProvider(props: Props) {
  const language = useLanguage()

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      {/* Never let a render error leave the dialog body silently blank. */}
      <ErrorBoundary
        fallback={(error: unknown) => (
          <div class="flex flex-col gap-2 px-2.5 pb-3 text-12-regular text-text-base">
            <span class="text-14-medium text-text-strong">{language.t("provider.custom.error.render")}</span>
            <pre class="whitespace-pre-wrap break-words text-12-regular text-text-weak">
              {error instanceof Error ? error.stack || error.message : String(error)}
            </pre>
          </div>
        )}
      >
        <CustomProviderForm initial={props.initial} />
      </ErrorBoundary>
    </Dialog>
  )
}

export function CustomProviderForm(props: { autofocus?: boolean; initial?: Props["initial"] } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()

  const editingID = () => props.initial?.providerID
  const preset = () => (props.initial ? formFromProviderConfig(props.initial.config) : undefined)

  const [form, setForm] = createStore<FormState>({
    providerID: props.initial?.providerID ?? "",
    name: preset()?.name ?? "",
    baseURL: preset()?.baseURL ?? "",
    apiKey: "",
    models: preset()?.models ?? [modelRow()],
    headers: preset()?.headers ?? [headerRow()],
    err: {},
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const toggleModelFlag = (index: number, key: "reasoning" | "attachment" | "temperature" | "toolCall") => {
    setForm("models", index, key, (current) => !current)
  }

  const setModelLimit = (index: number, key: "contextLimit" | "outputLimit", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", "limit", undefined)
    })
  }

  const toggleModality = (index: number, modality: Modality) => {
    setForm("models", index, "inputModalities", (current) =>
      current.includes(modality) ? current.filter((item) => item !== modality) : [...current, modality],
    )
  }

  const toggleModelExpanded = (index: number) => {
    setForm("models", index, "expanded", (current) => !current)
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const existingProviderIDs = new Set(serverSync().data.provider.all.keys())
    // Editing an existing provider must not trip the "already connected" check on itself.
    const editing = editingID()
    if (editing) existingProviderIDs.delete(editing)
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs,
      preserve: props.initial?.config,
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      if ((await serverSDK().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync().updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      const editing = editingID()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(
          editing ? "provider.custom.edit.toast.saved.title" : "provider.connect.toast.connected.title",
          { provider: result.name },
        ),
        description: language.t(
          editing ? "provider.custom.edit.toast.saved.description" : "provider.connect.toast.connected.description",
          { provider: result.name },
        ),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">
          {language.t(editingID() ? "provider.custom.edit.title" : "provider.custom.title")}
        </div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {language.t("provider.custom.description.prefix")}
          <ExternalLink href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
            {language.t("provider.custom.description.link")}
          </ExternalLink>
          {language.t("provider.custom.description.suffix")}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={editingID() ? false : (props.autofocus ?? true)}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
            disabled={!!editingID()}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
          <TextField
            label={language.t("provider.custom.field.baseURL.label")}
            placeholder={language.t("provider.custom.field.baseURL.placeholder")}
            value={form.baseURL}
            onChange={(v) => setField("baseURL", v)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />
          <TextField
            label={language.t("provider.custom.field.apiKey.label")}
            placeholder={language.t("provider.custom.field.apiKey.placeholder")}
            description={language.t(
              editingID() ? "provider.custom.field.apiKey.keep" : "provider.custom.field.apiKey.description",
            )}
            value={form.apiKey}
            onChange={(v) => setField("apiKey", v)}
          />
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex flex-col gap-2" data-row={m.row}>
                <div class="flex gap-2 items-start">
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setModel(i(), "name", v)}
                      validationState={m.err.name ? "invalid" : undefined}
                      error={m.err.name}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="settings-gear"
                    variant="ghost"
                    class="mt-1.5"
                    active={m.expanded}
                    onClick={() => toggleModelExpanded(i())}
                    aria-label={language.t("command.category.settings")}
                    aria-expanded={m.expanded}
                  />
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
                <Show when={m.expanded}>
                  <div class="flex flex-col gap-4 pl-1 border-l border-border-weak pl-3">
                    <p class="text-12-regular text-text-weak">{language.t("provider.custom.models.settings.description")}</p>

                    <div class="flex flex-col gap-2">
                      <span class="text-12-medium text-text-weak">
                        {language.t("provider.custom.models.capabilities.label")}
                      </span>
                      <div class="flex flex-wrap gap-x-5 gap-y-2">
                        <For each={CAPABILITY_TOGGLES}>
                          {(toggle) => (
                            <Checkbox
                              checked={m[toggle.key]}
                              onChange={() => toggleModelFlag(i(), toggle.key)}
                            >
                              {language.t(toggle.label)}
                            </Checkbox>
                          )}
                        </For>
                      </div>
                    </div>

                    <div class="flex flex-col gap-2">
                      <span class="text-12-medium text-text-weak">
                        {language.t("provider.custom.models.modalities.label")}
                      </span>
                      <div class="flex flex-wrap gap-x-5 gap-y-2">
                        <For each={MODALITIES}>
                          {(modality) => (
                            <Checkbox
                              checked={m.inputModalities.includes(modality)}
                              onChange={() => toggleModality(i(), modality)}
                            >
                              {language.t(MODALITY_LABELS[modality])}
                            </Checkbox>
                          )}
                        </For>
                      </div>
                    </div>

                    <div class="flex flex-col gap-2">
                      <span class="text-12-medium text-text-weak">
                        {language.t("provider.custom.models.limit.label")}
                      </span>
                      <div class="flex gap-2 items-start">
                        <div class="flex-1">
                          <TextField
                            label={language.t("model.tooltip.context.label")}
                            hideLabel
                            placeholder="128k"
                            value={m.contextLimit}
                            onChange={(v) => setModelLimit(i(), "contextLimit", v)}
                            validationState={m.err.limit ? "invalid" : undefined}
                            error={m.err.limit}
                          />
                        </div>
                        <div class="flex-1">
                          <TextField
                            label={language.t("provider.custom.models.limit.output.label")}
                            hideLabel
                            placeholder="32k"
                            value={m.outputLimit}
                            onChange={(v) => setModelLimit(i(), "outputLimit", v)}
                          />
                        </div>
                      </div>
                      <p class="text-12-regular text-text-weak">{language.t("provider.custom.models.limit.description")}</p>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>

        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="primary"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending
            ? language.t("common.saving")
            : language.t(editingID() ? "common.save" : "common.submit")}
        </Button>
      </form>
    </div>
  )
}
