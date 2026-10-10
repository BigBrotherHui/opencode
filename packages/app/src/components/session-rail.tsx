import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useTabs } from "@/context/tabs"
import { useSessionKey } from "@/pages/session/session-layout"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"

const WIDTH = 232

/** Compact relative age: `now`, `5m`, `3h`, `2d`, then a short date. */
function relativeTime(created: number | undefined, intl: string) {
  if (!created) return ""
  const seconds = Math.max(0, (Date.now() - created) / 1000)
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return new Date(created).toLocaleDateString(intl, { month: "short", day: "numeric" })
}

/**
 * Persistent session list for the new layout. Root sessions of the current
 * directory are listed newest first so a recurring purpose can be reopened from
 * anywhere instead of starting a fresh session to reach the same place.
 */
export const SessionRail: Component = () => {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const tabs = useTabs()
  const navigate = useNavigate()
  const { params } = useSessionKey()
  const [collapsed, setCollapsed] = createSignal(false)

  const sessions = createMemo(() =>
    [...(sync().data.session ?? [])]
      // Child sessions belong to their parent's thread, not this list.
      .filter((session) => !session.parentID)
      .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0)),
  )

  const href = (id: string) =>
    params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : legacySessionHref(sdk().directory, id)

  const open = (id: string) => navigate(href(id))

  const newSession = () => {
    if (params.serverKey) {
      tabs.newDraft({ server: requireServerKey(params.serverKey), directory: sdk().directory })
      return
    }
    navigate(`/${sdk().directory}/session`)
  }

  return (
    <div
      data-component="session-rail"
      data-collapsed={collapsed() ? "" : undefined}
      class="shrink-0 h-full min-h-0 flex flex-col border-r border-v2-border-border-base bg-v2-background-bg-base transition-[width] duration-150"
      style={{ width: collapsed() ? "44px" : `${WIDTH}px` }}
    >
      <div class="flex items-center gap-1 px-2 h-10 shrink-0">
        <Show when={!collapsed()}>
          <span class="flex-1 min-w-0 truncate px-1 text-12-medium text-v2-text-text-muted">
            {language.t("session.rail.title")}
          </span>
        </Show>
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="small"
          onClick={() => setCollapsed((value) => !value)}
          icon={<IconV2 name="sidebar-right" />}
          aria-label={language.t(collapsed() ? "session.rail.expand" : "session.rail.collapse")}
          aria-expanded={!collapsed()}
        />
        <Show when={!collapsed()}>
          <TooltipV2 value={language.t("command.session.new")} placement="bottom" gutter={8}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              onClick={newSession}
              icon={<IconV2 name="plus" />}
              aria-label={language.t("command.session.new")}
            />
          </TooltipV2>
        </Show>
      </div>

      <Show when={!collapsed()}>
        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <Show
            when={sessions().length > 0}
            fallback={
              <div class="px-2 py-3 text-12-regular text-v2-text-text-muted">{language.t("session.rail.empty")}</div>
            }
          >
            <For each={sessions()}>
              {(session) => {
                const active = () => session.id === params.id
                return (
                  <button
                    type="button"
                    data-session-rail-item
                    data-active={active() ? "" : undefined}
                    class="w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-v2-overlay-simple-overlay-hover data-[active]:bg-v2-overlay-simple-overlay-pressed"
                    onClick={() => open(session.id)}
                  >
                    <span class="flex-1 min-w-0 truncate text-13-regular text-v2-text-text-base">
                      {session.title?.trim() || language.t("session.rail.untitled")}
                    </span>
                    <span class="shrink-0 text-11-regular text-v2-text-text-muted">
                      {relativeTime(session.time?.created, language.intl())}
                    </span>
                  </button>
                )
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}