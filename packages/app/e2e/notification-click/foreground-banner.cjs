const assert = require("node:assert/strict")
const { chromium, webkit } = require("@playwright/test")
const origin = process.env.OPENCODE_TEST_UI || "http://127.0.0.1:3000"

async function run() {
  const response = await fetch(new URL("/session", origin))
  assert(response.ok)
  const sessions = (await response.json()).filter((session) => !session.parentID && session.directory)
  assert(sessions.length >= 2)
  const target = sessions[0]
  const other = sessions[1]
  const href = (session) => `/${Buffer.from(session.directory).toString("base64url")}/session/${session.id}`
  for (const [name, engine, options] of [["Edge", chromium, { channel: "msedge" }], ["WebKit", webkit, {}]]) {
    const browser = await engine.launch(options)
    try {
      const context = await browser.newContext({ viewport: { width: 430, height: 900 } })
      await context.addInitScript(({ target }) => {
        const original = window.fetch.bind(window)
        window.fetch = (request, init) => {
          const url = new URL(typeof request === "string" ? request : request.url ?? String(request), location.href)
          if (url.pathname !== "/global/event") return original(request, init)
          return Promise.resolve(new Response(new ReadableStream({
            start(controller) {
              const encode = (payload) => new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
              controller.enqueue(encode({ payload: { type: "server.connected", properties: {} } }))
              window.addEventListener("test-session-complete", () => controller.enqueue(encode({
                directory: target.directory,
                payload: { id: "foreground-banner-test", type: "session.idle", properties: { sessionID: target.id } },
              })))
            },
          }), { headers: { "content-type": "text/event-stream" } }))
        }
      }, { target })
      const page = await context.newPage()
      await page.goto(new URL(href(other), origin).href, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(6000)
      await page.evaluate(() => window.dispatchEvent(new Event("test-session-complete")))
      const banner = page.getByText(target.title, { exact: true }).last()
      await banner.waitFor({ state: "visible", timeout: 10000 })
      const open = page.getByRole("button", { name: /^(Open|打开)$/ }).last()
      await open.click()
      await page.waitForURL((url) => url.pathname === href(target), { timeout: 15000 })
      console.log(`PASS ${name}: completion banner opens exact session using document navigation`)
    } finally {
      await browser.close()
    }
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
