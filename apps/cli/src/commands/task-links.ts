import { linkTask, loadOptionalConfigs, lookupTask, resolveLocttDir, unlinkTask } from "@loctt/core";

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
  const targetTask = await lookupTask(locttDir, target);
  await unlinkTask({
    locttDir,
    taskId: task.frontmatter.id,
    type: relType,
    target: targetTask.frontmatter.id,
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
  });
  console.log(`Unlinked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
}
