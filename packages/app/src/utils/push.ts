// Web Push subscription plumbing. The server side is the opencode-web push
// daemon (GET /pwa/push/key, POST /pwa/push/{subscribe,unsubscribe}); deployments
// without it (desktop renderer, opencode.ai) fail the fetch and the feature
// silently stays off.
const BASE = "/pwa/push"

let queue: Promise<void> = Promise.resolve()
let cachedKey: Uint8Array<ArrayBuffer> | undefined

export function requestPushPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve(false)
  if (Notification.permission !== "default") return Promise.resolve(Notification.permission === "granted")
  return Notification.requestPermission()
    .then((result) => result === "granted")
    .catch(() => false)
}

export function syncPushSubscription(enabled: boolean): Promise<void> {
  queue = queue
    .catch(() => undefined)
    .then(() => reconcile(enabled))
    .catch(() => undefined)
  return queue
}

async function reconcile(enabled: boolean) {
  if (!import.meta.env.PROD) return
  if (typeof window === "undefined" || !window.isSecureContext) return
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration?.active) return

  const existing = await registration.pushManager.getSubscription().catch(() => null)
  if (!enabled) {
    if (!existing) return
    await existing.unsubscribe().catch(() => undefined)
    await post("unsubscribe", { endpoint: existing.endpoint })
    return
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return
  const key = await getVapidKey()
  if (!key) return

  // subscribe() returns the existing subscription when the key matches; it
  // rejects when a subscription with a different key exists, so rotate once.
  let subscription = await registration.pushManager
    .subscribe({ userVisibleOnly: true, applicationServerKey: key })
    .catch(() => null)
  if (!subscription && existing) {
    await existing.unsubscribe().catch(() => undefined)
    subscription = await registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .catch(() => null)
  }
  if (!subscription) return
  await post("subscribe", subscription.toJSON())
}

async function getVapidKey() {
  if (cachedKey) return cachedKey
  const response = await fetch(`${BASE}/key`).catch(() => undefined)
  if (!response?.ok) return undefined
  const payload = (await response.json().catch(() => undefined)) as { publicKey?: string } | undefined
  if (!payload?.publicKey) return undefined
  cachedKey = decodeBase64Url(payload.publicKey)
  return cachedKey
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const raw = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes
}

function post(path: string, body: unknown) {
  return fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

const PENDING_CACHE = "oc-pending"
const PENDING_KEY = "/__notification-click"
const PENDING_FRESH_MS = 5 * 60 * 1000

// The service worker records notification clicks in Cache Storage because iOS
// may drop notification.data and ignore openWindow URLs. Consume it once on
// boot: only entries explicitly marked as clicked and fresh are honored.
export async function consumePendingNotificationClick(): Promise<string | undefined> {
  if (typeof caches === "undefined") return undefined
  try {
    const cache = await caches.open(PENDING_CACHE)
    const response = await cache.match(PENDING_KEY)
    if (!response) return undefined
    await cache.delete(PENDING_KEY)
    const payload = (await response.json()) as { url?: string; ts?: number; clicked?: boolean }
    if (!payload || payload.clicked !== true || typeof payload.url !== "string") return undefined
    if (!payload.ts || Date.now() - payload.ts > PENDING_FRESH_MS) return undefined
    return payload.url
  } catch {
    return undefined
  }
}

export async function clearPendingNotificationClick(): Promise<void> {
  if (typeof caches === "undefined") return
  try {
    await (await caches.open(PENDING_CACHE)).delete(PENDING_KEY)
  } catch {
    undefined
  }
}
