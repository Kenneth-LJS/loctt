import { migrateToCurrent, planMigration, resolveLocttDir } from "@loctt/core";

import { hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt migrate` — upgrade the tracker's format, deliberately (K154).
 *
 * Every other command refuses an older tracker and points here. This
 * command shows a preview (from → to, each step and what it changes in
 * plain words, a step marked risky, and where the backup goes), then
 * asks to confirm:
 *
 *  - `--dry-run` prints the preview only and changes nothing.
 *  - `--yes` skips the prompt (scripts).
 *  - At a terminal, anything but `y`/`yes` declines: exit 0, nothing
 *    changed.
 *  - Not at a terminal and no `--yes`: refused, naming the flag, exit 2
 *    (the script forgot it), nothing changed.
 *
 * With no pending steps it prints "already at format X" and exits 0.
 *
 * Flags this command accepts. Without the check an unrecognised flag
 * was silently dropped (PRU-C9).
 */
const ACCEPTED_FLAGS: readonly string[] = ["--dry-run", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const dryRun = hasFlag(args, "--dry-run");

  const plan = await planMigration(locttDir);
  if (plan.steps.length === 0) {
    console.log(`This tracker is already at format ${plan.to}. Nothing to do.`);
    return;
  }

  console.log(`This tracker needs upgrading from ${plan.from} to ${plan.to}.`);
  console.log(``);
  console.log(`Steps:`);
  plan.steps.forEach((step, i) => {
    const tags: string[] = [];
    if (step.risky === true) tags.push("risky");
    if (step.deprecated === true) tags.push("deprecated");
    const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
    console.log(`  ${String(i + 1)}. ${step.from} → ${step.to}  ${step.description}${tagStr}`);
    if (step.changes !== undefined) console.log(`     ${step.changes}`);
  });
  console.log(``);
  console.log(`Before any step runs, .loctt/ is copied to a backup beside it:`);
  console.log(`  ${locttDir}.backup-v${plan.from}-<date and time>`);
  console.log(``);

  if (dryRun) {
    console.log(`Dry run. Nothing was changed.`);
    return;
  }

  const outcome = await confirmHardDelete(args, `Upgrade this tracker now?`);
  if (outcome === "refused") {
    // Not a terminal and no --yes: the script forgot the flag. The
    // refusal line (naming --yes) is already on stderr.
    process.exitCode = EXIT.USAGE;
    return;
  }
  if (outcome === "no") {
    console.log(`Not upgraded. Nothing was changed.`);
    // User declined, not an error: exit 0 so scripts don't
    // false-alarm on a clean refusal.
    process.exitCode = EXIT.SUCCESS;
    return;
  }

  const result = await migrateToCurrent(locttDir);
  if (result.steps.length === 0) {
    // Another upgrade (a second `loctt migrate`, the web button) finished
    // while this one waited for the lock: nothing left to run.
    console.log(`This tracker is already at format ${result.to}. Nothing to do.`);
    return;
  }
  if (result.backupPath !== undefined) {
    console.log(`Backup written to ${result.backupPath}`);
  }
  let i = 1;
  for (const step of result.steps) {
    console.log(`[${String(i)}/${String(result.steps.length)}] ${step.from} → ${step.to}  ${step.description}`);
    i += 1;
  }
  console.log(`Upgraded this tracker from ${result.from} to ${result.to}.`);
  if (result.backupPath !== undefined) {
    console.log(`You can delete ${result.backupPath} once you've checked everything works.`);
  }
}
