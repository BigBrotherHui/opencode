import { describe, expect, test } from "bun:test"
import { discoverableProviders } from "./model-discovery"

describe("discoverableProviders", () => {
  test("keeps only openai-compatible providers with a base URL", () => {
    const result = discoverableProviders({
      provider: {
        dli_grok: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://us-v1.dli.li/v1", apiKey: "secret" },
        },
        "ghost-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {},
        },
        anthropic: {
          npm: "@ai-sdk/anthropic",
          options: { baseURL: "https://api.anthropic.com" },
        },
        blank: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "   " },
        },
      },
    })

    expect(result).toEqual([{ providerID: "dli_grok", baseURL: "https://us-v1.dli.li/v1", apiKey: "secret" }])
  })

  test("omits the api key when it is absent or not a string", () => {
    const result = discoverableProviders({
      provider: {
        justdowork: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:7863/v1" } },
        odd: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://localhost:1/v1", apiKey: 42 } },
      },
    })

    expect(result).toEqual([
      { providerID: "justdowork", baseURL: "http://127.0.0.1:7863/v1" },
      { providerID: "odd", baseURL: "http://localhost:1/v1" },
    ])
  })

  test("trims the base URL and tolerates a missing provider section", () => {
    expect(discoverableProviders({})).toEqual([])
    expect(
      discoverableProviders({
        provider: { padded: { npm: "@ai-sdk/openai-compatible", options: { baseURL: " https://host/v1 " } } },
      }),
    ).toEqual([{ providerID: "padded", baseURL: "https://host/v1" }])
  })
})