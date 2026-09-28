/**
 * Fixed locations the runthrough harness works from.
 *
 * Kept in one module so the runner and the seed
 * scripts cannot disagree about where the seed lives or which binary
 * they drive.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");

/** The directory that holds the seed's `.loctt/` and `seed-index.json`. */
export const seedRoot = path.join(repoRoot, "tests/fixtures/trackers/seed");
export const seedLoctt = path.join(seedRoot, ".loctt");
export const seedIndexPath = path.join(seedRoot, "seed-index.json");

/** The seed frozen at format 0.1.0, for the upgrade cases (B41). */
export const frozenSeedLoctt = path.join(repoRoot, "tests/fixtures/trackers/seed-0.1.0/.loctt");

export const casesRoot = path.join(repoRoot, "tests/runthrough/cases");

/** Per-test temp trackers are created here (gitignored). */
export const workspaceRoot = path.join(repoRoot, "tests/workspace");
export const TEMP_PREFIX = "rt-";
