// Join identical per-directory requests that start in the same burst.
//
// TanStack Query collapses queries that share a key, but this app mounts two scopes for
// the same server (the global store and the directory/child store), so the same request
// can be issued twice within a few milliseconds under two different keys. On a fast link
// that costs nothing; over a relayed phone link every duplicate is a wasted round trip
// and a wasted copy of a multi-kilobyte payload.
//
// The map is keyed by the request itself rather than by a query key: that is what the
// duplicate callers share, and it stays correct no matter how their scopes differ.
const inflight = new Map<string, Promise<unknown>>()

export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const started = run().finally(() => {
    if (inflight.get(key) === started) inflight.delete(key)
  })
  inflight.set(key, started)
  return started
}

export function resetInflight() {
  inflight.clear()
}
