// Shared state that round-trips through the server's global app-state routes so
// every client connected to it sees the same value. The server stores the value
// verbatim, so the shape and validation are owned entirely by the caller.
export type SharedTransport = {
  readonly read: (scope: string) => Promise<unknown>
  readonly write: (scope: string, value: unknown) => Promise<void>
}

// A server that predates this feature returns 404 or a non-JSON body; either way the
// caller falls back to local-only behavior instead of surfacing an error. An unseeded
// scope (the server has never been written) is distinct from an unsupported one: the
// caller seeds it with its own local value instead of adopting an empty one.
export function createSharedValue<T>(input: {
  scope: string
  parse: (value: unknown) => T | undefined
  transport: SharedTransport
  onError?: (error: unknown) => void
}) {
  let available: boolean | undefined
  let pending: T | undefined
  let flushing = false

  const flush = async () => {
    if (flushing) return
    flushing = true
    try {
      while (pending !== undefined) {
        const value = pending
        pending = undefined
        await input.transport.write(input.scope, value)
      }
    } catch (error) {
      input.onError?.(error)
    } finally {
      flushing = false
    }
  }

  return {
    async load() {
      try {
        const value = await input.transport.read(input.scope)
        if (value === null) {
          available = true
          return { remote: undefined, unseeded: true } as const
        }
        const parsed = input.parse(value)
        if (!parsed) {
          available = false
          return undefined
        }
        available = true
        return { remote: parsed, unseeded: false } as const
      } catch (error) {
        available = false
        input.onError?.(error)
        return undefined
      }
    },
    // Publishes the local value so a server that has none starts from this device.
    // An empty value is skipped so a fresh device cannot wipe a populated scope.
    seed(value: T) {
      if (available !== true) return
      if (Array.isArray(value) && value.length === 0) return
      pending = value
      void flush()
    },
    push(value: T) {
      if (available !== true) return
      pending = value
      void flush()
    },
    // Another client announced a write; re-read instead of trusting the event payload
    // so a partially applied write cannot corrupt the local value. A null value keeps
    // the local value, because the caller's seed path handles an unseeded scope.
    async adopt() {
      if (available !== true) return undefined
      try {
        const value = await input.transport.read(input.scope)
        if (value === null) return undefined
        return input.parse(value)
      } catch (error) {
        input.onError?.(error)
        return undefined
      }
    },
  }
}
