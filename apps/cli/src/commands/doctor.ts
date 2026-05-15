import { runDoctor } from "@loctt/core";

import { hasFlag } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt doctor` — diagnostic checks. With `--rebuild-index`,
 * rebuilds the key-lookup cache after out-of-band frontmatter
 * edits (the one drift case LocTT can't auto-detect).
 *
 * Exit code is EXIT.RUNTIME (1) if any check is `error`; warnings
 * still exit 0 so CI can treat them as informational.
 */
export async function run(args: string[], root: string): Promise<void> {
  const rebuildIndex = hasFlag(args, "--rebuild-index");
  const checks = await runDoctor(root, { rebuildIndex });
  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }
  const hasError = checks.some(c => c.status === "error");
  if (hasError) process.exitCode = EXIT.RUNTIME;
}
