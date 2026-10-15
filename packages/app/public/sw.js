/* OpenCode PWA service worker — bump CACHE_VERSION when strategies change. */
const CACHE_VERSION = "v2"
const SHELL_CACHE = `oc-shell-${CACHE_VERSION}`
const ASSET_CACHE = `oc-assets-${CACHE_VERSION}`
const STATIC_CACHE = `oc-static-${CACHE_VERSION}`

// keep in sync with API_PREFIX in opencode-web/serve-ui-build.js: same-origin API is never cached
const API_PREFIX = new Set([
  "agent", "api", "auth", "command", "config", "doc", "event", "experimental",
  "file", "find", "formatter", "global", "instance", "log", "lsp", "mcp",
  "path", "permission", "project", "provider", "pty", "pwa", "question", "session",
  "skill", "sync", "tui", "vcs",
])

const SHELL_URLS = ["/", "/site.webmanifest", "/oc-theme-preload.js"]
const HASHED_ASSET = /-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|otf|png|svg|jpe?g|gif|webp|ico)$/i
const PENDING_CACHE = "oc-pending"
const PENDING_URL = "/__notification-click"

// iOS drops notification.data and ignores openWindow URLs in some versions.
// Keep the last push/click target in Cache Storage so the notification click
// handler and the app on cold start can both recover the exact session URL.
async function writePending(payload) {
  try {
    const cache = await caches.open(PENDING_CACHE)
    await cache.put(PENDING_URL, new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }))
  } catch {
    undefined
  }
}

async function readPending() {
  try {
    const cache = await caches.open(PENDING_CACHE)
    const response = await cache.match(PENDING_URL)
    if (!response) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

// Same-origin diagnostics: lets the server log which click stages actually ran
// on the device (iOS silently no-ops parts of the notification-click path).
function debugBeacon(data) {
  try {
    void fetch("/pwa/push/debug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    })
  } catch {
    undefined
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("oc-") && ![SHELL_CACHE, ASSET_CACHE, STATIC_CACHE, PENDING_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (API_PREFIX.has(url.pathname.split("/").filter(Boolean)[0] || "")) return

  const store = (name, request, response) => {
    if (!response || !response.ok) return
    void caches.open(name).then((cache) => cache.put(request, response.clone()))
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          store(SHELL_CACHE, "/", response)
          return response
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    )
    return
  }

  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            store(ASSET_CACHE, request, response)
            return response
          }),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          store(STATIC_CACHE, request, response)
          return response
        })
        .catch(() => cached ?? Response.error())
      return cached ?? network
    }),
  )
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const url = data.url || "/"
  event.waitUntil(
    Promise.all([
      writePending({ url, ts: Date.now(), clicked: false }),
      self.registration.showNotification(data.title || "OpenCode", {
        body: data.body || "",
        icon: "/web-app-manifest-192x192.png",
        badge: "/favicon-96x96-v3.png",
        tag: data.tag,
        data: { url },
      }),
    ]),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const direct = event.notification.data && event.notification.data.url
      const pending = direct ? undefined : await readPending()
      const url = direct || (pending && pending.url) || "/"
      // Mark the click so a cold-started app can deep-link itself even when
      // iOS ignored the URL above or dropped notification.data entirely.
      await writePending({ url, ts: Date.now(), clicked: true })
      // BroadcastChannel reaches open pages without relying on matchAll /
      // postMessage, which iOS handles unreliably from notification clicks.
      try {
        const channel = new BroadcastChannel("opencode-push")
        channel.postMessage({ type: "opencode:notification-click", url })
        channel.close()
      } catch {
        undefined
      }
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      debugBeacon({ stage: "sw-click", url, direct: !!direct, clients: clients.length })
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "opencode:notification-click", url })
          if ("navigate" in client) void client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
