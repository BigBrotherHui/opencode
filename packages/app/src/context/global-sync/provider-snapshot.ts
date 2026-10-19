import type { ModelDefaultOutput, ModelListOutput, ProviderListOutput } from "@opencode-ai/client/promise"
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client"

// The catalog is the largest payload the app downloads: with a few hundred providers
// it reaches several megabytes, which costs seconds on a relayed link and costs the
// same again every time the app is reopened. The raw transport payload is kept on disk
// so an open can skip the request entirely; every event that used to invalidate the
// query also drops the snapshot, so a changed catalog is never served from here.
export type ProviderSnapshot =
  | { protocol: "v1"; payload: ProviderListResponse }
  | {
      protocol: "v2"
      providers: ProviderListOutput["data"]
      models: ModelListOutput["data"]
      defaultModel: ModelDefaultOutput["data"]
    }

export type StoredProviderSnapshot = ProviderSnapshot & { version: number; savedAt: number }

// Long enough to cover a working session, short enough that a snapshot whose
// invalidation event was missed cannot outlive a restart by much.
export const PROVIDER_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000

const VERSION = 1
const DATABASE = "opencode-provider-snapshots"
const STORE = "snapshots"

export function freshProviderSnapshot(savedAt: number, now: number) {
  const age = now - savedAt
  return age >= 0 && age <= PROVIDER_SNAPSHOT_MAX_AGE_MS
}

let opening: Promise<IDBDatabase | undefined> | undefined

function database(): Promise<IDBDatabase | undefined> {
  if (opening) return opening
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined)
  opening = new Promise<IDBDatabase | undefined>((resolve) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () => resolve(undefined))
    request.addEventListener("blocked", () => resolve(undefined))
  })
  return opening
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const connection = await database()
  if (!connection) return undefined
  return new Promise<T | undefined>((resolve) => {
    let request: IDBRequest<T>
    try {
      request = work(connection.transaction(STORE, mode).objectStore(STORE))
    } catch {
      // A closed or upgraded connection throws synchronously; a missing snapshot is
      // only a cache miss, so the caller falls back to the network.
      resolve(undefined)
      return
    }
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () => resolve(undefined))
  })
}

export async function readProviderSnapshot(key: string): Promise<StoredProviderSnapshot | undefined> {
  const value = await transaction<StoredProviderSnapshot | undefined>(
    "readonly",
    (objectStore) => objectStore.get(key) as IDBRequest<StoredProviderSnapshot | undefined>,
  )
  if (!value || typeof value !== "object" || value.version !== VERSION) return undefined
  if (typeof value.savedAt !== "number") return undefined
  return value
}

export async function writeProviderSnapshot(key: string, snapshot: ProviderSnapshot) {
  const stored: StoredProviderSnapshot = { ...snapshot, version: VERSION, savedAt: Date.now() }
  await transaction("readwrite", (objectStore) => objectStore.put(stored, key) as IDBRequest<IDBValidKey>)
}

export async function clearProviderSnapshots() {
  await transaction("readwrite", (objectStore) => objectStore.clear() as IDBRequest<undefined>)
}
