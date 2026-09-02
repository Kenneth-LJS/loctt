/**
 * Attachment tools. `attach_file` copies a local file in;
 * `detach_file` removes one by basename. Paths must be absolute on
 * the MCP server's filesystem — the agent's cwd assumption is
 * brittle so we reject relative paths up front rather than
 * resolving against an arbitrary value.
 */

import { isAbsolute } from "node:path";

import {
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  detachFile,
  lookupTask,
} from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "attach_file",
    description: "Copy a local file into a task's attachments directory. Only file paths are supported in v1 (no base64 content); the file must be readable from the MCP server's filesystem.",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      source_path: z.string().describe("Absolute path to the file to attach. Must be absolute — the MCP server's cwd is not guaranteed to match the agent's mental model."),
      force: z.boolean().optional().describe("If true, overwrite an existing attachment with the same basename."),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const sourcePath = args["source_path"] as string;
      if (!isAbsolute(sourcePath)) {
        return errorResult("source_path must be absolute");
      }
      const force = (args["force"] as boolean | undefined) ?? false;
      try {
        const result = await attachFile({
          locttDir,
          taskId: task.frontmatter.id,
          sourcePath,
          force,
        });
        return text(JSON.stringify({
          name: result.name,
          size: result.size,
          overwritten: result.overwritten,
          task_key: task.frontmatter.key,
        }, null, 2));
      } catch (err) {
        if (err instanceof AttachmentExistsError) {
          // Kept: this arm ADDS something the dispatcher cannot — the
          // `force: true` remedy. The AttachmentSourceError arm beside
          // it only re-wrapped `err.message`, which
          // `runtime/errors.ts` already does for every class in
          // KNOWN_DOMAIN_ERRORS, AttachmentSourceError included.
          return errorResult(`${err.message}. Pass force: true to overwrite.`);
        }
        throw err;
      }
    },
  },
  {
    name: "detach_file",
    description: "Remove a file from a task's attachments directory.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      name: z.string().describe("Basename of the attachment, no path separators"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const name = args["name"] as string;
      try {
        await detachFile({
          locttDir,
          taskId: task.frontmatter.id,
          name,
        });
        return text(`Detached ${name} from ${task.frontmatter.key}`);
      } catch (err) {
        if (err instanceof AttachmentNotFoundError) {
          return errorResult(err.message);
        }
        throw err;
      }
    },
  },
];
