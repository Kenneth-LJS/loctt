/**
 * Tracker-level tools: info (read-only summary), doctor
 * (diagnostic + optional repair), and init (bootstrap a new
 * tracker). `init` is the only tool that legitimately runs
 * against a non-existent tracker — its `exemptFromSchemaGuard`
 * flag bypasses the version check.
 */

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
      // Same distinction the CLI draws: an empty `.loctt/` reported as
      // a schema-versioning problem sends an agent to `migrate`, which
      // cannot help. It needs `init`.
      if (info.initState === "empty") {
        return text(
          `Found an empty .loctt directory at ${info.locttDir}. `
          + `It is not a tracker yet. Run 'loctt init' to set one up in it.`,
        );
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
            lines.push(`  ${key}: ${val.prefix}-${val.next_number}`);
          }
        }
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "doctor",
    description: "Runs diagnostic checks on the tracker. Returns structured JSON {healthy, counts:{ok,warn,error}, checks:[{name,status,message,fix?}]}. Branch on `healthy` or on a check's `status` rather than reading the messages. `healthy` is false when any check is in error. A check's optional `fix` names the programmatic repair for it: \"rebuild-index\" (pass rebuild_index:true) or \"restore-missing\" (pass restore_missing:true). Pass `rebuild_index: true` to rebuild the key-lookup cache (recovery for out-of-band frontmatter edits); pass `restore_missing: true` to recreate missing core config/state files with defaults (existence-guarded: never overwrites surviving data).",
    inputSchema: {
      rebuild_index: z.boolean().optional().describe("If true, rebuild the on-disk key index after checks. Use after manual frontmatter edits to a task's key or key_history."),
      restore_missing: z.boolean().optional().describe("If true, recreate any missing core config/state files with defaults (initLoctt repair). Existence-guarded: surviving files and tasks are untouched."),
    },
    handler: async ({ root }, args) => {
      const rebuildIndex = args["rebuild_index"] === true;
      // restore-missing parity (K-diagnostics-repair): the web Diagnostics
      // panel and CLI `init --repair` both offer this; MCP must too. Runs
      // BEFORE the checks so the returned findings reflect the repaired
      // state. Gap-fill only — `initLoctt({repair:true})` recreates missing
      // core files with defaults and never overwrites what survives.
      if (args["restore_missing"] === true) {
        await initLoctt(root, { repair: true });
      }
      const checks = await runDoctor(root, { rebuildIndex });
      // Structured, not prose (ONB-C7). An agent deciding whether to
      // proceed had to substring-match "[error]" in a human sentence —
      // which silently stops working the moment the wording changes, and
      // gives a false "healthy" when it does.
      const counts = {
        ok: checks.filter(c => c.status === "ok").length,
        warn: checks.filter(c => c.status === "warn").length,
        error: checks.filter(c => c.status === "error").length,
      };
      return text(JSON.stringify({
        // Warnings do not make a tracker unhealthy: they name things
        // worth knowing (a stale key index, a pending rename) that do not
        // block the next operation. Errors do.
        healthy: counts.error === 0,
        counts,
        checks: checks.map(c => ({
          name: c.name,
          status: c.status,
          message: c.message,
          ...(c.fix !== undefined ? { fix: c.fix } : {}),
        })),
      }, null, 2));
    },
  },
  {
    name: "init",
    description: "Bootstraps a new loctt tracker at the server's working directory if .loctt/ doesn't exist yet or is an empty folder (it is filled in). Only call when explicitly asked to set up a new tracker. This is a one-time operation, not a routine task action.",
    inputSchema: {
      prefix: z.string().optional().describe("Key prefix for tasks (default 'T-')."),
      project_label: z.string().optional().describe("Name of the starting project (default 'Tasks')."),
      no_docs: z.boolean().optional().describe("If true, skip generating helper docs."),
      timezone: z.string().optional().describe(
        "IANA workspace timezone (e.g. Asia/Singapore). Decides what 'today' "
        + "means in date queries and is shared by everyone on the tracker, so "
        + "set it for the team rather than the machine. Defaults to the "
        + "server's zone.",
      ),
    },
    // init runs *before* a tracker exists, so the schema-version
    // boot guard would always fail. This is the one tool with the
    // legitimate exemption.
    exemptFromSchemaGuard: true,
    handler: async ({ root }, args) => {
      const locttDir = resolveLocttDir(root);
      // B22 (K129): an empty `.loctt/` is set up like a missing one,
      // as `loctt init` and the web wizard do. Anything else already
      // there is refused.
      const info = await getTrackerInfo(root);
      if (info.exists && info.initState !== "empty") {
        return errorResult(`.loctt directory already exists at ${locttDir}`);
      }
      const prefix = args["prefix"] as string | undefined;
      const projectLabel = args["project_label"] as string | undefined;
      const noDocs = (args["no_docs"] as boolean | undefined) ?? false;
      // ONB-C2: this was CLI-only, so an agent setting up for a team in
      // another zone silently recorded the server machine's — and the
      // zone decides what "today" means for every date query.
      const timezone = args["timezone"] as string | undefined;
      const result = await initLoctt(root, {
        ...(prefix !== undefined ? { prefix } : {}),
        ...(projectLabel !== undefined ? { projectName: projectLabel } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
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
      "what would change. Migration rewrites task frontmatter across the " +
      "whole tracker and some steps are marked risky. Only call with " +
      "confirm: true once the user has seen the plan and agreed. A backup " +
      "is written before any step runs and is never deleted. Unlike the " +
      "delete tools, `confirm` here is a preview/apply toggle, not a safety " +
      "gate.",
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
