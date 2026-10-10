import { describe, expect, test } from "bun:test"
import { formatModelSummary } from "./model-summary"

describe("formatModelSummary", () => {
  test("lists extra input modalities alongside text", () => {
    expect(
      formatModelSummary({
        capabilities: { input: { text: true, image: true, pdf: true } },
      }),
    ).toContain("text + image, pdf")
  })

  test("reports text-only when nothing else is enabled", () => {
    expect(formatModelSummary({ capabilities: { input: { text: true } } })).toContain("text")
  })

  test("omits the modalities entry when capabilities are absent", () => {
    const out = formatModelSummary({ limit: { context: 128000, output: 32000 } })
    expect(out.some((part) => part.includes("text"))).toBe(false)
    expect(out).toContain("128k ctx")
    expect(out).toContain("32k out")
  })

  test("formats large limits with k and M", () => {
    expect(formatModelSummary({ limit: { context: 1_000_000, output: 8_000 } })).toEqual(["1M ctx", "8k out"])
    expect(formatModelSummary({ limit: { context: 200_000, output: 100_000 } })).toEqual(["200k ctx", "100k out"])
  })

  test("skips the output entry when it matches the context window", () => {
    expect(formatModelSummary({ limit: { context: 200_000, output: 200_000 } })).toEqual(["200k ctx"])
  })

  test("surfaces reasoning, missing tool calling and pricing", () => {
    const out = formatModelSummary({
      capabilities: { reasoning: true, toolcall: false, input: { text: true } },
      cost: { input: 3, output: 15 },
    })
    expect(out).toContain("reasoning")
    expect(out).toContain("no tools")
    expect(out).toContain("$3/$15 per Mtok")
  })

  test("ignores zero and non-finite limits", () => {
    expect(formatModelSummary({ limit: { context: 0, output: 0 } })).toEqual([])
    expect(formatModelSummary({ limit: { context: Number.NaN, output: 0 } })).toEqual([])
  })
})