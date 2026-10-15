import { describe, expect, test } from "bun:test"
import {
  createSharedProjects,
  mergeProjects,
  parseSharedProjects,
  sameProjects,
  SHARED_PROJECTS_SCOPE,
} from "./shared-projects"

const project = (worktree: string, expanded = true) => ({ worktree, expanded })

describe("parseSharedProjects", () => {
  test("keeps valid entries and defaults expanded", () => {
    expect(parseSharedProjects([{ worktree: "/a" }, { worktree: "/b", expanded: false }])).toEqual([
      { worktree: "/a", expanded: true },
      { worktree: "/b", expanded: false },
    ])
  })

  test("rejects non-arrays and malformed entries", () => {
    expect(parseSharedProjects(undefined)).toBeUndefined()
    expect(parseSharedProjects({ worktree: "/a" })).toBeUndefined()
    expect(parseSharedProjects([{ worktree: "/a" }, { nope: true }])).toBeUndefined()
    expect(parseSharedProjects([{ worktree: 42 }])).toBeUndefined()
  })
})

describe("mergeProjects", () => {
  // The pending order wins, because it is what other devices already see.
  test("keeps the pending order and appends local-only projects", () => {
    expect(mergeProjects([project("/a"), project("/b")], [project("/c"), project("/a")])).toEqual([
      project("/a"),
      project("/b"),
      project("/c"),
    ])
  })

  test("returns the pending list when every local project is already there", () => {
    expect(mergeProjects([project("/a", false)], [project("/a", true)])).toEqual([project("/a", false)])
  })

  test("returns the local list when nothing is pending", () => {
    expect(mergeProjects([], [project("/a")])).toEqual([project("/a")])
  })

  test("treats path variants of one project as the same entry", () => {
    expect(mergeProjects([project("D:\\Project\\Dental")], [project("D:/Project/Dental")])).toEqual([
      project("D:\\Project\\Dental"),
    ])
  })
})

describe("sameProjects", () => {
  test("compares order, paths and expansion", () => {
    expect(sameProjects([project("/a"), project("/b", false)], [project("/a"), project("/b", false)])).toBe(true)
    expect(sameProjects([project("/a"), project("/b")], [project("/b"), project("/a")])).toBe(false)
    expect(sameProjects([project("/a")], [project("/a", false)])).toBe(false)
    expect(sameProjects([project("/a")], [project("/a"), project("/b")])).toBe(false)
  })

  test("ignores separator and trailing slash differences", () => {
    expect(sameProjects([project("D:\\Project\\Dental")], [project("D:/Project/Dental")])).toBe(true)
    expect(sameProjects([project("/a/")], [project("/a")])).toBe(true)
  })
})

describe("createSharedProjects", () => {
  test("loads the stored list", async () => {
    const sync = createSharedProjects({
      transport: {
        read: async () => [project("/a"), project("/b", false)],
        write: async () => {},
      },
    })
    expect(await sync.load()).toEqual({ remote: [project("/a"), project("/b", false)], unseeded: false })
  })

  test("stays local-only when the server has no shared state", async () => {
    const writes: unknown[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => undefined,
        write: async (_scope, value) => void writes.push(value),
      },
    })
    expect(await sync.load()).toBeUndefined()
    sync.push([project("/a")])
    await Promise.resolve()
    expect(writes).toEqual([])
    expect(await sync.adopt()).toBeUndefined()
  })

  // A supported server that has never stored this scope returns null. This is the
  // case a fresh install hits, and the local list must become the shared one instead
  // of every other device starting from nothing.
  test("treats a null value as unseeded and publishes the local list", async () => {
    const writes: { scope: string; value: unknown }[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => null,
        write: async (scope, value) => void writes.push({ scope, value }),
      },
    })
    const loaded = await sync.load()
    expect(loaded).toEqual({ remote: undefined, unseeded: true })
    sync.seed([project("/a"), project("/b")])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([{ scope: SHARED_PROJECTS_SCOPE, value: [project("/a"), project("/b")] }])
  })

  // An empty stored list is a real value: every project was closed somewhere, so the
  // devices follow it instead of refilling it.
  test("treats an empty stored list as an adopted value", async () => {
    const writes: unknown[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => [],
        write: async (_scope, value) => void writes.push(value),
      },
    })
    expect(await sync.load()).toEqual({ remote: [], unseeded: false })
    expect(await sync.adopt()).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([])
  })

  // An unseeded scope has nothing to adopt; the caller keeps its local list and its
  // seed path decides what to publish.
  test("keeps the local list when adopting an unseeded scope", async () => {
    let stored: unknown = null
    const sync = createSharedProjects({
      transport: {
        read: async () => stored,
        write: async () => {},
      },
    })
    await sync.load()
    expect(await sync.adopt()).toBeUndefined()
    stored = [project("/a")]
    expect(await sync.adopt()).toEqual([project("/a")])
  })

  test("seeding an empty local list writes nothing", async () => {
    const writes: unknown[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => null,
        write: async (_scope, value) => void writes.push(value),
      },
    })
    await sync.load()
    sync.seed([])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([])
  })

  test("stays local-only when reading fails", async () => {
    const sync = createSharedProjects({
      transport: {
        read: async () => {
          throw new Error("404")
        },
        write: async () => {},
      },
    })
    expect(await sync.load()).toBeUndefined()
  })

  test("pushes changes once sharing is available", async () => {
    const writes: { scope: string; value: unknown }[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => [],
        write: async (scope, value) => void writes.push({ scope, value }),
      },
    })
    await sync.load()
    sync.push([project("/a")])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([{ scope: SHARED_PROJECTS_SCOPE, value: [project("/a")] }])
  })

  test("keeps only the newest value while a write is in flight", async () => {
    const writes: unknown[] = []
    let release: (() => void) | undefined
    const sync = createSharedProjects({
      transport: {
        read: async () => [],
        write: async (_scope, value) => {
          writes.push(value)
          await new Promise<void>((resolve) => {
            release = resolve
          })
        },
      },
    })
    await sync.load()
    sync.push([project("/a")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    sync.push([project("/b")])
    sync.push([project("/c")])
    release?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([[project("/a")], [project("/c")]])
  })

  test("re-reads the server value when adopting", async () => {
    let stored: unknown = [project("/a")]
    const sync = createSharedProjects({
      transport: {
        read: async () => stored,
        write: async () => {},
      },
    })
    await sync.load()
    stored = [project("/a"), project("/b")]
    expect(await sync.adopt()).toEqual([project("/a"), project("/b")])
  })

  test("reports write failures without throwing", async () => {
    const errors: unknown[] = []
    const sync = createSharedProjects({
      transport: {
        read: async () => [],
        write: async () => {
          throw new Error("offline")
        },
      },
      onError: (error) => void errors.push(error),
    })
    await sync.load()
    sync.push([project("/a")])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(errors).toHaveLength(1)
  })
})
