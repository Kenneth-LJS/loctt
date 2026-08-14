import { initLoctt } from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";

/**
 * Flags `init` accepts. `--project-key` is deliberately absent: it was
 * documented and parsed but could never work, since `projects.yaml`
 * stores no slug. Passing it now fails rather than being ignored.
 */
const INIT_FLAGS = ["prefix", "project-label", "timezone", "no-docs"] as const;

/**
 * `loctt init` — bootstrap a new tracker at the current cwd (or
 * `--cwd <dir>`). Idempotent against an existing `.loctt/`: core's
 * `initLoctt` is the source of truth for what's already in place
 * and only writes the missing files.
 */
export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, INIT_FLAGS);
  const prefix = getArg(args, "--prefix") ?? "T-";
  // Names the starting project. Core calls this `projectName`; the flag
  // stays `--project-label` because that is what is documented.
  const projectLabel = getArg(args, "--project-label");
  const docs = !hasFlag(args, "--no-docs");
  // Workspace timezone. Defaults to this machine's zone, recorded into
  // calendar.yaml so it stays the same for everyone on the tracker.
  const timezone = getArg(args, "--timezone");
  const result = await initLoctt(root, {
    prefix,
    docs,
    ...(projectLabel ? { projectName: projectLabel } : {}),
    ...(timezone ? { timezone } : {}),
  });
  console.log(`Initialized .loctt at ${result.locttDir}`);
  console.log(`Created ${result.created.length} files`);
}
