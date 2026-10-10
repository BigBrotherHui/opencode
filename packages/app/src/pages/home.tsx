import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createSignal } from "solid-js"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeUtilityNav } from "./home/home-projects-view"
import { HomeProjects } from "./home/home-projects"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionSearchController } from "./home/home-session-search-controller"
import { createHomeSessionsController } from "./home/home-sessions-controller"
import { HomeSessions } from "./home/home-sessions"

function HomeComposer() {
  const home = createHomeController()
  const tabs = useTabs()
  const [prompt, setPrompt] = createSignal("")
  const [focused, setFocused] = createSignal(false)

  const submit = () => {
    const text = prompt().trim()
    const conn = home.server.focused()
    const project = home.project.newSession()
    const ctx = home.server.focusedContext()
    if (!conn || !project || !ctx) return
    setPrompt("")
    ctx.projects.open(project.worktree)
    ctx.projects.touch(project.worktree)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree }, text)
  }

  return (
    <div
      class={`
        mx-auto w-full max-w-[720px] rounded-xl border px-4 py-3
        bg-v2-background-bg-base transition-colors
        ${focused() ? "border-v2-icon-interactive-hover" : "border-v2-border-weak-base"}
      `}
    >
      <textarea
        class="w-full resize-none bg-transparent text-sm outline-none placeholder:text-v2-text-weak-base"
        rows={2}
        placeholder="让 opencode 帮你做点什么…"
        value={prompt()}
        onInput={(e) => setPrompt(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div class="mt-1 flex items-center justify-between">
        <span class="text-xs text-v2-text-weak-base">{home.project.newSession()?.worktree ?? ""}</span>
        <span class="text-xs text-v2-text-weak-base">Enter 发送 / Shift+Enter 换行</span>
      </div>
    </div>
  )
}

export function NewHome() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  return (
    <div
      class={`
        m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <ScrollView
        class="h-full [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack}
        thumbHoverTarget={scroll.viewport.hoverTarget}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={scroll.viewport.containOuterWheel}
      >
        <div
          class={`
            mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3
            lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `}
        >
          <HomeProjects projects={projects} scroll={scroll} />
          <div class="flex min-w-0 flex-col gap-4">
            <HomeComposer />
            <HomeSessions sessions={sessions} search={search} scroll={scroll} />
          </div>
          <HomeUtilityNav
            class="flex lg:hidden"
            onOpenSettings={projects.utility.settings}
            onOpenHelp={projects.utility.help}
            language={projects.copy.language}
          />
        </div>
      </ScrollView>
    </div>
  )
}
