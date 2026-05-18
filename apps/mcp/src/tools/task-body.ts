/**
 * Body-write tools. `replace_task_body` overwrites the markdown
 * body; `append_task_body` adds text with the canonical separator
 * blank line so the agent doesn't have to manage spacing.
 */

import { appendTaskBody, lookupTask, writeTaskBody } from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "append_task_body",
    description: "Append text to a task's markdown body.",
    inputSchema: {
      ref: z.string(),
      text: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await appendTaskBody(locttDir, task.frontmatter.id, args["text"] as string);
      return text(`Appended to ${task.frontmatter.key} body.`);
    },
  },
  {
    name: "replace_task_body",
    description: "Replace a task's entire markdown body.",
    inputSchema: {
      ref: z.string(),
      body: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await writeTaskBody(locttDir, task.frontmatter.id, (args["body"] as string) + "\n");
      return text(`Replaced ${task.frontmatter.key} body.`);
    },
  },
];
