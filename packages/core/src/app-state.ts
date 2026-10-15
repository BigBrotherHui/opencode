export * as AppState from "./app-state"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { AppStateTable } from "./app-state/sql"

export interface Interface {
  /** Returns the shared value for a scope, or undefined when never written. */
  readonly get: (scope: string) => Effect.Effect<unknown>
  /** Replaces the shared value for a scope and returns the stored value. */
  readonly set: (scope: string, value: unknown) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AppState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      get: Effect.fn("AppState.get")(function* (scope) {
        const row = yield* db
          .select({ value: AppStateTable.value })
          .from(AppStateTable)
          .where(eq(AppStateTable.scope, scope))
          .get()
          .pipe(Effect.orDie)
        return row?.value
      }),
      set: Effect.fn("AppState.set")(function* (scope, value) {
        yield* db
          .insert(AppStateTable)
          .values({ scope, value })
          .onConflictDoUpdate({ target: AppStateTable.scope, set: { value } })
          .run()
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
