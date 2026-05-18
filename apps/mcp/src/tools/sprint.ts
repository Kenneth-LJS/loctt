/**
 * Sprint catalog and burndown. Sprints live in sprints.yaml; the
 * burndown read reconstructs a per-day "remaining" series from
 * task history, so it can answer historical scope-change questions
 * without persisting a snapshot.
 *
 * `edit_sprint` blocks re-opening a completed sprint unless
 * `force: true` is passed — protects against accidental rollbacks
 * that would invalidate downstream reporting.
 */

import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  loadSprintsConfig,
  readBurndownSeries,
  unarchiveSprint,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_sprints",
    description: "List sprints defined in sprints.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadSprintsConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
  {
    name: "create_sprint",
    description: "Register a new sprint with start/end dates and a state (active|completed|future).",
    inputSchema: {
      key: z.string(),
      label: z.string(),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
      state: z.enum(["active", "completed", "future"]),
      goal: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const goal = args["goal"] as string | undefined;
      await createSprint(locttDir, {
        key: args["key"] as string,
        label: args["label"] as string,
        start_date: args["start_date"] as string,
        end_date: args["end_date"] as string,
        state: args["state"] as "active" | "completed" | "future",
        ...(goal !== undefined ? { goal } : {}),
      });
      return text(`Created sprint ${String(args["key"])}`);
    },
  },
  {
    name: "edit_sprint",
    description:
      "Edit a sprint. Pass null goal to clear. Re-opening a completed sprint " +
      "(state: 'completed' -> 'active' or 'future') is blocked by default; pass " +
      "force: true to override.",
    inputSchema: {
      key: z.string(),
      label: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      state: z.enum(["active", "completed", "future"]).optional(),
      goal: z.string().nullable().optional(),
      force: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const goal = args["goal"] as string | null | undefined;
      await editSprint(locttDir, args["key"] as string, {
        ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
        ...(args["start_date"] !== undefined ? { start_date: args["start_date"] as string } : {}),
        ...(args["end_date"] !== undefined ? { end_date: args["end_date"] as string } : {}),
        ...(args["state"] !== undefined ? { state: args["state"] as "active" | "completed" | "future" } : {}),
        ...("goal" in args ? { goal: goal ?? null } : {}),
        ...(args["force"] === true ? { force: true } : {}),
      });
      return text(`Updated sprint ${String(args["key"])}`);
    },
  },
  {
    name: "delete_sprint",
    description:
      "Permanently remove a sprint from sprints.yaml. The `sprint` field on each affected " +
      "task is unset or remapped via `remap_to`. Use `archive_sprint` for the reversible " +
      "(soft) variant. Always requires `confirm: true`.",
    inputSchema: {
      key: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target sprint key for affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_sprint");
      if (blocked) return blocked;
      const remapTo = args["remap_to"] as string | undefined;
      const result = await deleteSprint(locttDir, args["key"] as string, {
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
    name: "archive_sprint",
    description: "Mark a sprint as archived. Reversible via `unarchive_sprint`.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await archiveSprint(locttDir, args["key"] as string);
      return text(`Archived sprint ${String(args["key"])}`);
    },
  },
  {
    name: "unarchive_sprint",
    description: "Clear the archived flag on a sprint.",
    inputSchema: { key: z.string() },
    handler: async ({ locttDir }, args) => {
      await unarchiveSprint(locttDir, args["key"] as string);
      return text(`Unarchived sprint ${String(args["key"])}`);
    },
  },
  {
    name: "get_sprint_burndown",
    description: "Return the burndown series for a sprint, reconstructed from task history. The response carries the daily 'remaining' total across the sprint window, the unit being summed (points/hours/weighted-enum/task-count), the initial total at sprint start, the ideal straight-line, and per-day incomplete task counts. Scope changes (tasks joining or leaving the sprint mid-run) appear as visible steps in the series.",
    inputSchema: {
      key: z.string().describe("Sprint key (e.g. 's1' / 'sprint_2026.q1')"),
    },
    handler: async ({ locttDir }, args) => {
      const series = await readBurndownSeries(locttDir, args["key"] as string);
      return text(JSON.stringify(series, null, 2));
    },
  },
];
