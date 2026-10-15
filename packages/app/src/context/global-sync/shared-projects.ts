import { pathKey } from "@/utils/path-key"
import { createSharedValue, type SharedTransport } from "./shared-value"

// Projects opened on a server are shared with every client connected to it, so a
// phone and a desktop see the same list. The server stores the value verbatim, so
// the shape below is owned entirely by the client.
export const SHARED_PROJECTS_SCOPE = "projects"

export type SharedProject = { worktree: string; expanded: boolean }

export type SharedProjectsTransport = SharedTransport

// A server that predates this feature returns 404 or a non-JSON body; either way the
// caller falls back to local-only behavior instead of surfacing an error.
function isSharedProject(value: unknown): value is SharedProject {
  if (!value || typeof value !== "object") return false
  if (!("worktree" in value) || typeof value.worktree !== "string") return false
  return "expanded" in value ? typeof value.expanded === "boolean" : true
}

export function parseSharedProjects(input: unknown): SharedProject[] | undefined {
  if (!Array.isArray(input)) return undefined
  const projects = input
    .filter(isSharedProject)
    .map((project) => ({ worktree: project.worktree, expanded: project.expanded ?? true }))
  return projects.length === input.length ? projects : undefined
}

// Keeps the pending order and appends local-only projects, so the first device to
// sync cannot erase a list another device already had. Compared with the same path
// normalization the project list uses, so `D:\x` and `d:/x` are one project.
export function mergeProjects(pending: SharedProject[], local: SharedProject[]): SharedProject[] {
  const seen = new Set(pending.map((project) => pathKey(project.worktree)))
  return [...pending, ...local.filter((project) => !seen.has(pathKey(project.worktree)))]
}

// Cheap equality so a periodic re-read can skip the store write (and the sidebar
// re-render) while nothing changed. Compares with the same pathKey the project list
// uses, so separator and trailing slash differences are not seen as a change.
export function sameProjects(a: SharedProject[], b: SharedProject[]) {
  return (
    a.length === b.length &&
    a.every((project, index) => {
      const other = b[index]
      return pathKey(project.worktree) === pathKey(other.worktree) && project.expanded === other.expanded
    })
  )
}

export function createSharedProjects(input: {
  transport: SharedProjectsTransport
  onError?: (error: unknown) => void
}) {
  return createSharedValue<SharedProject[]>({
    scope: SHARED_PROJECTS_SCOPE,
    parse: parseSharedProjects,
    transport: input.transport,
    onError: input.onError,
  })
}
