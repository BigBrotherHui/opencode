# Notification-click browser matrix

Run from `packages/app`, with the built web UI and API already available:

```sh
bunx playwright install webkit
node e2e/notification-click/browser-matrix.cjs
```

The default target is `http://127.0.0.1:3000`. Override it with
`OPENCODE_TEST_UI`. Edge must be installed. Two existing top-level sessions are
required. The test only reads sessions; it does not submit prompts, interrupt
sessions, create subscriptions, or send system notifications.

Each engine uses an isolated temporary browser context. The test loads the real
app, registers its real service worker with a test-only handler capture, switches
sessions in the running page, and invokes the captured production click handler.
It checks the resulting URL and unexpected page errors.

## What this proves

- The app can consume a notification target while already viewing another session.
- The production click handler and running-page navigation cooperate in Edge
  and the installed desktop WebKit build.

## What this does not prove

- Delivery of an OS `notificationclick` event on an installed iOS PWA.
- Correctness of the iOS notification banner or notification-center integration.
- The session's visible content matching the URL in every layout state.

Desktop WebKit is not iPhone Safari. Its Windows build does not expose
`PushManager` here. A passing matrix must not be reported as an iOS push-tap fix.
Do not use a synthetic `dispatchEvent(new NotificationEvent(...))` as an OS-tap
test: the untrusted event has different service-worker lifetime semantics.
