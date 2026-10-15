- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## The Phone / Web UI Target

The user's phone UI is served at **`http://100.124.192.60:3000/`** (Tailscale IP). Do not confuse it with other local ports.

Topology — `C:\Users\Administrator\opencode-web`:

- `start-opencode-ui.ps1` runs `serve-ui-build.js` as `0.0.0.0:3000`.
- It serves the **production build** at `D:\PrivateProject\opencode\packages\app\dist`, not the Vite dev server. Vite answers one request per source module (~478 files), which never finishes over a Tailscale relay, so the dev server is unusable from the phone.
- `/api`, `/global`, `/session`, `/event` and friends are **same-origin proxied** to `127.0.0.1:3910` (`OC_UI_API_PORT`), so there is no CORS hop on this path.
- The script starts the API on `3910` from **source** by default (`bun run ./src/index.ts serve` in `packages/opencode`), so local server changes reach the phone too. `-InstalledBackend` switches to the published `opencode-ai` binary, which cannot carry local server changes. Both read the same `~/.local/share/opencode/opencode.db`.

Consequences when editing the UI or server:

- Nothing under `packages/app/src` reaches the phone until `build-opencode-ui.ps1` rebuilds `packages/app/dist`; `start-opencode-ui.ps1 -Rebuild` does build and restart in one step.
- Server changes need only a restart of `start-opencode-ui.ps1` (default source backend). Do not run `start-opencode-web.ps1` for phone work: it pins the installed binary and bypasses the built UI.

The desktop app (`packages/desktop/dist/win-unpacked/OpenCode Dev.exe`) is pointed at the same API process as the phone — `defaultServerUrl = http://127.0.0.1:3910` in `%APPDATA%\ai.opencode.desktop.dev\opencode.settings` — so one server owns the session, every client shares its event stream, and running a turn on either side streams to the other. The opened-project list additionally travels through the server-side `app_state` scope `projects` (`packages/app/src/context/global-sync/shared-projects.ts`).

- Both values must be set together. `defaultServerUrl` alone fails with `Permission server not found`: the URL must also be registered in the server list persisted in `opencode.global.dat` (`server` key, as `{ type: "http", http: { url } }`).
- The desktop app still forks an idle sidecar on a random port; it keeps working without 3910, but its sessions would then be invisible to the phone again. Nothing needs to be built for config-only changes.
- `C:\Users\Administrator\opencode-web\start-opencode-ui-if-needed.ps1` starts the API at logon and exits immediately when 3000/3910 already answer, so it never kills a session started by hand. It is wired through a Startup-folder launcher. Do not schedule `start-opencode-ui.ps1` directly for this: it always stops whatever holds those ports first.
- Desktop changes reach that exe only after `bun script/build-node.ts` in `packages/opencode`, then `bunx electron-vite build` and `bunx electron-builder --win --dir` in `packages/desktop` (skipping `prebuild` avoids re-downloading the bundled CLI).
- Restarting the API drops every client's stream; both reconnect on their own, so a restart is safe but interrupts in-flight turns' live view for a moment.

## Cost of a Refresh on the Phone

The phone reaches the UI over a Tailscale relay (~400 ms RTT), so what matters is bytes and request count, not local render time. Measured with the page's own resource timing:

- The JS/CSS are already cached by the browser (`immutable` hashed URLs), so a refresh costs no static bytes. The cost is the API burst: ~50 requests.
- `/provider` is the dominant single response (7 MB uncompressed, 404 KB gzipped). Only the global entry is fetched at startup. The per-directory entry is lazy: `childStore.activateProviders()` gates it, and the model pickers call `useActivateProviders()` when they open. Verified identical bytes across directories, so the lazy window shows the global catalog rather than nothing.
- Requests for one key are collapsed by a module-level in-flight map in `loadProvidersQuery`: query functions start in separate microtask turns, and TanStack Query does not always join them even within `staleTime`.
- Directory-scoped query keys must go through `scopedKey` in `packages/app/src/context/global-sync/bootstrap.ts`. Callers pass either the raw worktree or `directoryKey`; on Windows those spellings differ (`D:\x` vs `D:/x`), and an unnormalized key caches one project's data twice and fetches it twice.
- `selectProviderCatalog` falls back to the global catalog for directory-scoped callers while the directory catalog is unresolved. Do not restore the old "return empty for explicit callers" behavior: with a lazy catalog it blanks model names and the picker.
- Prefetching nearby sessions is bounded by `prefetchChunk` in `packages/app/src/pages/layout.tsx`; it is deliberately the first-screen size (20), not a session's whole history.
- `scripts` in `C:\Users\Administrator\opencode-web` gzip both static assets and API responses, so a payload measurement must go through curl (or press through a proxy) — `fetch` in the page transparently decodes and reports inflated sizes.

## Tailscale Link Quality

The phone's page load is dominated by the Tailscale path, not by the server. Check `tailscale status` for `direct` vs `relay`: a relayed path costs ~400 ms RTT versus ~40 ms direct, and the UI feels broken on it.

- Hole punching can silently regress to a relay (`CurAddr` empty, `Relay: sin`). Running `tailscale ping <phone-ip>` re-triggers the probe and usually restores the direct path within a few pongs.
- `tailscale netcheck` reporting a changing public UDP port while `MappingVariesByDestIP` is false indicates CGNAT; punching then depends on the phone side. The phone must be off Wi-Fi (or on a network that allows it) — a Wi-Fi plus cellular combination was what prevented the phone from advertising any endpoint.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
