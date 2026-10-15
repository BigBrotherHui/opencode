import { createSharedValue, type SharedTransport } from "./shared-value"

// Pinned sessions are shared with every client connected to the server, so a phone
// and a desktop agree on which sessions are pinned. Synced as a list of session IDs;
// the local store keeps the same IDs as a record for O(1) lookup.
export const SHARED_PINS_SCOPE = "session-pins"

export function parseSharedPins(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const ids = input.filter((id): id is string => typeof id === "string" && id.length > 0)
  if (ids.length !== input.length) return undefined
  return [...new Set(ids)]
}

// Pin order is not meaningful, so equality is a set comparison.
export function samePins(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

// Keeps the pending order and appends local-only pins, so the first device to sync
// cannot erase a pin another device already had.
export function mergePins(pending: string[], local: string[]) {
  const seen = new Set(pending)
  return [...pending, ...local.filter((id) => !seen.has(id))]
}

export function createSharedPins(input: {
  transport: SharedTransport
  onError?: (error: unknown) => void
}) {
  return createSharedValue<string[]>({
    scope: SHARED_PINS_SCOPE,
    parse: parseSharedPins,
    transport: input.transport,
    onError: input.onError,
  })
}
