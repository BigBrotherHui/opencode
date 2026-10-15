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
            .filter((key) => key.startsWith("oc-") && ![SHELL_CACHE, ASSET_CACHE, STATIC_CACHE].includes(key))
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
  event.waitUntil(
    self.registration.showNotification(data.title || "OpenCode", {
      body: data.body || "",
      icon: "/web-app-manifest-192x192.png",
      badge: "/favicon-96x96-v3.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) void client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
