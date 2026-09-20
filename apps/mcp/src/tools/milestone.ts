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
  filterByName,
  loadMilestonesConfig,
  loadWorkflowConfig,
  milestoneProgressDetailed,
  resolveMilestoneIdFromInput,
  unarchiveMilestone,
} from "@loctt/core";
import { z } from "zod";

import { configListInputSchema, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_milestones",
    description:
      "List milestones defined in milestones.yaml. Each milestone has an " +
      "internal id (ULID) and a display name. Pass progress: true to " +
      "include done/total per milestone — computed from status CATEGORY " +
      "(so a renamed or deleted `done` status does not break it), with " +
      "discarded tasks excluded from the denominator so abandoned work " +
      "does not stall a milestone below 100% forever. A milestone whose " +
      "own progress could not be computed (an unreadable member attributed " +
      "to it) carries `progress: { unavailable: true, reason }` in place " +
      "of the numbers — that one milestone fails independently; the others " +
      "still report real numbers. When an unreadable task cannot be " +
      "attributed to any milestone, the response carries a top-level " +
      "`unreadable` list naming them — the totals count only the readable " +
      "corpus, so a short total is explained rather than silent.",
    inputSchema: {
      progress: z.boolean().optional()
        .describe("Include done/total per milestone. Scans every task, so opt in only when needed."),
      ...configListInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadMilestonesConfig(locttDir);
      // K90 order (matching the web `handleListMilestones`): name filter,
      // then page. Progress is computed over the paged window only.
      const milestones = pageConfigList(filterByName(cfg.milestones, getQ(args)), args);
      if (args["progress"] !== true) {
        return text(JSON.stringify({ ...cfg, milestones }, null, 2));
      }
      const workflow = await loadWorkflowConfig(locttDir);
      const report = await milestoneProgressDetailed(
        locttDir, milestones.map(m => m.id), workflow,
      );
      return text(JSON.stringify({
        milestones: milestones.map(m => ({ ...m, progress: report.progress[m.id] })),
        // K28: unreadable tasks cannot be attributed to a milestone, so
        // they are reported at the top level. Present only when non-empty
        // so a caller reading only `milestones` is unaffected.
        ...(report.unreadable.length > 0 ? { unreadable: report.unreadable } : {}),
        // DEG-C3: the non-progress path spreads `cfg.broken` via `...cfg`,
        // but this fresh object would drop it — a `--progress` list must
        // still name a hand-broken milestone entry, not silently omit it.
        ...(cfg.broken !== undefined && cfg.broken.length > 0 ? { broken: cfg.broken } : {}),
      }, null, 2));
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
