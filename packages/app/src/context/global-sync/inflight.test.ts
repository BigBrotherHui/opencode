import { describe, expect, test } from "bun:test"
import { once, resetInflight } from "./inflight"

describe("once", () => {
  test("joins concurrent callers onto one promise", async () => {
    resetInflight()
    let calls = 0
    const load = () =>
      once("agents:/project", async () => {
        calls++
        await Bun.sleep(10)
        return { ok: true }
      })

    const [first, second] = await Promise.all([load(), load()])

    expect(calls).toBe(1)
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
  })

  test("runs again once the previous request settled", async () => {
    resetInflight()
    let calls = 0
    const load = () => once("agents:/project", async () => ++calls === 1 ? "first" : "second")

    expect(await load()).toBe("first")
    expect(await load()).toBe("second")
  })

  test("does not leave a failed request cached", async () => {
    resetInflight()
    let calls = 0
    const load = () =>
      once("mcp:/project", async () => {
        calls++
        if (calls === 1) throw new Error("boom")
        return "recovered"
      })

    await expect(load()).rejects.toThrow("boom")
    expect(await load()).toBe("recovered")
  })

  test("keeps different requests apart", async () => {
    resetInflight()
    const load = (key: string) => once(key, async () => key)

    const [a, b] = await Promise.all([load("a"), load("b")])

    expect([a, b]).toEqual(["a", "b"])
  })
})
