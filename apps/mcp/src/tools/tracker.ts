/**
 * Tracker-level tools: info (read-only summary), doctor
 * (diagnostic + optional repair), and init (bootstrap a new
 * tracker). `init` is the only tool that legitimately runs
 * against a non-existent tracker — its `exemptFromSchemaGuard`
 * flag bypasses the version check.
 */

import { access } from "node:fs/promises";

import { getTrackerInfo, initLoctt, migrateToCurrent, planMigration, resolveLocttDir, runDoctor } from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "info",
    description: "Returns prose summary of the tracker state (locttDir, task count, key prefix, statuses, next key). Mirrors the CLI 'info' command.",
    inputSchema: {},
    handler: async ({ root }) => {
      const info = await getTrackerInfo(root);
      if (!info.exists) {
        return text("No .loctt directory found. Run 'loctt init' to get started.");
      }
      const lines: string[] = [];
      lines.push(`LocTT directory: ${info.locttDir}`);
      lines.push(`Tasks: ${info.taskCount}`);
      if (info.workflowConfig) {
        lines.push(`Key prefix: ${info.workflowConfig.key.prefix}`);
        lines.push(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
      }
      if (info.state) {
        // Show every project counter. Sorted by project key so
        // output is stable.
        const entries = Object.entries(info.state.keys).sort(([a], [b]) => a.localeCompare(b));
        if (entries.length > 0) {
          lines.push(`Next keys:`);
          for (const [key, val] of entries) {
            lines.push(`  ${key}: ${val.prefix}${val.next_number}`);
          }
        }
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "doctor",
    description: "Runs diagnostic checks on the tracker. Output is human-prose. Useful for surfacing problems to the user; not designed for chained tool calls. Pass `rebuild_index: true` to also rebuild the key-lookup cache (recovery path for out-of-band frontmatter edits).",
    inputSchema: {
      rebuild_index: z.boolean().optional().describe("If true, rebuild the on-disk key index after checks. Use after manual frontmatter edits to a task's key or key_history."),
    },
    handler: async ({ root }, args) => {
      const rebuildIndex = args["rebuild_index"] === true;
      const checks = await runDoctor(root, { rebuildIndex });
      const lines = checks.map(c => {
        const icon = c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "error";
        return `[${icon}] ${c.name}: ${c.message}`;
      });
      return text(lines.join("\n"));
    },
  },
  {
    name: "init",
    description: "Bootstraps a new loctt tracker at the server's working directory if .loctt/ doesn't exist yet. Only call when explicitly asked to set up a new tracker — this is a one-time operation, not a routine task action.",
    inputSchema: {
      prefix: z.string().optional().describe("Key prefix for tasks (default 'T-')."),
      project_label: z.string().optional().describe("Name of the starting project (default 'Tasks')."),
      no_docs: z.boolean().optional().describe("If true, skip generating helper docs."),
    },
    // init runs *before* a tracker exists, so the schema-version
    // boot guard would always fail. This is the one tool with the
    // legitimate exemption.
    exemptFromSchemaGuard: true,
    handler: async ({ root }, args) => {
      const locttDir = resolveLocttDir(root);
      try {
        await access(locttDir);
        return errorResult(`.loctt directory already exists at ${locttDir}`);
      } catch {
        // doesn't exist — proceed
      }
      const prefix = args["prefix"] as string | undefined;
      const projectLabel = args["project_label"] as string | undefined;
      const noDocs = (args["no_docs"] as boolean | undefined) ?? false;
      const result = await initLoctt(root, {
        ...(prefix !== undefined ? { prefix } : {}),
        ...(projectLabel !== undefined ? { projectName: projectLabel } : {}),
        docs: !noDocs,
      });
      return text(`Initialized .loctt at ${result.locttDir}\nCreated ${result.created.length} files`);
    },
  },
  {
    name: "migrate_schema",
    description:
      "Upgrade the tracker's on-disk schema to the version this build " +
      "understands. Call with confirm: false (or omit it) FIRST to preview " +
      "what would change — migration rewrites task frontmatter across the " +
      "whole tracker and some steps are marked risky. Only call with " +
      "confirm: true once the user has seen the plan and agreed. A backup " +
      "is written before any step runs and is never deleted.",
    inputSchema: {
      confirm: z.boolean().optional()
        .describe("false/omitted previews the plan; true performs the migration."),
    },
    // Exempt for the same reason as `init`: this is the remedy for a
    // schema mismatch, so gating it behind one would make an outdated
    // tracker unfixable from this surface.
    exemptFromSchemaGuard: true,
    handler: async ({ root }, args) => {
      const locttDir = resolveLocttDir(root);
      const confirm = (args["confirm"] as boolean | undefined) ?? false;
      try {
        if (!confirm) {
          const plan = await planMigration(locttDir);
          if (plan.steps.length === 0) {
            return text(`Already at schema v${plan.to}. Nothing to migrate.`);
          }
          const lines = [
            `Plan: v${plan.from} → v${plan.to} (${plan.steps.length} step(s)).`,
            "Re-run with confirm: true to apply.",
          ];
          for (const st of plan.steps) {
            lines.push(`  v${st.from}→v${st.to}: ${st.description}${st.risky === true ? "  [RISKY]" : ""}`);
          }
          return text(lines.join("\n"));
        }
        const result = await migrateToCurrent(locttDir);
        if (result.steps.length === 0) {
          return text(`Already at schema v${result.to}. Nothing to migrate.`);
        }
        const lines = [`Migrated v${result.from} → v${result.to}.`];
        if (result.backupPath !== undefined) lines.push(`Backup: ${result.backupPath}`);
        return text(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
];
