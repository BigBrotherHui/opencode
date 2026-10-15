import type { SharedProject } from "./shared-projects"

// Dragging a project fires many moves in a row; coalesce them so the server sees
// the settled order instead of every intermediate position.
export function createDebouncedPush(target: { push: (projects: SharedProject[]) => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: SharedProject[] | undefined
  return (projects: SharedProject[]) => {
    latest = projects
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      const value = latest
      latest = undefined
      if (value) target.push(value)
    }, 250)
  }
}
