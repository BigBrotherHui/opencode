import { createMemo, createSignal, For, Show } from "solid-js"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { useLanguage } from "@/context/language"

export type DiscoverPickerProps = {
  providerName: string
  /** Model IDs the provider reported. Empty when discovery failed or was skipped. */
  ids: readonly string[]
  /** IDs already configured for this provider; they start checked. */
  selected: readonly string[]
  /** Why discovery returned nothing, shown above the manual entry. */
  unavailable?: string
  onCancel: () => void
  onConfirm: (ids: string[]) => void | Promise<void>
}

const splitIds = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

/**
 * Model picker for one provider. Reported models are listed with the configured
 * ones pre-checked, and a free-text field always accepts IDs by hand so a
 * provider whose `/v1/models` cannot be reached is still configurable.
 */
export function DiscoverModelPicker(props: DiscoverPickerProps) {
  const language = useLanguage()
  const [filter, setFilter] = createSignal("")
  const [chosen, setChosen] = createSignal<Set<string>>(new Set(props.selected))
  const [manual, setManual] = createSignal("")

  const visible = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return props.ids
    return props.ids.filter((id) => id.toLowerCase().includes(needle))
  })

  const toggle = (id: string, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allVisibleSelected = createMemo(() => {
    const list = visible()
    return list.length > 0 && list.every((id) => chosen().has(id))
  })

  const toggleAll = (on: boolean) => {
    setChosen((current) => {
      const next = new Set(current)
      for (const id of visible()) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const addManual = () => {
    const entries = splitIds(manual())
    if (!entries.length) return
    setChosen((current) => {
      const next = new Set(current)
      for (const id of entries) next.add(id)
      return next
    })
    setManual("")
  }

  // Typed IDs are part of the same selection, so confirming never drops them.
  const effective = createMemo(() => {
    const next = new Set(chosen())
    for (const id of splitIds(manual())) next.add(id)
    return [...next]
  })

  return (
    <DialogV2 size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("dialog.model.discover.title", { provider: props.providerName })}
          description={
            props.unavailable
              ? language.t("dialog.model.discover.manualOnly")
              : language.t("dialog.model.discover.description", { count: props.ids.length })
          }
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-3">
        <Show when={props.unavailable}>
          {(reason) => (
            <div class="rounded-md border border-border-weak-base px-3 py-2 text-12-regular text-text-weak">
              {reason()}
            </div>
          )}
        </Show>

        <Show when={props.ids.length > 0}>
          <TextInputV2
            type="search"
            appearance="base"
            class="!w-full"
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocomplete="off"
            autofocus
            aria-label={language.t("dialog.model.search.placeholder")}
          />
          <div class="flex items-center gap-2">
            <CheckboxV2
              checked={allVisibleSelected()}
              onChange={toggleAll}
              hideLabel
              label={language.t("dialog.model.discover.selectAll", { count: visible().length })}
            />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={visible().length > 0}
              fallback={<div class="text-13-regular text-text-weak">{language.t("dialog.model.discover.noMatch")}</div>}
            >
              <For each={visible()}>
                {(id) => (
                  <label class="flex cursor-pointer items-center gap-2 px-1 py-1.5 hover:bg-surface-raised-hover">
                    <CheckboxV2 checked={chosen().has(id)} onChange={(on) => toggle(id, on)} hideLabel label={id} />
                    <span class="truncate text-13-regular text-text-base">{id}</span>
                  </label>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">{language.t("dialog.model.discover.manual.label")}</span>
          <div class="flex items-center gap-2">
            <TextInputV2
              type="text"
              appearance="base"
              class="!w-full"
              value={manual()}
              onInput={(event) => setManual(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                addManual()
              }}
              placeholder={language.t("dialog.model.discover.manual.placeholder")}
              spellcheck={false}
              autocomplete="off"
              aria-label={language.t("dialog.model.discover.manual.label")}
            />
            <ButtonV2 variant="neutral" disabled={!manual().trim()} onClick={addManual}>
              {language.t("dialog.model.discover.manual.add")}
            </ButtonV2>
          </div>
          <span class="text-12-regular text-text-weak">{language.t("dialog.model.discover.manual.description")}</span>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={props.onCancel}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={() => void props.onConfirm(effective())}>
          {language.t("dialog.model.discover.confirm", { count: effective().length })}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}