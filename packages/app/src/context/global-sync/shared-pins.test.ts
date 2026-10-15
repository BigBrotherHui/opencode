import { describe, expect, test } from "bun:test"
import { createSharedPins, mergePins, parseSharedPins, samePins, SHARED_PINS_SCOPE } from "./shared-pins"

describe("parseSharedPins", () => {
  test("keeps string ids and de-duplicates", () => {
    expect(parseSharedPins(["a", "b", "a"])).toEqual(["a", "b"])
  })

  test("rejects non-arrays and non-string entries", () => {
    expect(parseSharedPins(undefined)).toBeUndefined()
    expect(parseSharedPins("a")).toBeUndefined()
    expect(parseSharedPins(["a", 42])).toBeUndefined()
    expect(parseSharedPins(["a", ""])).toBeUndefined()
  })
})

describe("samePins", () => {
  test("compares as a set, ignoring order", () => {
    expect(samePins(["a", "b"], ["b", "a"])).toBe(true)
    expect(samePins(["a"], ["a", "b"])).toBe(false)
    expect(samePins(["a"], ["b"])).toBe(false)
  })
})

describe("mergePins", () => {
  test("keeps the pending order and appends local-only pins", () => {
    expect(mergePins(["a", "b"], ["c", "a"])).toEqual(["a", "b", "c"])
  })

  test("returns the pending list when every local pin is already there", () => {
    expect(mergePins(["a"], ["a"])).toEqual(["a"])
  })
})

describe("createSharedPins", () => {
  test("loads the stored list", async () => {
    const sync = createSharedPins({
      transport: {
        read: async () => ["a", "b"],
        write: async () => {},
      },
    })
    expect(await sync.load()).toEqual({ remote: ["a", "b"], unseeded: false })
  })

  test("stays local-only when the server has no shared state", async () => {
    const writes: unknown[] = []
    const sync = createSharedPins({
      transport: {
        read: async () => undefined,
        write: async (_scope, value) => void writes.push(value),
      },
    })
    expect(await sync.load()).toBeUndefined()
    sync.push(["a"])
    await Promise.resolve()
    expect(writes).toEqual([])
  })

  test("treats a null value as unseeded and publishes the local pins", async () => {
    const writes: { scope: string; value: unknown }[] = []
    const sync = createSharedPins({
      transport: {
        read: async () => null,
        write: async (scope, value) => void writes.push({ scope, value }),
      },
    })
    expect(await sync.load()).toEqual({ remote: undefined, unseeded: true })
    sync.seed(["a"])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([{ scope: SHARED_PINS_SCOPE, value: ["a"] }])
  })

  test("seeding an empty local list writes nothing", async () => {
    const writes: unknown[] = []
    const sync = createSharedPins({
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

  test("pushes changes once sharing is available", async () => {
    const writes: { scope: string; value: unknown }[] = []
    const sync = createSharedPins({
      transport: {
        read: async () => [],
        write: async (scope, value) => void writes.push({ scope, value }),
      },
    })
    await sync.load()
    sync.push(["a"])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writes).toEqual([{ scope: SHARED_PINS_SCOPE, value: ["a"] }])
  })

  test("re-reads the server value when adopting", async () => {
    let stored: unknown = ["a"]
    const sync = createSharedPins({
      transport: {
        read: async () => stored,
        write: async () => {},
      },
    })
    await sync.load()
    stored = ["a", "b"]
    expect(await sync.adopt()).toEqual(["a", "b"])
  })
})
