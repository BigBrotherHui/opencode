import { describe, expect, test } from "bun:test"
import { modelRow, type ModelRow, parseLimit, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

const row = (overrides: Partial<ModelRow> = {}): ModelRow => ({
  ...modelRow(),
  id: "model-a",
  name: "Model A",
  ...overrides,
})

describe("parseLimit", () => {
  test("accepts plain numbers and k/m suffixes", () => {
    expect(parseLimit("128000")).toBe(128000)
    expect(parseLimit("128k")).toBe(128_000)
    expect(parseLimit("2M")).toBe(2_000_000)
    expect(parseLimit(" 128 K ")).toBe(128_000)
    expect(parseLimit("1,000")).toBe(1000)
  })

  test("distinguishes empty from invalid", () => {
    expect(parseLimit("")).toBeUndefined()
    expect(parseLimit("   ")).toBeUndefined()
    expect(Number.isNaN(parseLimit("abc") as number)).toBe(true)
    expect(Number.isNaN(parseLimit("-5") as number)).toBe(true)
    expect(Number.isNaN(parseLimit("0") as number)).toBe(true)
  })
})

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [row({ id: " model-a ", name: " Model A " })],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("omits capability fields that match runtime defaults", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        // Reasoning/attachment/temperature default to false, tool calling to true,
        // and input modalities to text-only for a custom provider.
        models: [row()],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({ "model-a": { name: "Model A" } })
  })

  test("writes reasoning, modalities, limits and tool-call opt-out", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          row({
            id: "qwen3",
            name: "Qwen3",
            reasoning: true,
            attachment: true,
            temperature: true,
            toolCall: false,
            inputModalities: ["image", "pdf"],
            contextLimit: "128k",
            outputLimit: "32k",
          }),
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      qwen3: {
        name: "Qwen3",
        reasoning: true,
        attachment: true,
        temperature: true,
        tool_call: false,
        modalities: { input: ["image", "pdf", "text"] },
        limit: { context: 128_000, output: 32_000 },
      },
    })
  })

  test("rejects a half-filled limit pair and malformed limits", () => {
    const half = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [row({ contextLimit: "128k" })],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(half.result).toBeUndefined()
    expect(half.models[0]?.limit).toBe("provider.custom.error.limit.pair")

    const malformed = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [row({ contextLimit: "lots", outputLimit: "32k" })],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(malformed.result).toBeUndefined()
    expect(malformed.models[0]?.limit).toBe("provider.custom.error.limit.format")
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [row({ name: "Model A" }), row({ name: "Model A 2" })],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
      limit: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})