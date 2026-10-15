import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013161008_add_app_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`app_state\` (
          \`scope\` text PRIMARY KEY,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
