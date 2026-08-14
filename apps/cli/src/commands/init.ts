import { initLoctt } from "@loctt/core";

import { getArg, hasFlag } from "../runtime/args.js";

/**
 * `loctt init` — bootstrap a new tracker at the current cwd (or
 * `--cwd <dir>`). Idempotent against an existing `.loctt/`: core's
 * `initLoctt` is the source of truth for what's already in place
 * and only writes the missing files.
 */
export async function run(args: string[], root: string): Promise<void> {
  const prefix = getArg(args, "--prefix") ?? "T-";
  const projectKey = getArg(args, "--project-key");
  const projectLabel = getArg(args, "--project-label");
  const docs = !hasFlag(args, "--no-docs");
  // Workspace timezone. Defaults to this machine's zone, recorded into
  // calendar.yaml so it stays the same for everyone on the tracker.
  const timezone = getArg(args, "--timezone");
  const result = await initLoctt(root, {
    prefix,
    docs,
    ...(projectKey ? { projectKey } : {}),
    ...(projectLabel ? { projectLabel } : {}),
    ...(timezone ? { timezone } : {}),
  });
  console.log(`Initialized .loctt at ${result.locttDir}`);
  console.log(`Created ${result.created.length} files`);
}
