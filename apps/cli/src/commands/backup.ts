import { resolve as resolvePath } from "node:path";

import {
  EXCLUSION_REASONS,
  exportBackup,
  resolveLocttDir,
  restoreBackup,
  type RestoreMode,
} from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";

const EXPORT_FLAGS: readonly string[] = ["--output", "--no-history", "--split-bytes"];
const RESTORE_FLAGS: readonly string[] = ["--merge", "--overwrite", "--dry-run"];

/**
 * `loctt backup <file>` — write a JSONL backup (K4 ruling 3).
 *
 * The whole tracker, not just tasks (K17 ruling 2): frontmatter, body,
 * comments, attachments, history, config and `state.yaml`. The CSV
 * export stays a report for a human in a spreadsheet and is untouched
 * by this.
 */
export async function backup(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, EXPORT_FLAGS);
  // `args[0]` is the subcommand itself, matching every other command
  // here. `args.find(a => !a.startsWith("-"))` returned "backup" and
  // silently wrote a file of that name, reporting success.
  const output = getArg(args, "--output") ?? args[1];
  if (output === undefined || output.length === 0) {
    throw new UsageError("usage: loctt backup <file> [--no-history] [--output <file>]");
  }
  // `Number("abc")` is NaN, and a NaN threshold compares false against
  // everything — so the export would never split and would report
  // success. A flag that silently does nothing is the defect PRU-C9
  // fixed on the entity commands.
  const splitRaw = getArg(args, "--split-bytes");
  let splitBytes: number | undefined;
  if (splitRaw !== undefined) {
    splitBytes = Number(splitRaw);
    if (!Number.isFinite(splitBytes) || !Number.isInteger(splitBytes) || splitBytes < 1) {
      throw new UsageError(
        `--split-bytes must be a positive whole number of bytes; got '${splitRaw}'`,
      );
    }
  }
  const locttDir = resolveLocttDir(root);

  const report = await exportBackup(locttDir, {
    outputPath: resolvePath(root, output),
    includeHistory: !hasFlag(args, "--no-history"),
    ...(splitBytes !== undefined ? { splitThresholdBytes: splitBytes } : {}),
  });

  for (const f of report.files) console.log(`Wrote ${f}`);
  // The size cost is reported because a base64 attachment makes it
  // non-obvious (BAK-C6).
  console.log(
    `${String(report.tasks)} task${report.tasks === 1 ? "" : "s"}, `
    + `${String(report.configs)} config file${report.configs === 1 ? "" : "s"}, `
    + `${String(report.users)} user${report.users === 1 ? "" : "s"}`,
  );
  console.log(`Size: ${String(report.bytes)} bytes`);
  console.log(`Schema version: ${String(report.schemaVersion)}`);
  console.log(
    report.includedHistory
      ? "History: included"
      : "History: excluded (--no-history)",
  );
  // Listed by the export itself, so a new exclusion cannot be added
  // silently (BAK-C1).
  console.log("Excluded from this backup:");
  for (const path of report.excluded) {
    const why = EXCLUSION_REASONS[path];
    console.log(`  ${path}${why !== undefined ? ` — ${why}` : ""}`);
  }
}

/**
 * `loctt restore <file...>` — read one back (K17 ruling 2).
 *
 * Bare refuses a non-empty tracker; `--merge` adds only absent ids;
 * `--overwrite` replaces the ids the backup carries and preserves any
 * body it displaces.
 */
export async function restore(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, RESTORE_FLAGS);
  // Skip `args[0]`, the subcommand. Every remaining positional is a
  // part of the backup set.
  const files = args.slice(1).filter(a => !a.startsWith("-"));
  if (files.length === 0) {
    throw new UsageError(
      "usage: loctt restore <file...> [--merge | --overwrite] [--dry-run]",
    );
  }
  const merge = hasFlag(args, "--merge");
  const overwrite = hasFlag(args, "--overwrite");
  if (merge && overwrite) {
    throw new UsageError("--merge and --overwrite are mutually exclusive.");
  }
  const mode: RestoreMode = merge ? "merge" : overwrite ? "overwrite" : "bare";
  const dryRun = hasFlag(args, "--dry-run");
  const locttDir = resolveLocttDir(root);

  const report = await restoreBackup(
    locttDir,
    files.map(f => resolvePath(root, f)),
    { mode, dryRun },
    // Printed as each task is read, so the first line appears before
    // the file has been fully consumed (BAK-C19).
    id => { if (!dryRun) console.log(`Restoring ${id}`); },
  );

  console.log(dryRun ? `Dry run (${mode}), nothing written:` : `Restored (${mode}):`);
  console.log(`  created: ${String(report.created)}`);
  console.log(`  skipped: ${String(report.skipped)}`);
  console.log(`  overwritten: ${String(report.overwritten)}`);
  for (const r of report.reallocatedKeys) {
    console.log(`  key reallocated: ${r.from} -> ${r.to}`);
  }
  for (const r of report.reassignedPrefixes) {
    console.log(`  prefix reassigned: ${r.project}: ${r.from} -> ${r.to}`);
  }
  for (const r of report.reassignedSlugs) {
    console.log(`  slug reassigned: ${r.project}: ${r.from} -> ${r.to}`);
  }
  for (const r of report.renamedEntities) {
    console.log(`  renamed ${r.type}: ${r.from} -> ${r.to}`);
  }
  // The mode that can lose work says exactly what it displaced (K17
  // ruling 6).
  for (const d of report.displacedBodies) {
    console.log(`  displaced body for ${d.taskId} kept at ${d.path}`);
  }
  for (const b of report.badLines) {
    console.log(`  skipped malformed line ${String(b.line)} in ${b.file}: ${b.reason}`);
  }
}
