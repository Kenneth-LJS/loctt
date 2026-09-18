/**
 * Sprint catalog and burndown. Sprints live in sprints.yaml; the
 * burndown read reconstructs a per-day "remaining" series from task
 * history without persisting snapshots.
 *
 * `edit_sprint` blocks re-opening a completed sprint unless
 * `force: true` is passed.
 */

import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  filterByName,
  loadSprintsConfig,
  loadWorkflowConfig,
  readBurndownSeries,
  resolveSprintIdFromInput,
  sprintProgressDetailed,
  unarchiveSprint,
} from "@loctt/core";
import { z } from "zod";

import { configListInputSchema, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_sprints",
    description:
      "List sprints defined in sprints.yaml. Each sprint has an internal " +
      "id (ULID), a display name, dates, state, and optional goal. Pass " +
      "progress: true to include done/total per sprint — computed from " +
      "status CATEGORY (so a renamed or deleted `done` status does not " +
      "break it), with discarded tasks excluded from the denominator so " +
      "abandoned work does not stall a sprint below 100% forever. When any " +
      "task file cannot be read, the response carries an `unreadable` list " +
      "naming them — the totals count only the readable corpus, so a short " +
      "total is explained rather than silent.",
    inputSchema: {
      progress: z.boolean().optional()
        .describe("Include done/total per sprint. Scans every task, so opt in only when needed."),
      ...configListInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadSprintsConfig(locttDir);
      // K90 order (matching the web `handleListSprints`): name filter,
      // then page. Progress is computed over the paged window only.
      const sprints = pageConfigList(filterByName(cfg.sprints, getQ(args)), args);
      if (args["progress"] !== true) {
        return text(JSON.stringify({ ...cfg, sprints }, null, 2));
      }
      const workflow = await loadWorkflowConfig(locttDir);
      const report = await sprintProgressDetailed(
        locttDir, sprints.map(s => s.id), workflow,
      );
      return text(JSON.stringify({
        sprints: sprints.map(s => ({ ...s, progress: report.progress[s.id] })),
        // K28: unreadable tasks cannot be attributed to a sprint, so
        // they are reported at the top level. Present only when non-empty
        // so a caller reading only `sprints` is unaffected.
        ...(report.unreadable.length > 0 ? { unreadable: report.unreadable } : {}),
        // DEG-C3: the non-progress path spreads `cfg.broken` via `...cfg`,
        // but this fresh object would drop it — a `--progress` list must
        // still name a hand-broken sprint entry, not silently omit it.
        ...(cfg.broken !== undefined && cfg.broken.length > 0 ? { broken: cfg.broken } : {}),
      }, null, 2));
    },
  },
  {
    name: "create_sprint",
    description: "Register a new sprint with start/end dates and a state (active|completed|future). Returns the generated id.",
    inputSchema: {
      name: z.string(),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
      state: z.enum(["active", "completed", "future"]),
      goal: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const goal = args["goal"] as string | undefined;
      const def = await createSprint(locttDir, {
        name: args["name"] as string,
        start_date: args["start_date"] as string,
        end_date: args["end_date"] as string,
        state: args["state"] as "active" | "completed" | "future",
        ...(goal !== undefined ? { goal } : {}),
      });
      return text(JSON.stringify({ id: def.id, name: def.name }, null, 2));
    },
  },
  {
    name: "edit_sprint",
    description:
      "Edit a sprint. `sprint` accepts id or name. Pass null goal to clear. Re-opening " +
      "a completed sprint requires `force: true`.",
    inputSchema: {
      sprint: z.string().describe("Sprint id or name"),
      name: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      state: z.enum(["active", "completed", "future"]).optional(),
      goal: z.string().nullable().optional(),
      force: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadSprintsConfig(locttDir);
      const id = resolveSprintIdFromInput(cfg, args["sprint"] as string, { includeArchived: true });
      const goal = args["goal"] as string | null | undefined;
      await editSprint(locttDir, id, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...(args["start_date"] !== undefined ? { start_date: args["start_date"] as string } : {}),
        ...(args["end_date"] !== undefined ? { end_date: args["end_date"] as string } : {}),
        ...(args["state"] !== undefined ? { state: args["state"] as "active" | "completed" | "future" } : {}),
        ...("goal" in args ? { goal: goal ?? null } : {}),
        ...(args["force"] === true ? { force: true } : {}),
      });
      return text(`Updated sprint ${id}`);
    },
  },
  {
    name: "delete_sprint",
    description:
      "Permanently remove a sprint. The `sprint` field on each affected task is unset or " +
      "remapped via `remap_to`. Use `archive_sprint` for the reversible (soft) variant. " +
      "Always requires `confirm: true`.",
    inputSchema: {
      sprint: z.string().describe("Sprint id or name"),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target sprint (id or name) for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_sprint");
      if (blocked) return blocked;
      const cfg = await loadSprintsConfig(locttDir);
      const id = resolveSprintIdFromInput(cfg, args["sprint"] as string, { includeArchived: true });
      const remapTo = args["remap_to"] as string | undefined;
      const remapToId = remapTo !== undefined ? resolveSprintIdFromInput(cfg, remapTo) : undefined;
      const result = await deleteSprint(locttDir, id, {
        hard: true,
        ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
      });
      return text(JSON.stringify({ id, ...result }, null, 2));
    },
  },
  {
    name: "archive_sprint",
    description: "Mark a sprint as archived. Reversible via `unarchive_sprint`.",
    inputSchema: { sprint: z.string().describe("Sprint id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadSprintsConfig(locttDir);
      const id = resolveSprintIdFromInput(cfg, args["sprint"] as string, { includeArchived: true });
      await archiveSprint(locttDir, id);
      return text(`Archived sprint ${id}`);
    },
  },
  {
    name: "unarchive_sprint",
    description: "Clear the archived flag on a sprint.",
    inputSchema: { sprint: z.string().describe("Sprint id or name") },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadSprintsConfig(locttDir);
      const id = resolveSprintIdFromInput(cfg, args["sprint"] as string, { includeArchived: true });
      await unarchiveSprint(locttDir, id);
      return text(`Unarchived sprint ${id}`);
    },
  },
  {
    name: "get_sprint_burndown",
    description: "Return the burndown series for a sprint, reconstructed from task history. Carries daily 'remaining' totals, unit, initial total, ideal line, and per-day incomplete counts.",
    inputSchema: {
      sprint: z.string().describe("Sprint id or name"),
    },
    handler: async ({ locttDir }, args) => {
      const cfg = await loadSprintsConfig(locttDir);
      const id = resolveSprintIdFromInput(cfg, args["sprint"] as string, { includeArchived: true });
      const series = await readBurndownSeries(locttDir, id);
      return text(JSON.stringify(series, null, 2));
    },
  },
];
