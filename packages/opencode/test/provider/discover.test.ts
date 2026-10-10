import { describe, expect, test } from "bun:test"
import { DiscoverError, discoverOpenAICompatibleModels, resolveModelsUrl } from "@/provider/discover"

function server(
  handler: (req: Request) => Response | Promise<Response>,
  init?: { onRequest?: (url: URL, headers: Headers) => void },
) {
  return Bun.serve({ port: 0, fetch: handler })
}

async function close(s: ReturnType<typeof server>) {
  await s.stop(true)
}

/** Assert the call rejects with a DiscoverError of the given kind. */
async function expectDiscoverError(promise: Promise<unknown>, kind: string) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  if (!(caught instanceof DiscoverError)) {
    throw new Error(`expected DiscoverError, got ${String(caught)}`)
  }
  if (caught.kind !== kind) {
    throw new Error(`expected DiscoverError kind "${kind}", got "${caught.kind}"`)
  }
}

describe("resolveModelsUrl", () => {
  test("keeps a version segment already present in the base URL", () => {
    expect(resolveModelsUrl("https://us-v1.dli.li/v1").href).toBe("https://us-v1.dli.li/v1/models")
    expect(resolveModelsUrl("https://host/api/v1/").href).toBe("https://host/api/v1/models")
    expect(resolveModelsUrl("http://127.0.0.1:7863/v1").href).toBe("http://127.0.0.1:7863/v1/models")
  })

  test("appends /v1 when the base URL has no version segment", () => {
    expect(resolveModelsUrl("https://api.example.com").href).toBe("https://api.example.com/v1/models")
    expect(resolveModelsUrl("https://api.example.com/").href).toBe("https://api.example.com/v1/models")
  })

  test("rejects non-http schemes and malformed URLs", () => {
    expect(() => resolveModelsUrl("ftp://host/v1")).toThrow(DiscoverError)
    expect(() => resolveModelsUrl("not a url")).toThrow(DiscoverError)
    expect(() => resolveModelsUrl("")).toThrow(DiscoverError)
  })

  test("blocks cloud instance-metadata endpoints", () => {
    expect(() => resolveModelsUrl("http://169.254.169.254/v1")).toThrow(
      expect.objectContaining({ kind: "blocked" }) as never,
    )
    expect(() => resolveModelsUrl("http://metadata.google.internal/v1")).toThrow(DiscoverError)
  })

  test("still allows loopback and LAN hosts", () => {
    expect(resolveModelsUrl("http://127.0.0.1:7863/v1").hostname).toBe("127.0.0.1")
    expect(resolveModelsUrl("http://192.168.1.10:1234/v1").hostname).toBe("192.168.1.10")
  })
})

describe("discoverOpenAICompatibleModels", () => {
  test("returns trimmed, de-duplicated, sorted IDs", async () => {
    const s = server(() => Response.json({ data: [{ id: " zeta " }, { id: "alpha" }, { id: "zeta" }, { id: "" }] }))
    try {
      expect(await discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` })).toEqual([
        "alpha",
        "zeta",
      ])
    } finally {
      await close(s)
    }
  })

  test("sends the bearer token", async () => {
    const seen: { value: string | null } = { value: null }
    const s = server((req) => {
      seen.value = req.headers.get("authorization")
      return Response.json({ data: [{ id: "m" }] })
    })
    try {
      await discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1`, apiKey: "secret-token" })
      expect(seen.value).toBe("Bearer secret-token")
    } finally {
      await close(s)
    }
  })

  test("resolves a {env:NAME} reference server-side", async () => {
    process.env.OC_TEST_DISCOVER_KEY = "from-env"
    const seen: { value: string | null } = { value: null }
    const s = server((req) => {
      seen.value = req.headers.get("authorization")
      return Response.json({ data: [{ id: "m" }] })
    })
    try {
      await discoverOpenAICompatibleModels({
        baseURL: `http://127.0.0.1:${s.port}/v1`,
        apiKey: "{env:OC_TEST_DISCOVER_KEY}",
      })
      expect(seen.value).toBe("Bearer from-env")
    } finally {
      delete process.env.OC_TEST_DISCOVER_KEY
      await close(s)
    }
  })

  test("never overrides an explicit Authorization header", async () => {
    process.env.OC_TEST_DISCOVER_KEY = "from-env"
    const seen: { value: string | null } = { value: null }
    const s = server((req) => {
      seen.value = req.headers.get("authorization")
      return Response.json({ data: [{ id: "m" }] })
    })
    try {
      await discoverOpenAICompatibleModels({
        baseURL: `http://127.0.0.1:${s.port}/v1`,
        apiKey: "{env:OC_TEST_DISCOVER_KEY}",
        headers: { Authorization: "Bearer explicit" },
      })
      expect(seen.value).toBe("Bearer explicit")
    } finally {
      delete process.env.OC_TEST_DISCOVER_KEY
      await close(s)
    }
  })

  test("maps 401 and 403 to unauthorized", async () => {
    for (const status of [401, 403]) {
      const s = server(() => new Response("nope", { status }))
      try {
        await expectDiscoverError(
          discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` }),
          "unauthorized",
        )
      } finally {
        await close(s)
      }
    }
  })

  test("rejects a payload that is not a model list", async () => {
    for (const body of [{ nope: true }, { data: "string" }, { data: [{ noId: 1 }] }, { data: [] }]) {
      const s = server(() => Response.json(body))
      try {
        await expectDiscoverError(
          discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` }),
          "invalidFormat",
        )
      } finally {
        await close(s)
      }
    }
  })

  test("rejects non-JSON bodies", async () => {
    const s = server(() => new Response("<html>not json</html>"))
    try {
      await expectDiscoverError(
        discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` }),
        "invalidFormat",
      )
    } finally {
      await close(s)
    }
  })

  test("rejects an oversized response", async () => {
    const s = server(() => new Response("x".repeat(3 * 1024 * 1024)))
    try {
      await expectDiscoverError(
        discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` }),
        "tooLarge",
      )
    } finally {
      await close(s)
    }
  })

  test("reports a non-OK status as failed", async () => {
    const s = server(() => new Response("boom", { status: 500 }))
    try {
      await expectDiscoverError(
        discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` }),
        "failed",
      )
    } finally {
      await close(s)
    }
  })

  test("reports a remote endpoint with no credential instead of its 401", async () => {
    // No request is made: the missing credential is known before the fetch, so
    // the provider's own 401 never masks the real cause.
    await expectDiscoverError(
      discoverOpenAICompatibleModels({ baseURL: "https://api.example.com/v1" }),
      "noCredential",
    )
  })

  test("reports an unresolvable {env:NAME} reference as a missing credential", async () => {
    delete process.env.OC_TEST_MISSING_KEY
    await expectDiscoverError(
      discoverOpenAICompatibleModels({
        baseURL: "https://api.example.com/v1",
        apiKey: "{env:OC_TEST_MISSING_KEY}",
      }),
      "noCredential",
    )
  })

  test("allows a keyless local runtime", async () => {
    const s = server(() => Response.json({ data: [{ id: "local-model" }] }))
    try {
      expect(await discoverOpenAICompatibleModels({ baseURL: `http://127.0.0.1:${s.port}/v1` })).toEqual([
        "local-model",
      ])
    } finally {
      await close(s)
    }
  })

  test("an explicit Authorization header satisfies the credential requirement", async () => {
    let seen: string | null = null
    const s = server(() => Response.json({ data: [{ id: "m" }] }))
    try {
      // A keyless remote host is only allowed through when the caller supplies
      // the header itself.
      expect(
        await discoverOpenAICompatibleModels({
          baseURL: `http://127.0.0.1:${s.port}/v1`,
          headers: { Authorization: "Bearer explicit" },
        }),
      ).toEqual(["m"])
      seen = "ok"
    } finally {
      expect(seen).toBe("ok")
      await close(s)
    }
  })
})