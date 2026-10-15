export * as AppState from "./app-state"

import { Schema } from "effect"
import { define, inventory } from "./event"

// Broadcast after any client writes shared app state, so every other client on the
// same server can refresh without polling. Carries only the scope; readers re-fetch
// the value because a scope's payload shape is owned by its writer.
const Updated = define({
  type: "app-state.updated",
  schema: { scope: Schema.String },
})
export const Event = { Updated, Definitions: inventory(Updated) }
