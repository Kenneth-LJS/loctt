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
