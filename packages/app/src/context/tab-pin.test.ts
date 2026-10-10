import { describe, expect, test } from "bun:test"
import { createStore, produce } from "solid-js/store"
import { tabKey, type Tab, type TabInfo } from "./tabs"
import type { ServerConnection } from "./server"

// Mirrors the pin bookkeeping in the Tabs context: `TabInfo.pinned` holds the
// flag, and pinning also moves the tab to the front of the store so the
// titlebar renders pinned tabs first without a separate ordering projection.
type Store = ReturnType<typeof createStore<Tab[]>>

function setup(tabs: Tab[], info: Record<string, TabInfo>) {
  const [store, setStore] = createStore<Tab[]>(tabs)
  const [infoStore, setInfo] = createStore<Record<string, TabInfo>>(info)
  const isPinned = (tab: Tab) => infoStore[tabKey(tab)]?.pinned === true
  const togglePin = (tab: Tab) => {
    const key = tabKey(tab)
    const next = infoStore[key]?.pinned !== true
    setInfo(key, { ...infoStore[key], pinned: next })
    if (!next) return
    const index = store.findIndex((item) => tabKey(item) === key)
    if (index <= 0) return
    setStore(
      produce((list) => {
        const [moved] = list.splice(index, 1)
        if (moved) list.unshift(moved)
      }),
    )
  }
  const closeTab = (index: number) => {
    const tab = store[index]
    if (!tab) return false
    if (infoStore[tabKey(tab)]?.pinned) return false
    setStore(
      produce((list) => {
        list.splice(index, 1)
      }),
    )
    return true
  }
  return { store, infoStore, isPinned, togglePin, closeTab }
}

const SERVER = "local" as ServerConnection.Key
const session = (id: string): Tab => ({ type: "session", server: SERVER, sessionId: id })
const draft = (id: string): Tab => ({ type: "draft", draftID: id, server: SERVER, directory: "/repo" })

describe("pinned tabs", () => {
  test("pins a session tab and moves it to the front", () => {
    const a = session("a")
    const b = session("b")
    const c = session("c")
    const ctx = setup([a, b, c], {})

    ctx.togglePin(c)

    expect(ctx.isPinned(c)).toBe(true)
    expect(ctx.isPinned(a)).toBe(false)
    expect(ctx.store.map(tabKey)).toEqual([tabKey(c), tabKey(a), tabKey(b)])
  })

  test("unpinning keeps the current position", () => {
    const a = session("a")
    const b = session("b")
    // Pinning always leaves the tab leading, so that is the state to unpin from.
    const ctx = setup([b, a], { [tabKey(b)]: { pinned: true } })

    ctx.togglePin(b)

    expect(ctx.isPinned(b)).toBe(false)
    expect(ctx.store.map(tabKey)).toEqual([tabKey(b), tabKey(a)])
  })

  test("re-pinning an already leading tab does not reorder", () => {
    const a = session("a")
    const b = session("b")
    const ctx = setup([a, b], { [tabKey(a)]: { pinned: true } })

    ctx.togglePin(a)
    expect(ctx.store.map(tabKey)).toEqual([tabKey(a), tabKey(b)])
  })

  test("a pinned tab cannot be closed", () => {
    const a = session("a")
    const b = session("b")
    const ctx = setup([a, b], { [tabKey(a)]: { pinned: true } })

    expect(ctx.closeTab(0)).toBe(false)
    expect(ctx.store.map(tabKey)).toEqual([tabKey(a), tabKey(b)])
  })

  test("an unpinned tab still closes", () => {
    const a = session("a")
    const b = session("b")
    const ctx = setup([a, b], {})

    expect(ctx.closeTab(0)).toBe(true)
    expect(ctx.store.map(tabKey)).toEqual([tabKey(b)])
  })

  test("pin state survives alongside other tab info", () => {
    const a = session("a")
    const ctx = setup([a], { [tabKey(a)]: { title: "Merge code", directory: "/repo" } })

    ctx.togglePin(a)

    expect(ctx.infoStore[tabKey(a)]).toEqual({
      title: "Merge code",
      directory: "/repo",
      pinned: true,
    })
  })

  test("draft tabs pin like session tabs", () => {
    const d = draft("d1")
    const s = session("s1")
    const ctx = setup([s, d], {})

    ctx.togglePin(d)

    expect(ctx.store.map(tabKey)).toEqual([tabKey(d), tabKey(s)])
    expect(ctx.closeTab(0)).toBe(false)
  })
})