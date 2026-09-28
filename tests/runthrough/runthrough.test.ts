/**
 * `npm run test:runthrough` — every case in `tests/runthrough/cases/`,
 * on each of its surfaces, against a fresh copy of the seed tracker
 * (K144, B42). The seed-version guard runs in `global-setup.ts`, before
 * anything is collected.
 *
 * CLI first (Ken, B42): for each case the CLI run goes first and the MCP
 * run starts only after it has finished — never interleaved. The CLI is
 * the simplest deterministic path over the same core, so a core bug shows
 * there; an MCP failure after a CLI failure is marked as such, so one
 * core bug reads as one bug, not two. Different cases still run in
 * parallel.
 *
 * Titles read `<case-id> [<surface>] #tag…`, so `-t` filters by any of
 * them: `npm run test:runthrough -- -t "#b39"`.
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { formatFailure, runCase } from "./lib/execute.ts";
import { loadAllCases } from "./lib/load.ts";
import { freshTracker, loadSeedIndex, removeTracker } from "./lib/seed.ts";
import { doctorFindings } from "./lib/surfaces.ts";

const cases = loadAllCases();
const seed = loadSeedIndex();
let baseline: string[] = [];
const kept: string[] = [];

beforeAll(async () => {
  // Doctor's findings on the pristine seed: a step fails only on a
  // finding that was not already here.
  const root = await freshTracker(seed, "doctor-baseline");
  try {
    baseline = await doctorFindings(root);
  } finally {
    await removeTracker(root);
  }
});

afterAll(() => {
  if (kept.length > 0) {
    console.log(`\nTrackers of failed runs were kept for inspection:\n  ${kept.join("\n  ")}`);
  }
});

describe.concurrent("runthrough", () => {
  for (const c of cases) {
    // Settles when this case's CLI run has finished: true = it passed.
    let cliDone: (passed: boolean) => void = () => undefined;
    const cliResult = new Promise<boolean>(resolve => { cliDone = resolve; });
    if (!c.surfaces.includes("cli")) cliDone(true);

    for (const surface of c.surfaces) {
      const tags = c.tags.map(t => ` #${t}`).join("");
      const bug = c.knownBug[surface];
      const title = `${c.id} [${surface}]${tags}${bug !== undefined ? ` (known bug: ${bug})` : ""}`;
      // RT_KNOWN_BUGS=show runs known-bug cases as ordinary tests, so
      // their failures print (to confirm they fail for the stated reason).
      const test = bug !== undefined && process.env["RT_KNOWN_BUGS"] !== "show" ? it.fails : it;
      test(title, async () => {
        let cliPassed = true;
        if (surface === "mcp") cliPassed = await cliResult;
        let failures: Awaited<ReturnType<typeof runCase>>["failures"] = [];
        let root = "";
        try {
          ({ failures, root } = await runCase(c, surface, seed, baseline));
        } finally {
          // Unblock the MCP run even when the CLI run threw.
          if (surface === "cli") cliDone(failures.length === 0 && root !== "");
        }
        if (failures.length > 0) {
          kept.push(root);
          const after = !cliPassed
            ? `AFTER CLI FAILURE — the CLI run of ${c.id} failed first; read that one before this.\n`
            : "";
          throw new Error(`${after}${c.name}\n${failures.map(formatFailure).join("\n\n")}\n\n(tracker kept at ${root})`);
        }
        if (!cliPassed) console.log(`${c.id} [mcp] passed after CLI failure: the CLI-side defect is not in core.`);
        await removeTracker(root);
      });
    }
  }
});
