import { runDoctor } from "@loctt/core";

import { hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt doctor` — diagnostic checks. With `--rebuild-index`,
 * rebuilds the key-lookup cache after out-of-band frontmatter
 * edits (the one drift case LocTT can't auto-detect).
 *
 * Exit code is EXIT.RUNTIME (1) if any check is `error`; warnings
 * still exit 0 so CI can treat them as informational.
 */
/**
 * Flags this command family accepts. A union across its
 * subcommands: they share one argv, so splitting per subcommand
 * would reject a sibling's valid flag.
 *
 * Without this an unrecognised flag was silently dropped — the
 * reference documented `--label` on project create for a flag the
 * CLI never read, so the worked example created a project named
 * `web` and discarded the label (PRU-C9).
 */
const ACCEPTED_FLAGS: readonly string[] = ["--rebuild-index"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const rebuildIndex = hasFlag(args, "--rebuild-index");
  const checks = await runDoctor(root, { rebuildIndex });
  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }
  const hasError = checks.some(c => c.status === "error");
  if (hasError) process.exitCode = EXIT.RUNTIME;
}
