import { describe, expect, test } from "bun:test"
import {
  PROVIDER_SNAPSHOT_MAX_AGE_MS,
  clearProviderSnapshots,
  freshProviderSnapshot,
  readProviderSnapshot,
  writeProviderSnapshot,
} from "./provider-snapshot"

describe("provider snapshot", () => {
  test("accepts a snapshot inside the freshness window", () => {
    const savedAt = 1_000_000
    expect(freshProviderSnapshot(savedAt, savedAt)).toBe(true)
    expect(freshProviderSnapshot(savedAt, savedAt + PROVIDER_SNAPSHOT_MAX_AGE_MS)).toBe(true)
  })

  test("rejects a snapshot past the freshness window", () => {
    const savedAt = 1_000_000
    expect(freshProviderSnapshot(savedAt, savedAt + PROVIDER_SNAPSHOT_MAX_AGE_MS + 1)).toBe(false)
  })

  test("rejects a snapshot saved in the future", () => {
    expect(freshProviderSnapshot(2_000_000, 1_000_000)).toBe(false)
  })

  // The storage layer is IndexedDB, which this runtime does not provide. A cache miss
  // has to be silent: every caller falls back to the network request it always made.
  test("falls back to a cache miss without indexedDB", async () => {
    expect(await readProviderSnapshot("missing")).toBeUndefined()
    await writeProviderSnapshot("missing", { protocol: "v1", payload: {} as never })
    expect(await readProviderSnapshot("missing")).toBeUndefined()
    await clearProviderSnapshots()
  })
})
