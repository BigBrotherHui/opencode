import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { For, Show, createResource, createSignal } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"
import type { ServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

type ArchivedSession = {
  id: string
  title: string
  directory: string
  archived: number
}

// The archive list is read on open instead of being kept in the session store:
// archived sessions are excluded from every live list, so a few hundred rows is
// the whole cost, and paying it only when the dialog opens keeps the phone's
// initial load unchanged.
export function DialogArchivedSessions(props: { client: ServerSDK["client"] }) {
  const language = useLanguage()
  // Read once at mount: the dialog is rendered by the dialog provider, whose owner chain sits
  // above the server context, so a prop getter re-read from an event handler resolves to
  // nothing. The client captured here is the one the caller passed in.
  const client = props.client
  const [revision, setRevision] = createSignal(0)
  const [pending, setPending] = createSignal("")
  const [sessions] = createResource(revision, async () => {
    const response = await client.v2.session.list({ limit: 4_000, order: "desc" })
    return (response.data?.data ?? [])
      .flatMap((session): ArchivedSession[] => {
        if (session.parentID || typeof session.time.archived !== "number") return []
        return [
          {
            id: session.id,
            title: session.title,
            directory: session.location.directory,
            archived: session.time.archived,
          },
        ]
      })
      .sort((a, b) => b.archived - a.archived)
  })

  const restore = async (session: ArchivedSession) => {
    if (pending()) return
    setPending(session.id)
    // `time.archived: null` clears the archive. The OpenAPI-generated SDK widens the field to
    // `number | undefined`, so the nullable body is typed here instead of in generated code.
    // Bound because the generated client reads its transport off `this`.
    const update = client.session.update.bind(client.session) as (input: {
      sessionID: string
      directory: string
      time: { archived: number | null }
    }) => Promise<unknown>
    try {
      await update({ sessionID: session.id, directory: session.directory, time: { archived: null } })
      setRevision((value) => value + 1)
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setPending("")
    }
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("home.sessions.archived")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex max-h-[min(560px,calc(100vh-160px))] w-full min-w-[420px] max-w-[560px] flex-col gap-1 overflow-y-auto px-3 pt-2 pb-3">
        <Show
          when={sessions.loading || (sessions() ?? []).length > 0}
          fallback={
            <div class="px-3 py-6 text-center text-[13px] text-v2-text-text-muted">
              {language.t("home.sessions.archived.empty")}
            </div>
          }
        >
          <For each={sessions() ?? []}>
            {(session) => (
              <div
                data-component="archived-session-row"
                class="flex h-10 min-w-0 items-center gap-3 rounded-[6px] px-3 hover:bg-v2-overlay-simple-overlay-hover"
              >
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[13px] text-v2-text-text-base [font-weight:530]">
                    {session.title || session.id}
                  </span>
                  <span class="truncate text-[11px] text-v2-text-text-muted">{getFilename(session.directory)}</span>
                </div>
                <ButtonV2
                  data-action="archived-session-restore"
                  variant="ghost-muted"
                  size="small"
                  class="shrink-0 [font-weight:530]"
                  disabled={!!pending()}
                  onClick={() => void restore(session)}
                >
                  {language.t("home.sessions.archived.restore")}
                </ButtonV2>
              </div>
            )}
          </For>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
