/**
 * `npm run seed:upgrade` — brings the checked-in seed tracker to the
 * code's format version through the tracker's OWN upgrade path
 * (`loctt migrate`), never by regenerating it: the seed's history,
 * ids and timestamps survive, exactly as a user's tracker would.
 *
 * Today the format has one version, so this is a no-op; B41 adds the
 * 0.1.0 → 0.3.0 step (K142, K143) and this script picks it up unchanged.
 *
 * Works on a temp copy and replaces the seed only when the upgraded copy
 * is doctor-clean, so a failed upgrade never leaves a half-written seed.
 */

import { readFileSync } from "node:fs";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { seedIndexPath, seedLoctt } from "../lib/paths.ts";
import { freshTracker, loadSeedIndex, removeTracker } from "../lib/seed.ts";
import { doctorFindings, runCliArgv } from "../lib/surfaces.ts";

async function main(): Promise<void> {
  const index = loadSeedIndex();
  const before = readFileSync(path.join(seedLoctt, ".schema-version"), "utf-8").trim();
  const root = await freshTracker(index, "seed-upgrade");
  try {
    const res = await runCliArgv(["migrate", "--yes"], root);
    if (res.stdout.trim()) console.log(res.stdout.trimEnd());
    if (res.stderr.trim()) console.error(res.stderr.trimEnd());
    if (res.exitCode !== 0) throw new Error(`loctt migrate exited ${res.exitCode}; the seed was not changed`);

    const after = readFileSync(path.join(root, ".loctt/.schema-version"), "utf-8").trim();
    if (after === before) {
      console.log(`Seed already at format version ${before}; nothing to upgrade.`);
      return;
    }

    const findings = await doctorFindings(root);
    if (findings.length > 0) {
      throw new Error(`the upgraded seed is not doctor-clean; the seed was not changed:\n${findings.join("\n")}`);
    }

    // Strip what a checkout does not carry (see build-seed.ts).
    await rm(path.join(root, ".loctt/.current-user"), { force: true });
    await rm(path.join(root, ".loctt/local"), { recursive: true, force: true });
    for (const id of await readdir(path.join(root, ".loctt/users"))) {
      await rm(path.join(root, ".loctt/users", id, "settings.yaml"), { force: true });
    }

    await rm(seedLoctt, { recursive: true, force: true });
    await cp(path.join(root, ".loctt"), seedLoctt, { recursive: true });
    await writeFile(seedIndexPath, `${JSON.stringify({ ...index, format_version: after }, null, 2)}\n`, "utf-8");
    console.log(`Seed upgraded: format ${before} → ${after}. Review and check in tests/fixtures/trackers/seed/.`);
  } finally {
    await removeTracker(root);
  }
}

await main();
