/**
 * Tracker-level tools: info (read-only summary), doctor
 * (diagnostic + optional repair), init (bootstrap a new tracker) and
 * migrate_schema (the deliberate format upgrade, K154).
 *
 * Four are exempt from the schema guard (`exemptFromSchemaGuard`),
 * like the CLI's exempt commands: `init` runs before a tracker
 * exists, `migrate_schema` is the remedy, and `info` and `doctor` are
 * read-only on a tracker that is not current and report its state
 * ("needs upgrading from X to Y") instead of refusing (K154).
 */

import {
  computeSchemaStatus,
  describeSchemaStatus,
  type DiagnosticCheck,
  getTrackerInfo,
  initLoctt,
  migrateToCurrent,
  planMigration,
  resolveLocttDir,
  runDoctor,
} from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "info",
    description: "Returns prose summary of the tracker state (locttDir, task count, key prefix, statuses, next key). Mirrors the CLI 'info' command.",
    inputSchema: {},
    // Read-only, and the tool that tells an agent the tracker needs
    // upgrading: it reports the schema state rather than refusing, like
    // CLI `loctt info` (K154).
    exemptFromSchemaGuard: true,
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
      lines.push(`Schema: ${describeSchemaStatus(info.schemaStatus)}`);
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
    description: "Runs diagnostic checks on the tracker. Returns structured JSON {healthy, counts:{ok,warn,error}, checks:[{name,status,message,fix?}]}. Branch on `healthy` or on a check's `status` rather than reading the messages. `healthy` is false when any check is in error. A check's optional `fix` names the programmatic repair for it: \"rebuild-index\" (pass rebuild_index:true), \"restore-missing\" (pass restore_missing:true) or \"repair-relationships\" (pass repair_relationships:true). Pass `rebuild_index: true` to rebuild the key-lookup cache (recovery for out-of-band frontmatter edits); pass `restore_missing: true` to recreate missing core config/state files with defaults (existence-guarded: never overwrites surviving data); pass `repair_relationships: true` to rewrite links stored as a task key to the task's id, add the missing side of every one-sided link (refused when it would create a loop), and merge identical links, never deleting a link. Pass `fix: true` to run every safe repair (rebuild_index and repair_relationships, not restore_missing) before the checks, so the checks report what is left.",
    inputSchema: {
      rebuild_index: z.boolean().optional().describe("If true, rebuild the on-disk key index after checks. Use after manual frontmatter edits to a task's key or key_history."),
      restore_missing: z.boolean().optional().describe("If true, recreate any missing core config/state files with defaults (initLoctt repair). Existence-guarded: surviving files and tasks are untouched."),
      repair_relationships: z.boolean().optional().describe("If true, run the relationship repair before the checks: key-valued link targets are rewritten to the task's id, every one-sided link gets its missing side (unless that would create a loop), identical links are merged. No link is ever deleted."),
      fix: z.boolean().optional().describe("If true, run every safe repair (rebuild_index and repair_relationships) before the checks, then report what is left. restore_missing is not included because it writes default config in place of missing files."),
    },
    // Exempt, like CLI `loctt doctor`: it explains a tracker the guard
    // refuses. It never writes to one that is not current: every repair
    // is skipped there, saying why (K154).
    exemptFromSchemaGuard: true,
    handler: async ({ root }, args) => {
      const rebuildIndex = args["rebuild_index"] === true;
      // restore-missing parity (K-diagnostics-repair): the web Diagnostics
      // panel and CLI `init --repair` both offer this; MCP must too. Runs
      // BEFORE the checks so the returned findings reflect the repaired
      // state. Gap-fill only — `initLoctt({repair:true})` recreates missing
      // core files with defaults and never overwrites what survives.
      //
      // Only on a current tracker, or one whose `.schema-version` is
      // missing (restoring it is what the repair is for). Anywhere else
      // it would write this build's default files into a tracker of
      // another format; the checks report the schema problem instead.
      let restoreSkipped: DiagnosticCheck | undefined;
      if (args["restore_missing"] === true) {
        const schema = await computeSchemaStatus(resolveLocttDir(root));
        if (schema.kind === "current" || schema.kind === "missing") {
          await initLoctt(root, { repair: true });
        } else {
          restoreSkipped = {
            name: "restore missing files",
            status: "error",
            message: schema.kind === "outdated"
              ? "skipped. This tracker needs upgrading first. Run loctt migrate, then run the repair again"
              : "skipped. Resolve the schema version problem first",
          };
        }
      }
      // K141 4a: `fix` runs every safe repair first; `repair_relationships`
      // runs the relationship repair alone. Both run before the checks,
      // inside core, so the result lists what is left.
      const checks = [
        ...(restoreSkipped !== undefined ? [restoreSkipped] : []),
        ...(await runDoctor(root, {
          rebuildIndex,
          ...(args["repair_relationships"] === true ? { repairRelationships: true } : {}),
          ...(args["fix"] === true ? { fix: true } : {}),
        })),
      ];
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
      "Upgrade the tracker's data format to the one this build reads. "
      + "Don't call migrate_schema unless the user asked you to upgrade the tracker. "
      + "Tell the user it needs upgrading and ask. "
      + "Call with confirm: false (or omit it) to preview the plan: from and to, "
      + "each step and what it changes, any step marked risky, and where the backup goes. "
      + "Show the user the preview, and call with confirm: true only once they agree. "
      + "A backup of .loctt/ is written before any step runs and is never deleted. "
      + "Unlike the delete tools, `confirm` here is a preview/apply toggle, not a safety gate.",
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
            return text(`Already at format ${plan.to}. Nothing to migrate.`);
          }
          const lines = [
            `This tracker needs upgrading from ${plan.from} to ${plan.to} (${plan.steps.length} step(s)).`,
          ];
          for (const st of plan.steps) {
            lines.push(`  ${st.from}→${st.to}: ${st.description}${st.risky === true ? "  [RISKY]" : ""}`);
            if (st.changes !== undefined) lines.push(`    ${st.changes}`);
          }
          lines.push(`Before any step runs, .loctt/ is copied to a backup beside it: ${locttDir}.backup-v${plan.from}-<date and time>`);
          lines.push("Show the user this plan. Call again with confirm: true only if they agree.");
          return text(lines.join("\n"));
        }
        const result = await migrateToCurrent(locttDir);
        if (result.steps.length === 0) {
          return text(`Already at format ${result.to}. Nothing to migrate.`);
        }
        const lines = [`Upgraded this tracker from ${result.from} to ${result.to}.`];
        if (result.backupPath !== undefined) lines.push(`Backup: ${result.backupPath}`);
        return text(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
];
