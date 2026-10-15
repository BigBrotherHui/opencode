import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import { Timestamps } from "../database/schema.sql"

// Shared key/value state for clients connected to the same server, namespaced by
// scope. Kept deliberately untyped at the storage layer: each scope owns the shape
// of its own value, so adding a new shared client preference needs no migration.
export const AppStateTable = sqliteTable("app_state", {
  scope: text().primaryKey(),
  value: text({ mode: "json" }).$type<unknown>().notNull(),
  ...Timestamps,
})
