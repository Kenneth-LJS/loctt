/**
 * Milestone catalog tools. Milestones live in milestones.yaml and
 * each task carries a single `milestone` id (nullable). Delete
 * supports remap_to or unset across affected tasks.
 */

import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  loadMilestonesConfig,
  resolveMilestoneIdFromInput,
  unarchiveMilestone,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_milestones",
    description: "List milestones defined in milestones.yaml. Each milestone has an internal id (ULID) and a display name.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadMilestonesConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
  {
    name: "create_milestone",
    description: "Register a new milestone with optional target date. Returns the generated id.",
    inputSchema: {
      name: z.string(),
      target_date: z.string().optional().describe("YYYY-MM-DD"),
    },
    handler: async ({ locttDir }, args) => {
      const td = args["target_date"] as string | undefined;
      const def = await createMilestone(locttDir, {
        name: args["name"] as string,
        ...(td !== undefined ? { target_date: td } : {}),
      });
      return text(JSON.stringify({ id: def.id, name: def.name }, null, 2));
    },
  },
  {
    name: "edit_milestone",
    description: "Edit a milestone. `milestone` accepts id or name. Pass null target_date to clear.",
    inputSchema: {
      milestone: z.string().describe("Milestone id or name"),
      name: z.string().optional(),
      target_date: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadMilestonesConfig(locttDir);
      const id = resolveMilestoneIdFromInput(cfg, args["milestone"] as string, { includeArchived: true });
      const td = args["target_date"] as string | null | undefined;
      const archived = args["archived"] as boolean | undefined;
      await editMilestone(locttDir, id, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...("target_date" in args ? { target_date: td ?? null } : {}),
        ...(archived !== undefined ? { archived } : {}),
      });
      return text(`Updated milestone ${id}`);
    },
  },
  {
    name: "delete_milestone",
    description:
      "Permanently remove a milestone. The `milestone` field on each affected task is unset " +
      "or remapped via `remap_to`. Use `archive_milestone` for the reversible (soft) variant. " +
      "Always requires `confirm: true`.",
    inputSchema: {
      milestone: z.string().describe("Milestone id or name"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target milestone (id or name) for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_milestone");
      if (blocked) return blocked;
      const cfg = await loadMilestonesConfig(locttDir);
      const id = resolveMilestoneIdFromInput(cfg, args["milestone"] as string, { includeArchived: true });
      const remapTo = args["remap_to"] as string | undefined;
      const remapToId = remapTo !== undefined ? resolveMilestoneIdFromInput(cfg, remapTo) : undefined;
      const result = await deleteMilestone(locttDir, id, {
        hard: true,
        ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
      });
      return text(JSON.stringify({ id, ...result }, null, 2));
    },
  },
  {
    name: "archive_milestone",
    description: "Mark a milestone as archived. Reversible via `unarchive_milestone`.",
    inputSchema: { milestone: z.string().describe("Milestone id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadMilestonesConfig(locttDir);
      const id = resolveMilestoneIdFromInput(cfg, args["milestone"] as string, { includeArchived: true });
      await archiveMilestone(locttDir, id);
      return text(`Archived milestone ${id}`);
    },
  },
  {
    name: "unarchive_milestone",
    description: "Clear the archived flag on a milestone.",
    inputSchema: { milestone: z.string().describe("Milestone id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadMilestonesConfig(locttDir);
      const id = resolveMilestoneIdFromInput(cfg, args["milestone"] as string, { includeArchived: true });
      await unarchiveMilestone(locttDir, id);
      return text(`Unarchived milestone ${id}`);
    },
  },
];
