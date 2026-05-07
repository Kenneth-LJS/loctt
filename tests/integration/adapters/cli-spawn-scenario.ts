import type { ScenarioAdapter } from "../scenarios/types.js";
import { opToCliArgs } from "./cli-in-process.js";
import { runCli } from "./cli-spawn.js";

/**
 * Drives the real CLI binary via execa. Slowest of the three adapters
 * but exercises argv parsing and exit-code handling that in-process
 * skips.
 */
export const cliSpawnAdapter: ScenarioAdapter = {
  name: "cli-spawn",

  async run(ops, root) {
    for (const op of ops) {
      const args = opToCliArgs(op);
      const result = await runCli(args, { cwd: root });
      if (result.exitCode !== 0) {
        throw new Error(
          `cli-spawn: op ${JSON.stringify(op)} exited ${result.exitCode}\nstderr: ${result.stderr}`,
        );
      }
    }
  },
};
