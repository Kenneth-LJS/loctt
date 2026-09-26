/**
 * Body-write tools. `replace_task_body` overwrites the markdown
 * body; `append_task_body` adds text with the canonical separator
 * blank line so the agent doesn't have to manage spacing.
 *
 * Both take an optional `expected_token` (K10). Ken's ruling:
 * "agents via mcp and existing scripts should pass it if its provided
 * in params." An agent reads a task before writing it, so `get_task`
 * hands back `body_token` and passing it costs nothing — and it is
 * what stops an agent silently overwriting a human's concurrent edit.
 * Omitted, the write is last-write-wins, as it has always been.
 */

import { appendTaskBody, lookupTask, withTrailingNewline, writeTaskBody } from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

const EXPECTED_TOKEN_DESC
  = "The `body_token` from your `get_task` read. When given, the write is "
  + "refused if the task changed in between, and nothing is written. Pass it "
  + "whenever you have it. Omitting it overwrites concurrent edits silently.";

/** `{ expectedToken }` when the arg is a usable string, else `{}`. */
function tokenOpts(args: Record<string, unknown>): { expectedToken?: string } {
  const v = args["expected_token"];
  return typeof v === "string" && v !== "" ? { expectedToken: v } : {};
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "append_task_body",
    description:
      "Append text to a task's markdown body, inserting the canonical " +
      "separator blank line so you need not manage spacing. Pass " +
      "`expected_token` (from get_task) to make the write fail rather than " +
      "silently clobber a concurrent edit.",
    inputSchema: {
      ref: z.string(),
      text: z.string(),
      expected_token: z.string().optional().describe(EXPECTED_TOKEN_DESC),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await appendTaskBody(
        locttDir, task.frontmatter.id, args["text"] as string, tokenOpts(args),
      );
      return text(`Appended to ${task.frontmatter.key} body.`);
    },
  },
  {
    name: "replace_task_body",
    description:
      "Replace a task's entire markdown body, overwriting whatever was " +
      "there. Pass `expected_token` (from get_task) to make the write fail " +
      "rather than silently clobber a concurrent edit.",
    inputSchema: {
      ref: z.string(),
      body: z.string(),
      expected_token: z.string().optional().describe(EXPECTED_TOKEN_DESC),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      await writeTaskBody(
        locttDir, task.frontmatter.id, withTrailingNewline(args["body"] as string), tokenOpts(args),
      );
      return text(`Replaced ${task.frontmatter.key} body.`);
    },
  },
];
