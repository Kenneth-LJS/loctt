import { migrateToCurrent, planMigration, resolveLocttDir } from "@loctt/core";

import { hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmInteractive } from "../runtime/confirm.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt migrate` — apply pending schema migrations.
 *
 * `--dry-run` prints the plan and exits without applying. With no
 * pending steps the command prints "already at vN" and exits 0.
 * Without `--yes`, prompts before applying — accepts a refusal as
 * EXIT.SUCCESS so scripts don't false-alarm on a clean "no".
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
const ACCEPTED_FLAGS: readonly string[] = ["--dry-run", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const dryRun = hasFlag(args, "--dry-run");
  const skipPrompt = hasFlag(args, "--yes");

  const plan = await planMigration(locttDir);
  if (plan.steps.length === 0) {
    console.log(`Schema is already at v${plan.to}. Nothing to do.`);
    return;
  }

  console.log(`LocTT schema migration`);
  console.log(``);
  console.log(`  Current version: ${plan.from}`);
  console.log(`  Target version:  ${plan.to}`);
  console.log(``);
  console.log(`Migrations to run:`);
  for (const step of plan.steps) {
    const tags: string[] = [];
    if (step.deprecated) tags.push("deprecated");
    if (step.risky) tags.push("risky");
    const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
    console.log(`  v${step.from} → v${step.to}  ${step.description}${tagStr}`);
  }
  console.log(``);

  if (dryRun) {
    console.log(`Dry run only — no changes made.`);
    return;
  }

  if (!skipPrompt) {
    const ok = await confirmInteractive(
      `This will back up .loctt/ and apply the migrations above. Proceed?`,
    );
    if (!ok) {
      console.log(`Aborted.`);
      // User declined, not an error: exit 0 so scripts don't
      // false-alarm on a clean refusal.
      process.exitCode = EXIT.SUCCESS;
      return;
    }
  }

  const result = await migrateToCurrent(locttDir);
  if (result.backupPath) {
    console.log(`Backup written to ${result.backupPath}`);
  }
  console.log(``);
  let i = 1;
  for (const step of result.steps) {
    console.log(`[${i}/${result.steps.length}] v${step.from} → v${step.to}  ${step.description}`);
    i += 1;
  }
  console.log(``);
  console.log(`Migration complete. Schema is now v${result.to}.`);
  if (result.backupPath) {
    console.log(`You can delete ${result.backupPath} once you've verified everything works.`);
  }
}
