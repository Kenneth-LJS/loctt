/**
 * `npm run seed:upgrade` — brings the checked-in seed tracker to the
 * code's format version through the tracker's OWN upgrade path
 * (`loctt migrate`), never by regenerating it: the seed's history,
 * ids and timestamps survive, exactly as a user's tracker would.
 *
 * B41 ran it for the first real step, 0.1.0 → 0.3.0 (K142, K143). The
 * 0.1.0 seed is kept frozen at tests/fixtures/trackers/seed-0.1.0/ for
 * the upgrade tests.
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

    // A checkout carries no key index (`.loctt/local/` is not checked in),
    // so doctor always says so on a fresh copy: the one finding in the
    // pristine baseline (README, "The seed"). Anything else fails.
    const findings = (await doctorFindings(root)).filter(f => !/^! key index: no index on disk/.test(f));
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
