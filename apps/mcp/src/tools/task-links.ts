/**
 * Relationship tools — bilateral write/remove. Both call into
 * `linkTask`/`unlinkTask` which handle the cycle check (for
 * structural rels), the archived-target guard, and writing both
 * sides of the edge in one state-locked transaction.
 */

import { linkTask, loadOptionalConfigs, lookupTask, unlinkTask } from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "link_tasks",
    description: "Add a relationship between tasks.",
    inputSchema: {
      ref: z.string(),
      type: z.string().describe("Relationship type (e.g. parent, blocks)"),
      target: z.string().describe("Target task key or ID"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const target = await lookupTask(locttDir, args["target"] as string);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const relType = args["type"] as string;
      await linkTask({
        locttDir,
        taskId: task.frontmatter.id,
        type: relType,
        target: target.frontmatter.id,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      });
      return text(`Linked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
    },
  },
  {
    name: "unlink_tasks",
    description: "Remove a relationship between tasks.",
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
