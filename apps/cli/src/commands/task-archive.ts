import { archiveTask, bulkArchive, lookupTask, resolveLocttDir, unarchiveTask } from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";
import { reportBulk, splitRefs } from "./task-crud.js";

/**
 * `loctt archive <task>` — soft delete (reversible).
 */
/**
 * Accepted flags per command. `getArg`/`hasFlag` are pure extractors and
 * cannot notice a flag nobody asked about, so without this an unknown
 * option is silently dropped and the command runs without it.
 */
const ARCHIVE_FLAGS: readonly string[] = [];
const UNARCHIVE_FLAGS: readonly string[] = [];

/**
 * `loctt archive <task>[,<task>...]` — soft delete (reversible).
 *
 * Multiple comma-separated refs archive as one bulk operation
 * (single lock, shared bulk_op_id), mirroring `set`/`move`. The
 * single-ref path is kept for its friendlier message.
 */
export async function archive(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ARCHIVE_FLAGS);
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt archive <task>[,<task>...]");
  const locttDir = resolveLocttDir(root);
  const refs = splitRefs(ref);

  if (refs.length > 1) {
    const result = await bulkArchive({ locttDir, taskRefs: refs, archive: true });
    reportBulk("Archived", result);
    return;
  }

  const task = await lookupTask(locttDir, refs[0] as string);
  await archiveTask(locttDir, task.frontmatter.id);
  console.log(`Archived ${task.frontmatter.key}`);
}

/**
 * `loctt unarchive <task>[,<task>...]` — restore archived task(s).
 */
export async function unarchive(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, UNARCHIVE_FLAGS);
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt unarchive <task>[,<task>...]");
  const locttDir = resolveLocttDir(root);
  const refs = splitRefs(ref);

  if (refs.length > 1) {
    const result = await bulkArchive({ locttDir, taskRefs: refs, archive: false });
    reportBulk("Unarchived", result);
    return;
  }

  const task = await lookupTask(locttDir, refs[0] as string);
  await unarchiveTask(locttDir, task.frontmatter.id);
  console.log(`Unarchived ${task.frontmatter.key}`);
}
