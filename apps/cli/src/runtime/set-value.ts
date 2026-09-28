/**
 * Turns `loctt set <task> <field> <value>`'s text into the value core
 * stores (G2, G3).
 *
 * The command line has only text, and core stores typed values: a
 * number custom field refused `"5"`, a boolean refused `"true"`, and a
 * list field (labels, any `multi` custom field) had no syntax at all.
 * MCP and the web send typed JSON, so this conversion is the CLI's own
 * and does not belong in core.
 *
 * - `labels` and `multi` custom fields take a comma-separated list,
 *   the same list syntax the CLI uses for task refs (`WEB-1,WEB-2`).
 *   Labels are given by name or ID; core resolves them (K148).
 * - `number` custom fields take a number; `boolean` ones take the
 *   boolean spellings the CLI's flags accept.
 * - `fields.<key>` is accepted for a declared custom field `<key>`.
 * - Everything else (string, date and enum custom fields, and the other
 *   built-in fields) passes through as text; core validates it.
 */

import type { CustomFieldDef, WorkflowConfig } from "@loctt/contracts";
import { LocttError } from "@loctt/core";

const TRUE_WORDS = new Set(["true", "1", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "0", "no", "off"]);

export interface SetValue {
  readonly field: string;
  readonly value: unknown;
}

/** Splits a comma list, trimming each item and dropping empty ones. */
export function splitList(raw: string): string[] {
  return raw.split(",").map(v => v.trim()).filter(v => v !== "");
}

function refuse(field: string, message: string): LocttError {
  return new LocttError("validation_failed", message, { field, dataState: "not_saved" });
}

function coerceItem(def: CustomFieldDef, raw: string): unknown {
  if (def.type === "number") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) {
      throw refuse(`fields.${def.key}`, `${def.key} takes a number, not "${raw}".`);
    }
    return n;
  }
  if (def.type === "boolean") {
    const lower = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(lower)) return true;
    if (FALSE_WORDS.has(lower)) return false;
    throw refuse(`fields.${def.key}`, `${def.key} takes true or false, not "${raw}".`);
  }
  return raw;
}

export function coerceSetValue(
  field: string,
  raw: string,
  workflowConfig: WorkflowConfig | undefined,
): SetValue {
  if (field === "labels") return { field, value: splitList(raw) };
  const defs = workflowConfig?.custom_fields ?? [];
  const key = field.startsWith("fields.") && defs.some(d => d.key === field.slice("fields.".length))
    ? field.slice("fields.".length)
    : field;
  const def = defs.find(d => d.key === key);
  if (def === undefined) return { field: key, value: raw };
  if (def.multi) return { field: key, value: splitList(raw).map(item => coerceItem(def, item)) };
  return { field: key, value: coerceItem(def, raw) };
}

/** `--add`/`--remove` as `loctt set` reads them (K150). */
export interface SetListFlags {
  readonly add: string[];
  readonly remove: string[];
  /** The replace-form value (the positional after the field), if any. */
  readonly value: string | undefined;
}

/**
 * Reads `loctt set <task> <field> [<value>] [--add <v>…] [--remove <v>…]`. `--add` and `--remove` take every following word up to the
 * next flag (`--add a b`), may repeat, and split on commas like the
 * replace form (`--add a,b`); `--add=a` works too. Everything after a
 * bare `--` is positional.
 */
export function parseSetListFlags(args: readonly string[]): SetListFlags {
  const add: string[] = [];
  const remove: string[] = [];
  const positionals: string[] = [];
  let into: string[] | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a === "--") { positionals.push(...args.slice(i + 1)); break; }
    if (a === "--add" || a === "--remove") { into = a === "--add" ? add : remove; continue; }
    if (a.startsWith("--add=")) { add.push(...splitList(a.slice("--add=".length))); into = undefined; continue; }
    if (a.startsWith("--remove=")) { remove.push(...splitList(a.slice("--remove=".length))); into = undefined; continue; }
    // Any other flag (`--create`) ends a value run; the command reads it.
    if (a.startsWith("--")) { into = undefined; continue; }
    if (into !== undefined) { into.push(...splitList(a)); continue; }
    positionals.push(a);
  }
  // positionals: [task, field, value?]
  return { add, remove, value: positionals[2] };
}

/**
 * Converts `--add`/`--remove` items by the field's type, as the replace
 * form converts its list (a number field's items become numbers). Also
 * maps `fields.<key>` to `<key>`.
 */
export function coerceListItems(
  field: string,
  items: readonly string[],
  workflowConfig: WorkflowConfig | undefined,
): { readonly field: string; readonly values: unknown[] } {
  if (field === "labels") return { field, values: [...items] };
  const defs = workflowConfig?.custom_fields ?? [];
  const key = field.startsWith("fields.") && defs.some(d => d.key === field.slice("fields.".length))
    ? field.slice("fields.".length)
    : field;
  const def = defs.find(d => d.key === key);
  return { field: key, values: def === undefined ? [...items] : items.map(item => coerceItem(def, item)) };
}
