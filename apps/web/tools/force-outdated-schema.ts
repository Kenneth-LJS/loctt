#!/usr/bin/env tsx
/**
 * One-off review fixture for T0.5. Rewrites the .schema-version file
 * in the given tracker so the API reports `schemaStatus: outdated`.
 * Running the schema banner's "Migrate now" button (or `loctt
 * migrate`) restores the tracker to the current version.
 *
 * Usage:
 *   npm --workspace=apps/web exec -- tsx tools/force-outdated-schema.ts /path/to/tracker
 *
 * Not a long-term affordance — meant to be run during T0.5 review,
 * then forgotten. The script lives in apps/web/tools/ so it's
 * obvious it isn't production code.
 */

import process from "node:process";

import {
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  resolveLocttDir,
  writeSchemaVersion,
} from "@loctt/core";

const root = process.argv[2];
if (!root) {
  console.error("usage: tsx tools/force-outdated-schema.ts <tracker-root>");
  process.exit(1);
}

const locttDir = resolveLocttDir(root);
const target = CURRENT_SCHEMA_VERSION - 1;
if (target < 1) {
  console.error(`Can't force-downgrade: current schema is v${CURRENT_SCHEMA_VERSION}, no older version exists.`);
  process.exit(1);
}
const before = await readSchemaVersion(locttDir);
await writeSchemaVersion(locttDir, target);
console.log(`Rewrote ${locttDir}/.schema-version: v${before ?? "(missing)"} → v${target}`);
console.log(`The API will now report schemaStatus: outdated (current=v${CURRENT_SCHEMA_VERSION}).`);
console.log(`Click "Migrate now" in the web app or run \`loctt migrate\` to restore.`);
