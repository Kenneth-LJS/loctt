import { initLoctt } from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";

/**
 * Flags `init` accepts. `--project-key` is deliberately absent: it was
 * documented and parsed but could never work, since `projects.yaml`
 * stores no slug. Passing it now fails rather than being ignored.
 */
const INIT_FLAGS = ["prefix", "project-label", "timezone", "no-docs", "repair", "json", "quiet"] as const;

/**
 * `loctt init` — bootstrap a new tracker at the current cwd (or
 * `--cwd <dir>`). Idempotent against an existing `.loctt/`: core's
 * `initLoctt` is the source of truth for what's already in place
 * and only writes the missing files.
 */
export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, INIT_FLAGS);
  // K88: the prefix is bare uppercase letters; the "-" is inserted at key
  // render. Default is "T" (was "T-"), producing keys like "T-1".
  const prefix = getArg(args, "--prefix") ?? "T";
  // Names the starting project. Core calls this `projectName`; the flag
  // stays `--project-label` because that is what is documented.
  const projectLabel = getArg(args, "--project-label");
  const docs = !hasFlag(args, "--no-docs");
  // Workspace timezone. Defaults to this machine's zone, recorded into
  // calendar.yaml so it stays the same for everyone on the tracker.
  const timezone = getArg(args, "--timezone");
  // Restores files missing from an existing tracker rather than
  // refusing. Never overwrites what survived, so it cannot cost the user
  // their tasks — which refusing did, since the only route back was
  // deleting the directory (ONB-C3).
  const repair = hasFlag(args, "--repair");
  // Output modes. `--json` emits a machine-readable summary and no prose;
  // `--quiet` suppresses the human guidance (the "Next steps" block and
  // the summary lines) while leaving errors intact. Neither changes what
  // init writes to disk.
  const json = hasFlag(args, "--json");
  const quiet = hasFlag(args, "--quiet");
  const result = await initLoctt(root, {
    prefix,
    docs,
    ...(repair ? { repair: true } : {}),
    ...(projectLabel ? { projectName: projectLabel } : {}),
    ...(timezone ? { timezone } : {}),
  });
  if (json) {
    console.log(JSON.stringify({
      repaired: repair,
      locttDir: result.locttDir,
      created: result.created,
      stateRebuilt: result.created.includes("state.yaml"),
    }, null, 2));
    return;
  }
  if (repair) {
    if (quiet) return;
    console.log(`Repaired .loctt at ${result.locttDir}`);
    console.log(
      result.created.length > 0
        ? `Restored ${String(result.created.length)} file(s): ${result.created.join(", ")}`
        : "Nothing to restore",
    );
    if (result.created.includes("state.yaml")) {
      // Key counters restart at 1, which would reissue keys already on
      // disk. Say so rather than leaving it to be discovered.
      console.log("state.yaml was rebuilt — run 'loctt doctor --rebuild-index' to resync key allocation");
    }
    return;
  }
  if (quiet) return;
  console.log(`Initialized .loctt at ${result.locttDir}`);
  console.log(`Created ${result.created.length} files`);
  // Next steps — orient a first-time user who has nothing but a fresh
  // tracker. Suppressed by --json/--quiet above.
  console.log("");
  console.log("Next steps:");
  console.log("  Create a task:   loctt create \"<title>\"");
  console.log("  Open the web UI: loctt ui");
  if (docs) {
    // The helper docs only exist when --no-docs was not passed.
    console.log("  Read the docs:   .loctt/docs/");
  }
}
