/**
 * Machine-local config tools (currently the `git.*` namespace).
 * Reads, writes, unsets, and lists the registered keys. The
 * key catalog lives in core as `CONFIG_KEYS`; this file is just
 * a wire-level shim around it.
 */

import {
  computeWorkflowKeyCounts,
  CONFIG_KEYS,
  getConfigValue,
  loadAllTasks,
  setConfigValue,
  unsetConfigValue,
} from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "get_config_value",
    description: "Reads a machine-local config value (currently git.* keys). Returns structured JSON {key, value, type} with the value preserving its native type.",
    inputSchema: {
      key: z.string().describe("Config key (e.g. git.enabled, git.remote)."),
    },
    handler: async ({ locttDir }, args) => {
      const key = args["key"] as string;
      const def = CONFIG_KEYS.find(d => d.key === key);
      if (!def) {
        // Same message as core's router (config/router.ts), which the
        // CLI surfaces. P10: an agent that moves between surfaces must
        // not be told two different things about one mistake — naming
        // only the bad key leaves it guessing what a good one is.
        return errorResult(
          `unknown config key '${key}'. valid keys: ${CONFIG_KEYS.map(d => d.key).join(", ")}`,
        );
      }
      const value = await getConfigValue(locttDir, key);
      return text(JSON.stringify({
        key,
        value: value ?? null,
        type: def.type,
      }, null, 2));
    },
  },
  {
    name: "set_config_value",
    description: "Changes machine-local config (currently git.* keys only). Echo the change you're making in your response so the user can see what was adjusted. Don't call speculatively — only when the user has indicated they want to change a setting.",
    inputSchema: {
      key: z.string(),
      value: z.string().describe("Stringified value; booleans accept true/false/1/0/yes/no."),
    },
    handler: async ({ locttDir, root }, args) => {
      const key = args["key"] as string;
      const value = args["value"] as string;
      await setConfigValue({ locttDir, root }, key, value);
      return text(`Set ${key} = ${value}`);
    },
  },
  {
    name: "unset_config_value",
    description: "Restores a machine-local config key to its default. Echo the change so the user can see what was reset. Don't call speculatively — only when the user has indicated they want to revert a setting.",
    inputSchema: {
      key: z.string(),
    },
    handler: async ({ locttDir, root }, args) => {
      const key = args["key"] as string;
      await unsetConfigValue({ locttDir, root }, key);
      return text(`Unset ${key}`);
    },
  },
  {
    name: "list_config_values",
    description: "Lists all known config keys with their current values, types, and descriptions. Returns a JSON array of {key, value, type, description}. A key whose value could not be read carries `unreadable` with the reason — treat that as \"unknown\", not as \"not set\": `value` is null in both cases.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const items = [];
      for (const def of CONFIG_KEYS) {
        let value: string | boolean | null = null;
        let unreadable: string | undefined;
        try {
          const v = await getConfigValue(locttDir, def.key);
          value = v === undefined ? null : v;
        } catch (err) {
          // `null` used to cover both "not set" and "we could not read
          // it". An agent reads `git.enabled: null` as "git mode is
          // off" and acts on that — so a malformed sync.yaml presented
          // as a deliberate configuration. Keep null for the value, but
          // say when it is not an answer.
          unreadable = (err as Error).message;
        }
        items.push({
          key: def.key,
          value,
          type: def.type,
          description: def.description,
          ...(unreadable !== undefined ? { unreadable } : {}),
        });
      }
      return text(JSON.stringify(items, null, 2));
    },
  },
  {
    name: "get_workflow_key_usage",
    description: "Counts how many tasks reference each workflow key — every status, priority, task type, relationship, and custom-field enum value. Returns JSON {statuses, priorities, task_types, relationships, custom_field_values}, each a map of key to task count; a key absent from a map is referenced by no task. Call this BEFORE proposing any deletion from workflow.yaml: removing a key that tasks still hold requires a remap, and this is what says how many tasks a remap would move.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      // Counts rather than presence — the same answer the web settings
      // panels get from GET /api/workflow/usage and the CLI from
      // `loctt config usage`. One core function, three surfaces.
      const counts = computeWorkflowKeyCounts(await loadAllTasks(locttDir));
      return text(JSON.stringify(counts, null, 2));
    },
  },
];
