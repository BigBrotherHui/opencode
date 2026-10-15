import { For, Show, createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

export type RailMessage = {
  id: string
  text: string
  time: string
}

export function MessageRail(props: {
  messages: Accessor<RailMessage[]>
  activeID: Accessor<string | undefined>
  onJump: (id: string) => void
  onJumpLatest: () => void
}) {
  const language = useLanguage()
  const hoverCapable = createMediaQuery("(hover: hover)")
  const [hovering, setHovering] = createSignal(false)
  const [pinned, setPinned] = createSignal(false)
  const [scrub, setScrub] = createSignal<string | undefined>()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const open = () => pinned() || (hoverCapable() && hovering())
  const current = () => scrub() ?? props.activeID()
  let inner: HTMLDivElement | undefined
  let column: HTMLDivElement | undefined
  let listEl: HTMLDivElement | undefined

  const close = () => {
    setPinned(false)
    setHovering(false)
    setScrub(undefined)
  }

  // The rail remounts on session switch with the pointer already resting on it, so no
  // `mouseenter` fires. A `:hover` probe cannot work either: the outer rail is
  // `pointer-events: none`, which never matches `:hover`. Track the pointer globally
  // and, whenever the rail content (re)appears, test whether it is inside the bars.
  let pointer: { x: number; y: number } | undefined
  onMount(() => {
    const track = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
    }
    document.addEventListener("pointermove", track, { passive: true })
    onCleanup(() => document.removeEventListener("pointermove", track))
  })

  createEffect(() => {
    if (!hoverCapable()) return
    if (props.messages().length === 0) return
    if (!root()) return
    const el = inner
    const at = pointer
    if (!el || !at) return
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom) setHovering(true)
    })
  })

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (event: MouseEvent) => {
      const el = root()
      if (el && event.target instanceof Node && el.contains(event.target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  createEffect(() => {
    const id = scrub()
    if (!id || !listEl) return
    listEl.querySelector<HTMLElement>(`[data-rail-item="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })
  })

  let suppressClick = false
  let dragging = false
  let scrubStarted = false
  let pressY = 0

  // Touch has no hover: a tap opens the list, dragging along the rail scrubs the
  // selection, and releasing jumps to it. The press swallows its own click.
  const beginPress = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (hoverCapable()) return
    suppressClick = true
    dragging = true
    scrubStarted = false
    pressY = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
    setPinned(true)
  }

  const movePress = (event: PointerEvent) => {
    if (hoverCapable() || !dragging) return
    if (!scrubStarted) {
      if (Math.abs(event.clientY - pressY) < 8) return
      scrubStarted = true
    }
    updateScrub(event.clientY)
  }

  const endPress = () => {
    if (!dragging) return
    dragging = false
    const id = scrubStarted ? scrub() : undefined
    scrubStarted = false
    setScrub(undefined)
    if (id) jump(id)
  }

  const updateScrub = (y: number) => {
    const el = column
    const count = props.messages().length
    if (!el || count === 0) return
    const rect = el.getBoundingClientRect()
    const ratio = (y - rect.top) / Math.max(1, rect.height)
    const index = Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))))
    setScrub(props.messages()[index]?.id)
  }

  const consumeSuppress = () => {
    if (!suppressClick) return false
    suppressClick = false
    return true
  }

  const jump = (id: string) => {
    suppressClick = false
    dragging = false
    scrubStarted = false
    setScrub(undefined)
    props.onJump(id)
    close()
  }

  return (
    <Show when={props.messages().length > 0}>
      <div
        ref={setRoot}
        data-component="message-rail"
        class="pointer-events-none absolute right-0 top-0 z-40 flex h-full items-center"
      >
        <div
          ref={(el) => (inner = el)}
          class="pointer-events-auto relative flex flex-col items-end gap-2 p-1"
          onMouseEnter={() => {
            if (hoverCapable()) setHovering(true)
          }}
          onMouseLeave={() => setHovering(false)}
          onPointerDown={beginPress}
          onPointerMove={movePress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
        >
          <button
            type="button"
            aria-label={language.t("session.messages.outline")}
            aria-expanded={open()}
            class="flex size-6 items-center justify-center rounded-[6px] text-text-weak transition-colors hover:bg-surface-base-active hover:text-text-strong"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPinned(!pinned())}
          >
            <Icon name="dot-grid" size="small" />
          </button>

          <div ref={(el) => (column = el)} class="flex flex-col items-end gap-[2px]">
            <For each={props.messages()}>
              {(message) => (
                <button
                  type="button"
                  title={message.text || message.time}
                  aria-label={language.t("session.messages.outlineJump")}
                  class="h-[3px] select-none rounded-full transition-all duration-150"
                  classList={{
                    "w-5 bg-text-strong": current() === message.id,
                    "w-3 bg-border-weak-base hover:w-5 hover:bg-text-weak": current() !== message.id,
                  }}
                  onClick={() => {
                    if (consumeSuppress()) return
                    jump(message.id)
                  }}
                />
              )}
            </For>
          </div>

          <button
            type="button"
            aria-label={language.t("session.messages.jumpToLatest")}
            class="flex size-6 items-center justify-center rounded-[6px] text-text-weak transition-colors hover:bg-surface-base-active hover:text-text-strong"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (consumeSuppress()) return
              props.onJumpLatest()
              close()
            }}
          >
            <Icon name="arrow-down-to-line" size="small" />
          </button>

          <Show when={open()}>
            <div
              class="pointer-events-auto absolute right-full top-1/2 flex max-h-[60vh] w-72 -translate-y-1/2 flex-col overflow-hidden rounded-[10px] border border-border-weaker-base bg-background-stronger shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div class="shrink-0 border-b border-border-weaker-base px-3 py-2 text-12-regular text-text-weak">
                {language.t("session.messages.outline")}
              </div>
              <div ref={(el) => (listEl = el)} class="min-h-0 flex-1 overflow-y-auto py-1">
                <For each={props.messages()}>
                  {(message, index) => (
                    <button
                      type="button"
                      data-rail-item={message.id}
                      title={message.text}
                      class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-base-active"
                      classList={{ "bg-surface-base-active": scrub() === message.id }}
                      onClick={() => jump(message.id)}
                    >
                      <span class="w-5 shrink-0 pt-0.5 text-12-regular text-text-weak">{index() + 1}</span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-12-regular text-text-strong">
                          {message.text || language.t("session.messages.outlineJump")}
                        </span>
                        <span class="block text-12-regular text-text-weak">{message.time}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
