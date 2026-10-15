// Read-only live-app check. Run from packages/app with its built UI served.
// This invokes the production SW handler; it does not simulate an OS tap.
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")
const { chromium, webkit } = require("@playwright/test")

const origin = process.env.OPENCODE_TEST_UI || "http://127.0.0.1:3000"
const workerPath = path.resolve(__dirname, "../../public/sw.js")

async function run() {
  const response = await fetch(new URL("/session", origin))
  assert(response.ok, `Session listing failed: ${response.status}`)
  const sessions = (await response.json()).filter((session) => !session.parentID && session.directory)
  assert(sessions.length >= 2, "This read-only test needs two existing top-level sessions")
  const href = (session) => `/${Buffer.from(session.directory).toString("base64url")}/session/${session.id}`
  const target = href(sessions[0])
  const other = href(sessions[1])

  for (const [name, engine, options] of [
    ["Edge", chromium, { channel: "msedge" }],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch(options)
    try {
      const context = await browser.newContext({ viewport: { width: 430, height: 900 } })
      // Capture the real handler during registration, then invoke it using a
      // test-only message. dispatchEvent(NotificationEvent) creates an untrusted
      // ExtendableEvent whose lifetime differs from an actual notification tap.
      await context.route("**/sw.js", async (route) => {
        const source = fs.readFileSync(workerPath, "utf8")
        const prefix = `
const originalAdd = self.addEventListener.bind(self);
self.addEventListener = (type, handler, ...rest) => {
  if (type === "notificationclick") self.testClickHandler = handler;
  return originalAdd(type, handler, ...rest);
};
`
        const suffix = `
self.addEventListener("message", event => {
  if (event.data.type !== "TEST_NOTIFICATION_CLICK") return;
  const jobs = [];
  self.testClickHandler({
    notification: { data: { url: event.data.url }, tag: "local-regression", close() {} },
    waitUntil: promise => jobs.push(promise),
  });
  event.waitUntil(Promise.all(jobs));
});
`
        await route.fulfill({ contentType: "application/javascript", body: prefix + source + suffix })
      })
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", (error) => {
        if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message)
      })
      await page.goto(new URL(target, origin).href, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.waitForTimeout(2500)

      // A live-page session switch, not a new page or cold launch.
      await page.evaluate((url) => {
        const link = document.createElement("a")
        link.href = url
        document.body.append(link)
        link.click()
        link.remove()
      }, other)
      await page.waitForURL((url) => url.pathname === other)
      await page.evaluate((url) => navigator.serviceWorker.ready.then((registration) => {
        registration.active.postMessage({ type: "TEST_NOTIFICATION_CLICK", url })
      }), target)
      await page.waitForURL((url) => url.pathname === target, { timeout: 10000 })
      assert.deepEqual(errors, [], `${name}: unexpected page errors`)
      console.log(`PASS ${name}: switch sessions in a live page, then handle notification click`)
    } finally {
      await browser.close()
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
