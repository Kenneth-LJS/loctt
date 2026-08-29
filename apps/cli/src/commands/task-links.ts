import { linkTask, loadOptionalConfigs, lookupTask, resolveLocttDir, TaskNotFoundError, unlinkTask } from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { UsageError } from "../runtime/errors.js";
import { assertWorkflowRelationshipKey } from "../runtime/workflow-assert.js";

/**
 * `loctt link <task> <relationship> <target>` — bilateral relationship
 * write. Pre-validates the relationship type against the workflow
 * so an unknown type surfaces as a "Known: ..." UsageError rather
 * than a deeper core throw.
 */
/**
 * Accepted flags per command. `getArg`/`hasFlag` are pure extractors and
 * cannot notice a flag nobody asked about, so without this an unknown
 * option is silently dropped and the command runs without it.
 */
const LINK_FLAGS: readonly string[] = [];
const UNLINK_FLAGS: readonly string[] = [];

export async function link(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, LINK_FLAGS);
  const ref = args[1];
  const relType = args[2];
  const target = args[3];
  if (!ref || !relType || !target) {
    throw new UsageError("missing args", "loctt link <task> <relationship> <target>");
  }
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  assertWorkflowRelationshipKey(workflowConfig, relType);
  const task = await lookupTask(locttDir, ref);
  const targetTask = await lookupTask(locttDir, target);
  await linkTask({
    locttDir,
    taskId: task.frontmatter.id,
    type: relType,
    target: targetTask.frontmatter.id,
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
  });
  console.log(`Linked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
}

/**
 * `loctt unlink <task> <relationship> <target>` — bilateral relationship
 * removal. Same validation pattern as `link`.
 */
export async function unlink(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, UNLINK_FLAGS);
  const ref = args[1];
  const relType = args[2];
  const target = args[3];
  if (!ref || !relType || !target) {
    throw new UsageError("missing args", "loctt unlink <task> <relationship> <target>");
  }
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  assertWorkflowRelationshipKey(workflowConfig, relType);
  const task = await lookupTask(locttDir, ref);
  // A dangling edge is exactly what unlink is for, so resolving the
  // target must not be a precondition. `lookupTask` threw here, which
  // meant the one operation that cleans up after a deletion was the
  // one a deletion made impossible — REL-24 requires the broken row to
  // be removable. The web route already tolerates this; the CLI did
  // not, and a core fix that only one surface can reach is not a fix.
  //
  // Falls back to the ref as given, which is the stored id on a
  // dangling edge. A ref that is neither a live task nor an id on this
  // task's edges still fails, from core, with "relationship ... does
  // not exist on task ...".
  let targetId = target;
  try {
    targetId = (await lookupTask(locttDir, target)).frontmatter.id;
  } catch (err) {
    if (!(err instanceof TaskNotFoundError)) throw err;
  }
  await unlinkTask({
    locttDir,
    taskId: task.frontmatter.id,
    type: relType,
    target: targetId,
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
  });
  // The target's key, when it still has one. A dangling edge has no
  // task to read a key from, so the id it stored is the honest thing
  // to echo — inventing a key for a task that no longer exists would
  // be worse than showing the id the user is removing.
  let targetLabel = targetId;
  try {
    targetLabel = (await lookupTask(locttDir, targetId)).frontmatter.key;
  } catch (err) {
    if (!(err instanceof TaskNotFoundError)) throw err;
  }
  console.log(`Unlinked ${task.frontmatter.key} --${relType}--> ${targetLabel}`);
}
