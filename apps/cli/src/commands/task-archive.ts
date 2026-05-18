import { archiveTask, lookupTask, resolveLocttDir, unarchiveTask } from "@loctt/core";

import { UsageError } from "../runtime/errors.js";

/**
 * `loctt archive <task>` — soft delete (reversible).
 */
export async function archive(args: string[], root: string): Promise<void> {
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt archive <task>");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  await archiveTask(locttDir, task.frontmatter.id);
  console.log(`Archived ${task.frontmatter.key}`);
}

/**
 * `loctt unarchive <task>` — restore an archived task.
 */
export async function unarchive(args: string[], root: string): Promise<void> {
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt unarchive <task>");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  await unarchiveTask(locttDir, task.frontmatter.id);
  console.log(`Unarchived ${task.frontmatter.key}`);
}
