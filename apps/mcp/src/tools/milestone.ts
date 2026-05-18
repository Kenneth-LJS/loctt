/**
 * Milestone catalog tools. Milestones live in milestones.yaml and
 * each task carries a single `milestone` key (nullable). Delete
 * supports remap_to or unset across affected tasks.
 */

import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  loadMilestonesConfig,
  unarchiveMilestone,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_milestones",
    description: "List milestones defined in milestones.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadMilestonesConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
  {
    name: "create_milestone",
    description: "Register a new milestone with optional target date.",
    inputSchema: {
      key: z.string(),
      label: z.string(),
      target_date: z.string().optional().describe("YYYY-MM-DD"),
    },
    handler: async ({ locttDir }, args) => {
      const td = args["target_date"] as string | undefined;
      await createMilestone(locttDir, {
        key: args["key"] as string,
        label: args["label"] as string,
        ...(td !== undefined ? { target_date: td } : {}),
      });
      return text(`Created milestone ${String(args["key"])}`);
    },
  },
  {
    name: "edit_milestone",
    description: "Edit a milestone. Pass null target_date to clear.",
    inputSchema: {
      key: z.string(),
      label: z.string().optional(),
      target_date: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const td = args["target_date"] as string | null | undefined;
      const archived = args["archived"] as boolean | undefined;
      await editMilestone(locttDir, args["key"] as string, {
        ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
        ...("target_date" in args ? { target_date: td ?? null } : {}),
        ...(archived !== undefined ? { archived } : {}),
      });
      return text(`Updated milestone ${String(args["key"])}`);
    },
  },
  {
    name: "delete_milestone",
    description:
      "Permanently remove a milestone from milestones.yaml. The `milestone` field on each " +
      "affected task is unset or remapped via `remap_to`. Use `archive_milestone` for the " +
      "reversible (soft) variant. Always requires `confirm: true`.",
    inputSchema: {
      key: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target milestone key for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_milestone");
      if (blocked) return blocked;
      const remapTo = args["remap_to"] as string | undefined;
      const result = await deleteMilestone(locttDir, args["key"] as string, {
        hard: true,
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      return text(JSON.stringify({
        key: args["key"],
        ...result,
      }, null, 2));
    },
  },
  {
    name: "archive_milestone",
    description: "Mark a milestone as archived. Reversible via `unarchive_milestone`.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await archiveMilestone(locttDir, args["key"] as string);
      return text(`Archived milestone ${String(args["key"])}`);
    },
  },
  {
    name: "unarchive_milestone",
    description: "Clear the archived flag on a milestone.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await unarchiveMilestone(locttDir, args["key"] as string);
      return text(`Unarchived milestone ${String(args["key"])}`);
    },
  },
];
