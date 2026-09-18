import {
  computeWorkflowKeyCounts,
  CONFIG_KEYS,
  getConfigValue,
  loadAllTasks,
  resolveLocttDir,
  setConfigValue,
  unsetConfigValue,
} from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt config <get|set|unset|list|usage>` — read/write machine-local
 * tracker config (git remote/branch settings, user preferences).
 * Pulls the canonical set of keys from core's CONFIG_KEYS so a new
 * key needs zero CLI changes.
 *
 * `usage` is the odd one out: it reports how many tasks reference each
 * *workflow* key rather than reading a machine-local setting. It lives
 * here because it answers the question a user asks right before editing
 * `workflow.yaml` — "what breaks if I delete this?" — and because the
 * web settings panels ask exactly that through
 * `GET /api/workflow/usage`. A capability in core that only one surface
 * can reach is drift with a good address.
 */
const ACCEPTED_FLAGS: readonly string[] = [];

export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0 — `loctt git publish --frce` reported success
  // while pushing nothing the user asked for.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "get": {
      const key = args[2];
      if (!key) {
        console.error("Usage: loctt config get <key>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      const value = await getConfigValue(locttDir, key);
      if (value === undefined) {
        // print empty line for missing
        console.log("");
      } else {
        console.log(String(value));
      }
      break;
    }
    case "set": {
      const key = args[2];
      const value = args[3];
      if (!key || value === undefined) {
        console.error("Usage: loctt config set <key> <value>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      await setConfigValue({ locttDir, root }, key, value);
      console.log(`Set ${key} = ${value}`);
      break;
    }
    case "unset": {
      const key = args[2];
      if (!key) {
        console.error("Usage: loctt config unset <key>");
        process.exitCode = EXIT.USAGE;
        break;
      }
      await unsetConfigValue({ locttDir, root }, key);
      console.log(`Unset ${key}`);
      break;
    }
    case "list": {
      // `.catch(() => undefined)` printed a blank, which reads as "not
      // set" — while `config get` on the same file exits 1 with the
      // real cause. The same binary contradicted itself in adjacent
      // subcommands, and the quieter of the two was the wrong one.
      let anyUnreadable = false;
      for (const def of CONFIG_KEYS) {
        let display: string;
        try {
          const value = await getConfigValue(locttDir, def.key);
          display = value === undefined ? "" : String(value);
        } catch (err) {
          anyUnreadable = true;
          display = `<unreadable: ${err instanceof Error ? err.message : String(err)}>`;
        }
        console.log(`${def.key} = ${display}`);
      }
      // A blank line is a legitimate reading (the key is unset); a
      // failed one is not, so the exit code has to say so.
      if (anyUnreadable) process.exitCode = EXIT.RUNTIME;
      break;
    }
    case "usage": {
      // Counts, not presence: the number is what tells a user whether
      // deleting a status is a one-task change or a ninety-task one.
      const counts = computeWorkflowKeyCounts(await loadAllTasks(locttDir));
      const sections: readonly [string, Readonly<Record<string, number>>][] = [
        ["statuses", counts.statuses],
        ["priorities", counts.priorities],
        ["task_types", counts.task_types],
        ["relationships", counts.relationships],
      ];
      for (const [name, table] of sections) {
        console.log(name);
        const entries = Object.entries(table).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
          console.log("  (none referenced)");
          continue;
        }
        for (const [key, n] of entries) {
          console.log(`  ${key} = ${String(n)}`);
        }
      }
      console.log("custom_fields");
      // The whole-field total is the blast radius of a field delete, and
      // it counts every type — a number or boolean field holds values but
      // has no enum-value breakdown, so keying only off `custom_field_values`
      // dropped those fields from the report entirely.
      const fieldTotals = Object.entries(counts.custom_fields)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (fieldTotals.length === 0) {
        console.log("  (none referenced)");
      }
      for (const [field, total] of fieldTotals) {
        console.log(`  ${field} = ${String(total)}`);
        // The per-value breakdown, for enum fields that have one.
        const table = counts.custom_field_values[field] ?? {};
        for (const [key, n] of Object.entries(table).sort((a, b) => b[1] - a[1])) {
          console.log(`    ${key} = ${String(n)}`);
        }
      }
      break;
    }
    default:
      console.error("Usage: loctt config <get|set|unset|list|usage> [key] [value]");
      process.exitCode = EXIT.USAGE;
      break;
  }
}
