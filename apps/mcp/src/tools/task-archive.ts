/**
 * Task archive/unarchive — the soft-delete pair. Archived tasks
 * stay on disk and remain searchable but are hidden from default
 * list/show surfaces and are blocked from new references by the
 * archived-reference guard.
 */

import { archiveTask, lookupTask, unarchiveTask } from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "archive_task",
    description:
      "Archive a task (the reversible soft-delete; use delete_task for the " +
      "hard, irreversible variant). The task stays on disk and remains " +
      "searchable but is hidden from default list/show surfaces and is " +
      "blocked as the target of new relationships. Reverse with " +
      "unarchive_task.",
    inputSchema: {
      ref: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await archiveTask(locttDir, task.frontmatter.id);
      return text(`Archived ${task.frontmatter.key}.`);
    },
  },
  {
    name: "unarchive_task",
    description:
      "Clear a task's archived flag, restoring it to default list/show " +
      "surfaces and allowing it as a relationship target again.",
    inputSchema: {
      ref: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await unarchiveTask(locttDir, task.frontmatter.id);
      return text(`Unarchived ${task.frontmatter.key}.`);
    },
  },
];
