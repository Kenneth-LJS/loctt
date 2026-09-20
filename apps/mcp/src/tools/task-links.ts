/**
 * Relationship tools — bilateral write/remove. Both call into
 * `linkTask`/`unlinkTask` which handle the cycle check (for
 * structural rels), the archived-target guard, and writing both
 * sides of the edge in one state-locked transaction.
 */

import { bulkLink, loadOptionalConfigs, lookupTask, unlinkTask } from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "link_tasks",
    description:
      "Add a relationship from one or more source tasks to a single target, " +
      "writing both sides of each edge in one transaction. Structural " +
      "relationship types are cycle-checked and a link is rejected if it " +
      "would create a loop; linking an archived target is also refused. Pass " +
      "several refs to link them all to the target as one operation (a " +
      "shared bulk_op_id); each edge is committed independently, so a bad " +
      "source or a rejected edge is reported without aborting the rest. An " +
      "unresolvable target fails every source, since each edge would fail " +
      "identically.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Source task keys or IDs. Capped at 500."),
      type: z.string().describe("Relationship type (e.g. parent, blocks)"),
      target: z.string().describe("Target task key or ID — every source links to this one"),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const relType = args["type"] as string;
      const result = await bulkLink({
        locttDir,
        taskRefs: refs,
        type: relType,
        target: args["target"] as string,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      });
      const lines = [
        `Linked ${result.succeeded.length}, failed ${result.failed.length} `
        + `--${relType}--> ${args["target"] as string} (bulk_op_id ${result.bulk_op_id})`,
      ];
      for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
      // Any failed edge is an error (parity with the CLI's non-zero exit):
      // a single-ref link to a bad target/type/cycle must surface as
      // isError, not a success the caller has to introspect.
      return result.failed.length > 0 ? errorResult(lines.join("\n")) : text(lines.join("\n"));
    },
  },
  {
    name: "unlink_tasks",
    description:
      "Remove a relationship between two tasks, clearing both sides of the " +
      "edge in one transaction. Refused if the edge does not exist, but a " +
      "target that was deleted out of band is tolerated so a dangling edge " +
      "can still be cleaned up.",
    inputSchema: {
      ref: z.string(),
      type: z.string(),
      target: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const target = await lookupTask(locttDir, args["target"] as string);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const relType = args["type"] as string;
      await unlinkTask({
        locttDir,
        taskId: task.frontmatter.id,
        type: relType,
        target: target.frontmatter.id,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      });
      return text(`Unlinked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
    },
  },
];
