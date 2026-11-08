import { v1 } from "./v1.js";
import { v2 } from "./v2.js";
import { v3 } from "./v3.js";
import { v4 } from "./v4.js";

// Ordered, forward-only upgrade steps. The database version is the last step's version.
// Rules: never edit or remove a step that has shipped; steps must only add stores/indexes
// or transform data without losing any (proved by tests/upgrade.test.js).
export const UPGRADES = [v1, v2, v3, v4];
export const DB_VERSION = UPGRADES[UPGRADES.length - 1].version;

/** Run every step with oldVersion < step.version <= newVersion, in order. */
export function runUpgrades(db, tx, oldVersion, newVersion, steps = UPGRADES) {
  for (const step of steps) {
    if (step.version > oldVersion && step.version <= newVersion) step.up(db, tx);
  }
}
