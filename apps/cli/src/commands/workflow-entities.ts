/**
 * `loctt status | priority | task-type | relationship | custom-field |
 * board-column | estimation | timeline` — the CLI half of workflow.yaml
 * entity editing.
 *
 * These commands are thin wrappers over the per-entity core functions in
 * `@loctt/core` (`config/workflow-entities.ts`): parse argv → build the
 * typed input/patch → call the function → map its `WorkflowEntityError`
 * to a clean CLI error. The core layer owns every guarantee — key
 * immutability, remap-or-refuse on delete, priority renumber-on-reorder,
 * read-fresh, atomic validated write. The CLI adds nothing but argument
 * parsing and confirmation, so a status created here and one created
 * through the web settings panels are indistinguishable (surface parity,
 * A251/A252).
 *
 * Grammar (each family is one top-level command with subcommands):
 *
 *   loctt status      list | add | edit | rm [--remap-to] | reorder <k,k,…>
 *   loctt priority    list | add | edit | rm [--remap-to] | reorder <k,k,…>   (NO --value)
 *   loctt task-type   list | add | edit | rm [--remap-to] | reorder <k,k,…>
 *   loctt relationship list | add | edit | rm [--remap-to]                    (no reorder)
 *   loctt custom-field list | add | edit | rm                                 (clear-only)
 *                     value <field> add | edit | rm [--remap-to] | reorder
 *   loctt board-column list | add | edit | rm | reorder <k,k,…>
 *   loctt estimation  show | set
 *   loctt timeline    show | set
 *
 * `edit` never takes `--key` / rename (the key is immutable — core has no
 * path for it; a rename is delete+create). `--remap-to` appears only where
 * core's delete accepts a remap target.
 */
import type {
  CustomFieldDef,
  EntityColor,
  EstimationScale,
  EstimationUnit,
  RelationshipGraph,
  RelationshipKind,
  StatusCategory,
  TimelineGrouping,
  TimelineZoom,
} from "@loctt/contracts";
import {
  addFieldValue,
  createBoardColumn,
  createCustomField,
  createPriority,
  createRelationship,
  createStatus,
  createTaskType,
  deleteBoardColumn,
  deleteCustomField,
  deleteFieldValue,
  deletePriority,
  deleteRelationship,
  deleteStatus,
  deleteTaskType,
  editBoardColumn,
  editCustomField,
  editEstimationConfig,
  editFieldValue,
  editPriority,
  editRelationship,
  editStatus,
  editTaskType,
  editTimelineConfig,
  loadWorkflowConfig,
  reorderBoardColumns,
  reorderFieldValues,
  reorderPriorities,
  reorderStatuses,
  reorderTaskTypes,
  resolveLocttDir,
} from "@loctt/core";

import { getArg, hasFlag, positional, rejectUnknownFlags } from "../runtime/args.js";
import { COLOR_ARG_SYNTAX, formatEntityColor, parseEntityColorArg, warnUnknownPalette } from "../runtime/color.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

// ---------------------------------------------------------------------------
// Shared parse helpers
// ---------------------------------------------------------------------------

/**
 * The union of every flag any workflow-entity subcommand reads. One list
 * because all subcommands of a family share one argv (the PRU-C9 rule: an
 * unrecognised flag is a mistype, not a silent no-op). It spans all eight
 * families — a flag valid on `relationship add` but meaningless on
 * `status add` is still accepted rather than rejected, matching how
 * `label`/`views` union their flags.
 */
const ACCEPTED_FLAGS: readonly string[] = [
  "--label",
  "--category",
  "--default",
  "--icon",
  "--color",
  "--remap-to",
  "--kind",
  "--inverse",
  "--inverse-label",
  "--graph",
  "--ranked",
  "--type",
  "--multi",
  "--searchable",
  "--task-types",
  "--enum-value",
  "--statuses",
  "--wip",
  "--enabled",
  "--unit",
  "--unit-label",
  "--scale",
  "--preset",
  "--weight",
  "--dependency-relationship",
  "--default-zoom",
  "--show-arrows",
  "--default-grouping",
  "--yes",
];

/** Parses a `--flag=value` (or bare-boolean) whose value is one of a fixed enum set. */
function enumArg<T extends string>(
  args: string[],
  flag: string,
  allowed: readonly T[],
): T | undefined {
  const raw = getArg(args, flag);
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new UsageError(`${flag} must be one of: ${allowed.join(", ")} (got "${raw}")`);
  }
  return raw as T;
}

/**
 * Reads an icon/color CHANGE for an `edit`: `-` clears the field (maps to
 * `null`), an absent flag leaves it unchanged (`undefined`), any other
 * value sets it. Mirrors `label edit --color`.
 *
 * K103: the colour is parsed through `parseEntityColorArg`, so all three
 * shapes (`#hex`, `palette:<id>`, `light:…,dark:…`) reach core as a
 * typed `EntityColor` rather than a bare string the old signature
 * silently narrowed to.
 */
function iconColorChange(args: string[]): { icon?: string | null; color?: EntityColor | null } {
  const icon = getArg(args, "--icon");
  const color = getArg(args, "--color");
  return {
    ...(icon !== undefined ? { icon: icon === "-" ? null : icon } : {}),
    ...(color !== undefined
      ? { color: color === "-" ? null : warnUnknownPalette(parseEntityColorArg(color)) }
      : {}),
  };
}

/** Reads icon/color for a `create` (no clear semantics — a value or nothing). */
function iconColorCreate(args: string[]): { icon?: string; color?: EntityColor } {
  const icon = getArg(args, "--icon");
  const color = getArg(args, "--color");
  return {
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color: warnUnknownPalette(parseEntityColorArg(color)) } : {}),
  };
}

/**
 * Parses the trailing comma-list of keys for a `reorder` subcommand, e.g.
 * `loctt priority reorder p0,p1,p2`. Rejects an empty list. Whitespace
 * around each key is trimmed so `a, b, c` works from a shell.
 */
function parseReorderKeys(args: string[], usage: string): string[] {
  const raw = positional(args, 2, usage);
  if (!raw) {
    throw new UsageError("missing key list", usage);
  }
  const keys = raw.split(",").map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) {
    throw new UsageError("key list is empty", usage);
  }
  return keys;
}

/** `--remap-to <key>` for a delete: a target key, or undefined when absent. */
function remapToArg(args: string[]): string | undefined {
  return getArg(args, "--remap-to");
}

/** A `--task-types a,b,c` list, or `-` to clear (edit only). */
function parseTaskTypes(raw: string | undefined): readonly string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "-") return null;
  return raw.split(",").map(t => t.trim()).filter(t => t.length > 0);
}

/**
 * Collects repeated `--enum-value key=label` flags into the value-def list
 * an enum custom field is seeded with at creation. Returns [] when none
 * given. A missing `=` or empty key/label is a usage error.
 */
function parseFieldValueSeeds(args: string[]): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    let raw: string | undefined;
    if (a === "--enum-value") {
      raw = args[i + 1];
      i += 1;
    } else if (a?.startsWith("--enum-value=")) {
      raw = a.slice("--enum-value=".length);
    } else {
      continue;
    }
    if (raw === undefined) throw new UsageError(`--enum-value needs a key=label value`);
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`--enum-value must be key=label (got "${raw}")`);
    const key = raw.slice(0, eq).trim();
    const label = raw.slice(eq + 1).trim();
    if (key.length === 0 || label.length === 0) {
      throw new UsageError(`--enum-value must be key=label with both non-empty (got "${raw}")`);
    }
    out.push({ key, label });
  }
  return out;
}

const VALID_STATUS_CATEGORIES: readonly StatusCategory[] = ["pending", "active", "completed", "discarded"];
const VALID_RELATIONSHIP_KINDS: readonly RelationshipKind[] = ["directional", "symmetric"];
const VALID_RELATIONSHIP_GRAPHS: readonly RelationshipGraph[] = ["none", "acyclic", "tree"];
const VALID_FIELD_TYPES: readonly CustomFieldDef["type"][] = ["string", "number", "date", "boolean", "enum"];
const VALID_ESTIMATION_UNITS: readonly EstimationUnit[] = ["points", "hours", "days", "custom_numeric", "custom_enum"];
const VALID_ESTIMATION_SCALES: readonly EstimationScale[] = ["free", "linear", "fibonacci"];
const VALID_TIMELINE_ZOOMS: readonly TimelineZoom[] = ["day", "week", "month"];

// ---------------------------------------------------------------------------
// status / priority / task-type share a scalar shape. Each command routes to
// its own handlers below; a small amount of duplication keeps the usage
// strings and label rules per-entity readable rather than macro-generated.
// ---------------------------------------------------------------------------

export async function status(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      for (const s of cfg.statuses) {
        const def = s.default === true ? "  (default)" : "";
        const icon = s.icon ? `  ${s.icon}` : "";
        const color = s.color !== undefined ? `  ${formatEntityColor(s.color)}` : "";
        console.log(`${s.key} (${s.category}): ${s.label}${icon}${color}${def}`);
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        const usage = `loctt status add <key> --label <text> --category <${VALID_STATUS_CATEGORIES.join("|")}> [--default] [--icon <s>] [--color <${COLOR_ARG_SYNTAX}>]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        const category = enumArg(args, "--category", VALID_STATUS_CATEGORIES);
        if (category === undefined) throw new UsageError("missing --category", usage);
        await createStatus(locttDir, {
          key,
          label,
          category,
          ...(hasFlag(args, "--default") ? { default: true } : {}),
          ...iconColorCreate(args),
        });
        console.log(`Created status "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt status edit <key> [--label <text>] [--category <cat>] [--default] [--icon <s|->] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        const category = enumArg(args, "--category", VALID_STATUS_CATEGORIES);
        const setDefault = hasFlag(args, "--default");
        const iconColor = iconColorChange(args);
        if (
          label === undefined && category === undefined && !setDefault &&
          iconColor.icon === undefined && iconColor.color === undefined
        ) {
          throw new UsageError("nothing to change", usage);
        }
        await editStatus(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(setDefault ? { default: true } : {}),
          ...iconColor,
        });
        console.log(`Updated status "${key}"`);
      });
      break;
    }
    case "rm": {
      await removeScalar(args, "status", (key, remapTo) => deleteStatus(locttDir, key, remapTo));
      break;
    }
    case "reorder": {
      await runCommand(async () => {
        const keys = parseReorderKeys(args, "loctt status reorder <key,key,…>");
        await reorderStatuses(locttDir, keys);
        console.log(`Reordered statuses`);
      });
      break;
    }
    default:
      usageError("status", "list|add|edit|rm|reorder");
  }
}

export async function priority(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      for (const p of cfg.priorities) {
        const value = p.value !== undefined ? ` [${p.value}]` : "";
        const icon = p.icon ? `  ${p.icon}` : "";
        const color = p.color !== undefined ? `  ${formatEntityColor(p.color)}` : "";
        console.log(`${p.key}: ${p.label}${value}${icon}${color}`);
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        // NO --value: value is derived from list order by reorder (D20).
        const usage = `loctt priority add <key> --label <text> [--icon <s>] [--color <${COLOR_ARG_SYNTAX}>]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        await createPriority(locttDir, { key, label, ...iconColorCreate(args) });
        console.log(`Created priority "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt priority edit <key> [--label <text>] [--icon <s|->] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        const iconColor = iconColorChange(args);
        if (label === undefined && iconColor.icon === undefined && iconColor.color === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editPriority(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...iconColor,
        });
        console.log(`Updated priority "${key}"`);
      });
      break;
    }
    case "rm": {
      await removeScalar(args, "priority", (key, remapTo) => deletePriority(locttDir, key, remapTo));
      break;
    }
    case "reorder": {
      await runCommand(async () => {
        // This is the ONLY way to change a priority's value: the write
        // path renumbers 1..N by the new order (top = highest, D20).
        const keys = parseReorderKeys(args, "loctt priority reorder <key,key,…>");
        await reorderPriorities(locttDir, keys);
        console.log(`Reordered priorities`);
      });
      break;
    }
    default:
      usageError("priority", "list|add|edit|rm|reorder");
  }
}

export async function taskType(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      for (const t of cfg.task_types) {
        const icon = t.icon ? `  ${t.icon}` : "";
        const color = t.color !== undefined ? `  ${formatEntityColor(t.color)}` : "";
        console.log(`${t.key}: ${t.label}${icon}${color}`);
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        const usage = `loctt task-type add <key> --label <text> [--icon <s>] [--color <${COLOR_ARG_SYNTAX}>]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        await createTaskType(locttDir, { key, label, ...iconColorCreate(args) });
        console.log(`Created task type "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt task-type edit <key> [--label <text>] [--icon <s|->] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        const iconColor = iconColorChange(args);
        if (label === undefined && iconColor.icon === undefined && iconColor.color === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editTaskType(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...iconColor,
        });
        console.log(`Updated task type "${key}"`);
      });
      break;
    }
    case "rm": {
      await removeScalar(args, "task type", (key, remapTo) => deleteTaskType(locttDir, key, remapTo));
      break;
    }
    case "reorder": {
      await runCommand(async () => {
        const keys = parseReorderKeys(args, "loctt task-type reorder <key,key,…>");
        await reorderTaskTypes(locttDir, keys);
        console.log(`Reordered task types`);
      });
      break;
    }
    default:
      usageError("task-type", "list|add|edit|rm|reorder");
  }
}

/**
 * Shared `rm` handler for the scalar collections (status/priority/task-type)
 * whose core delete takes an optional `remapTo`. Confirms the destructive
 * write, then hands the (possibly undefined) remap target through — core
 * refuses when the key is in use and no `--remap-to` was given.
 */
async function removeScalar(
  args: string[],
  entity: string,
  del: (key: string, remapTo: string | undefined) => Promise<void>,
): Promise<void> {
  const key = args[2];
  if (!key || key.startsWith("--")) {
    console.error(`Error: missing ${entity} key`);
    console.error(`Usage: loctt ${entity.replace(" ", "-")} rm <key> [--remap-to <key>] [--yes]`);
    process.exitCode = EXIT.USAGE;
    return;
  }
  const remapTo = remapToArg(args);
  const outcome = await confirmHardDelete(
    args,
    `Delete ${entity} "${key}"? This rewrites tasks that use it.`,
  );
  if (outcome !== "yes") {
    process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
    return;
  }
  await runCommand(async () => {
    await del(key, remapTo);
    const suffix = remapTo !== undefined ? ` (remapped to "${remapTo}")` : "";
    console.log(`Deleted ${entity} "${key}"${suffix}`);
  });
}

// ---------------------------------------------------------------------------
// relationship (no reorder)
// ---------------------------------------------------------------------------

export async function relationship(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      for (const r of cfg.relationships) {
        const kind = r.kind !== undefined ? ` [${r.kind}]` : "";
        const inv = r.inverse ? ` ↔ ${r.inverse}` : "";
        const graph = r.graph && r.graph !== "none" ? ` [${r.graph}]` : "";
        const ranked = r.ranked ? " [ranked]" : "";
        console.log(`${r.key}: ${r.label}${inv}${kind}${graph}${ranked}`);
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        const usage = `loctt relationship add <key> --label <text> [--kind <directional|symmetric>] [--inverse <key>] [--inverse-label <text>] [--graph <none|acyclic|tree>] [--ranked] [--icon <s>] [--color <${COLOR_ARG_SYNTAX}>]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        const kind = enumArg(args, "--kind", VALID_RELATIONSHIP_KINDS);
        const inverse = getArg(args, "--inverse");
        const inverseLabel = getArg(args, "--inverse-label");
        const graph = enumArg(args, "--graph", VALID_RELATIONSHIP_GRAPHS);
        await createRelationship(locttDir, {
          key,
          label,
          ...(kind !== undefined ? { kind } : {}),
          ...(inverse !== undefined ? { inverse } : {}),
          ...(inverseLabel !== undefined ? { inverse_label: inverseLabel } : {}),
          ...(graph !== undefined ? { graph } : {}),
          ...(hasFlag(args, "--ranked") ? { ranked: true } : {}),
          ...iconColorCreate(args),
        });
        console.log(`Created relationship "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt relationship edit <key> [--label <text>] [--kind <k>] [--inverse <key>] [--inverse-label <text>] [--graph <g>] [--ranked] [--icon <s|->] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        const kind = enumArg(args, "--kind", VALID_RELATIONSHIP_KINDS);
        const inverse = getArg(args, "--inverse");
        const inverseLabel = getArg(args, "--inverse-label");
        const graph = enumArg(args, "--graph", VALID_RELATIONSHIP_GRAPHS);
        const ranked = hasFlag(args, "--ranked");
        const iconColor = iconColorChange(args);
        if (
          label === undefined && kind === undefined && inverse === undefined &&
          inverseLabel === undefined && graph === undefined && !ranked &&
          iconColor.icon === undefined && iconColor.color === undefined
        ) {
          throw new UsageError("nothing to change", usage);
        }
        await editRelationship(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(inverse !== undefined ? { inverse } : {}),
          ...(inverseLabel !== undefined ? { inverse_label: inverseLabel } : {}),
          ...(graph !== undefined ? { graph } : {}),
          ...(ranked ? { ranked: true } : {}),
          ...iconColor,
        });
        console.log(`Updated relationship "${key}"`);
      });
      break;
    }
    case "rm": {
      const key = args[2];
      if (!key || key.startsWith("--")) {
        console.error(`Error: missing relationship key`);
        console.error(`Usage: loctt relationship rm <key> [--remap-to <key>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = remapToArg(args);
      const outcome = await confirmHardDelete(
        args,
        `Delete relationship "${key}"? This rewrites links that use it.`,
      );
      if (outcome !== "yes") {
        process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
        break;
      }
      await runCommand(async () => {
        await deleteRelationship(locttDir, key, remapTo);
        const suffix = remapTo !== undefined ? ` (remapped to "${remapTo}")` : "";
        console.log(`Deleted relationship "${key}"${suffix}`);
      });
      break;
    }
    default:
      usageError("relationship", "list|add|edit|rm");
  }
}

// ---------------------------------------------------------------------------
// custom-field (whole delete is clear-only, NO --remap-to) + its enum values
// ---------------------------------------------------------------------------

export async function customField(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      for (const f of cfg.custom_fields) {
        const multi = f.multi ? " multi" : "";
        const searchable = f.searchable ? " searchable" : "";
        const scope = f.task_types ? `  [types: ${f.task_types.join(",")}]` : "";
        console.log(`${f.key} (${f.type}${multi}${searchable}): ${f.label}${scope}`);
        for (const v of f.values ?? []) {
          console.log(`    - ${v.key}: ${v.label}`);
        }
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        const usage = `loctt custom-field add <key> --label <text> --type <${VALID_FIELD_TYPES.join("|")}> [--multi] [--searchable] [--task-types a,b] [--enum-value key=label]…`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        const type = enumArg(args, "--type", VALID_FIELD_TYPES);
        if (type === undefined) throw new UsageError("missing --type", usage);
        const taskTypes = parseTaskTypes(getArg(args, "--task-types"));
        // An enum field must be seeded with at least one value at create
        // time (core rejects an empty enum), matching the web dialog which
        // collects value rows alongside the field. `--enum-value key=label`
        // is repeatable; it is meaningless (and refused) for a non-enum
        // type. It is deliberately NOT `--value`, which stays reserved so
        // `priority add --value` still fails as an unknown option (priority
        // value is never settable, D20).
        const values = parseFieldValueSeeds(args);
        if (type === "enum" && values.length === 0) {
          throw new UsageError(
            `an enum field needs at least one value at creation — pass --enum-value key=label (repeatable)`,
            usage,
          );
        }
        if (type !== "enum" && values.length > 0) {
          throw new UsageError(`--enum-value is only meaningful for --type enum`, usage);
        }
        await createCustomField(locttDir, {
          key,
          label,
          type,
          multi: hasFlag(args, "--multi"),
          searchable: hasFlag(args, "--searchable"),
          ...(values.length > 0 ? { values } : {}),
          // task_types: `-` (clear) is nonsensical on create; treat only a
          // real list as given. parseTaskTypes returns null for `-`.
          ...(taskTypes !== undefined && taskTypes !== null ? { task_types: taskTypes } : {}),
        });
        console.log(`Created custom field "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        // NO --type / --multi: both immutable after create (SET-16).
        const usage = `loctt custom-field edit <key> [--label <text>] [--searchable[=true|false]] [--task-types a,b|-]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        // --searchable is a settable boolean here (create defaults false);
        // its presence/absence is the change signal, so read explicitly.
        const searchableGiven = args.some(a => a === "--searchable" || a.startsWith("--searchable="));
        const searchable = searchableGiven ? hasFlag(args, "--searchable") : undefined;
        const taskTypes = parseTaskTypes(getArg(args, "--task-types"));
        if (label === undefined && searchable === undefined && taskTypes === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editCustomField(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(searchable !== undefined ? { searchable } : {}),
          ...(taskTypes !== undefined ? { task_types: taskTypes } : {}),
        });
        console.log(`Updated custom field "${key}"`);
      });
      break;
    }
    case "rm": {
      // Clear-only: NO --remap-to. Deleting a field clears it (and any
      // stored values) from every task.
      const key = args[2];
      if (!key || key.startsWith("--")) {
        console.error(`Error: missing custom-field key`);
        console.error(`Usage: loctt custom-field rm <key> [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const outcome = await confirmHardDelete(
        args,
        `Delete custom field "${key}"? This clears it from every task (no remap).`,
      );
      if (outcome !== "yes") {
        process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
        break;
      }
      await runCommand(async () => {
        await deleteCustomField(locttDir, key);
        console.log(`Deleted custom field "${key}"`);
      });
      break;
    }
    case "value": {
      await customFieldValue(args, locttDir);
      break;
    }
    default:
      usageError("custom-field", "list|add|edit|rm|value");
  }
}

/**
 * `loctt custom-field value <field> <add|edit|rm|reorder> …` — the enum
 * values of one custom field. `<field>` sits at args[2]; the value
 * subcommand at args[3], the value key at args[4].
 */
async function customFieldValue(args: string[], locttDir: string): Promise<void> {
  const fieldKey = args[2];
  const vsub = args[3];
  const usageTop = `loctt custom-field value <field> <add|edit|rm|reorder> …`;
  if (!fieldKey || fieldKey.startsWith("--")) {
    console.error(`Error: missing field key`);
    console.error(`Usage: ${usageTop}`);
    process.exitCode = EXIT.USAGE;
    return;
  }
  switch (vsub) {
    case "add": {
      await runCommand(async () => {
        const usage = `loctt custom-field value <field> add <key> --label <text> [--icon <s>] [--color <${COLOR_ARG_SYNTAX}>]`;
        const key = positional(args, 4, usage);
        if (!key) throw new UsageError("missing value key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        await addFieldValue(locttDir, fieldKey, { key, label, ...iconColorCreate(args) });
        console.log(`Added value "${key}" to custom field "${fieldKey}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt custom-field value <field> edit <key> [--label <text>] [--icon <s|->] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const key = positional(args, 4, usage);
        if (!key) throw new UsageError("missing value key", usage);
        const label = getArg(args, "--label");
        const iconColor = iconColorChange(args);
        if (label === undefined && iconColor.icon === undefined && iconColor.color === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editFieldValue(locttDir, fieldKey, key, {
          ...(label !== undefined ? { label } : {}),
          ...iconColor,
        });
        console.log(`Updated value "${key}" of custom field "${fieldKey}"`);
      });
      break;
    }
    case "rm": {
      const key = args[4];
      if (!key || key.startsWith("--")) {
        console.error(`Error: missing value key`);
        console.error(`Usage: loctt custom-field value <field> rm <key> [--remap-to <key>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = remapToArg(args);
      const outcome = await confirmHardDelete(
        args,
        `Delete value "${key}" of custom field "${fieldKey}"? This rewrites tasks that use it.`,
      );
      if (outcome !== "yes") {
        process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
        break;
      }
      await runCommand(async () => {
        await deleteFieldValue(locttDir, fieldKey, key, remapTo);
        const suffix = remapTo !== undefined ? ` (remapped to "${remapTo}")` : "";
        console.log(`Deleted value "${key}" of custom field "${fieldKey}"${suffix}`);
      });
      break;
    }
    case "reorder": {
      await runCommand(async () => {
        const usage = `loctt custom-field value <field> reorder <key,key,…>`;
        const raw = args[4];
        if (!raw || raw.startsWith("--")) throw new UsageError("missing key list", usage);
        const keys = raw.split(",").map(k => k.trim()).filter(k => k.length > 0);
        if (keys.length === 0) throw new UsageError("key list is empty", usage);
        await reorderFieldValues(locttDir, fieldKey, keys);
        console.log(`Reordered values of custom field "${fieldKey}"`);
      });
      break;
    }
    default:
      console.error(`Usage: ${usageTop}`);
      process.exitCode = EXIT.USAGE;
  }
}

// ---------------------------------------------------------------------------
// board-column (no task data — delete carries no remap)
// ---------------------------------------------------------------------------

export async function boardColumn(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "list": {
      const cfg = await loadWorkflowConfig(locttDir);
      const columns = cfg.boards?.columns ?? [];
      if (columns.length === 0) {
        console.log("No board columns (default: one column per status).");
        break;
      }
      for (const c of columns) {
        const wip = c.wip !== undefined ? `  [wip: ${c.wip}]` : "";
        console.log(`${c.key}: ${c.label}  {${c.statuses.join(", ")}}${wip}`);
      }
      break;
    }
    case "add": {
      await runCommand(async () => {
        const usage = `loctt board-column add <key> --label <text> --statuses <s,s,…> [--wip <n>]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        if (label === undefined) throw new UsageError("missing --label", usage);
        const statusesRaw = getArg(args, "--statuses");
        if (statusesRaw === undefined) throw new UsageError("missing --statuses", usage);
        const statuses = statusesRaw.split(",").map(s => s.trim()).filter(s => s.length > 0);
        const wip = parseWip(getArg(args, "--wip"));
        await createBoardColumn(locttDir, {
          key,
          label,
          statuses,
          ...(wip !== undefined && wip !== null ? { wip } : {}),
        });
        console.log(`Created board column "${key}"`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const usage = `loctt board-column edit <key> [--label <text>] [--statuses <s,s,…>] [--wip <n|->]`;
        const key = positional(args, 2, usage);
        if (!key) throw new UsageError("missing key", usage);
        const label = getArg(args, "--label");
        const statusesRaw = getArg(args, "--statuses");
        const statuses = statusesRaw !== undefined
          ? statusesRaw.split(",").map(s => s.trim()).filter(s => s.length > 0)
          : undefined;
        const wip = parseWip(getArg(args, "--wip"));
        if (label === undefined && statuses === undefined && wip === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editBoardColumn(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(statuses !== undefined ? { statuses } : {}),
          // wip: null clears, a number sets, undefined leaves unchanged.
          ...(wip !== undefined ? { wip } : {}),
        });
        console.log(`Updated board column "${key}"`);
      });
      break;
    }
    case "rm": {
      const key = args[2];
      if (!key || key.startsWith("--")) {
        console.error(`Error: missing board-column key`);
        console.error(`Usage: loctt board-column rm <key> [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const outcome = await confirmHardDelete(
        args,
        `Delete board column "${key}"? (deleting the last column reverts to one column per status)`,
      );
      if (outcome !== "yes") {
        process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
        break;
      }
      await runCommand(async () => {
        await deleteBoardColumn(locttDir, key);
        console.log(`Deleted board column "${key}"`);
      });
      break;
    }
    case "reorder": {
      await runCommand(async () => {
        const keys = parseReorderKeys(args, "loctt board-column reorder <key,key,…>");
        await reorderBoardColumns(locttDir, keys);
        console.log(`Reordered board columns`);
      });
      break;
    }
    default:
      usageError("board-column", "list|add|edit|rm|reorder");
  }
}

/** Parses `--wip`: `-` clears (null), a non-negative integer sets, absent leaves undefined. */
function parseWip(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "-") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
    throw new UsageError(`--wip must be a non-negative integer or "-" to clear (got "${raw}")`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// estimation (singleton)
// ---------------------------------------------------------------------------

export async function estimation(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "show": {
      const cfg = await loadWorkflowConfig(locttDir);
      const e = cfg.estimation;
      if (!e) {
        console.log("Estimation is not configured.");
        break;
      }
      console.log(`enabled: ${e.enabled}`);
      console.log(`unit: ${e.unit}`);
      if (e.unit_label !== undefined) console.log(`unit_label: ${e.unit_label}`);
      if (e.scale !== undefined) console.log(`scale: ${e.scale}`);
      if (e.preset_values !== undefined) console.log(`preset_values: ${e.preset_values.join(", ")}`);
      if (e.weights !== undefined) {
        console.log(`weights:`);
        for (const [k, v] of Object.entries(e.weights)) console.log(`  ${k}: ${v}`);
      }
      break;
    }
    case "set": {
      await runCommand(async () => {
        const usage = `loctt estimation set [--enabled[=true|false]] [--unit <${VALID_ESTIMATION_UNITS.join("|")}>] [--unit-label <text|->] [--scale <free|linear|fibonacci|->] [--preset <a,b,c|->] [--weight key=n]…`;
        const enabledGiven = args.some(a => a === "--enabled" || a.startsWith("--enabled="));
        const enabled = enabledGiven ? hasFlag(args, "--enabled") : undefined;
        const unit = enumArg(args, "--unit", VALID_ESTIMATION_UNITS);
        const unitLabelRaw = getArg(args, "--unit-label");
        const scaleRaw = getArg(args, "--scale");
        const presetRaw = getArg(args, "--preset");
        const weights = parseWeights(args);

        const unit_label = unitLabelRaw === undefined ? undefined : unitLabelRaw === "-" ? null : unitLabelRaw;
        const scale = scaleRaw === undefined ? undefined
          : scaleRaw === "-" ? null
          : (VALID_ESTIMATION_SCALES.includes(scaleRaw as EstimationScale)
            ? (scaleRaw as EstimationScale)
            : (() => { throw new UsageError(`--scale must be one of: ${VALID_ESTIMATION_SCALES.join(", ")} or "-" (got "${scaleRaw}")`); })());
        const preset_values = parsePreset(presetRaw);

        if (
          enabled === undefined && unit === undefined && unit_label === undefined &&
          scale === undefined && preset_values === undefined && weights === undefined
        ) {
          throw new UsageError("nothing to change", usage);
        }
        await editEstimationConfig(locttDir, {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(unit !== undefined ? { unit } : {}),
          ...(unit_label !== undefined ? { unit_label } : {}),
          ...(scale !== undefined ? { scale } : {}),
          ...(preset_values !== undefined ? { preset_values } : {}),
          ...(weights !== undefined ? { weights } : {}),
        });
        console.log(`Updated estimation config`);
      });
      break;
    }
    default:
      usageError("estimation", "show|set");
  }
}

/** Parses `--preset a,b,c` (numbers where they parse, else strings) or `-` to clear. */
function parsePreset(raw: string | undefined): (number | string)[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "-") return null;
  return raw.split(",").map(p => p.trim()).filter(p => p.length > 0).map(p => {
    const n = Number(p);
    return p !== "" && !Number.isNaN(n) ? n : p;
  });
}

/**
 * Collects repeated `--weight key=n` flags into an `EstimationWeights` map,
 * or `-` (as `--weight -`) to clear. Returns undefined when no `--weight`
 * was given. Repeated because a shell passes each entry as its own flag.
 */
function parseWeights(args: string[]): Record<string, number> | null | undefined {
  const entries: [string, number][] = [];
  let sawClear = false;
  let sawAny = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    let raw: string | undefined;
    if (a === "--weight") {
      raw = args[i + 1];
      i += 1;
    } else if (a?.startsWith("--weight=")) {
      raw = a.slice("--weight=".length);
    } else {
      continue;
    }
    sawAny = true;
    if (raw === "-") { sawClear = true; continue; }
    if (raw === undefined) throw new UsageError(`--weight needs a key=n value`);
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`--weight must be key=n (got "${raw}")`);
    const key = raw.slice(0, eq);
    const n = Number(raw.slice(eq + 1));
    if (Number.isNaN(n) || n < 0) throw new UsageError(`--weight value for "${key}" must be a non-negative number`);
    entries.push([key, n]);
  }
  if (!sawAny) return undefined;
  if (sawClear && entries.length === 0) return null;
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// timeline (singleton)
// ---------------------------------------------------------------------------

export async function timeline(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const locttDir = resolveLocttDir(root);
  const sub = args[1];
  switch (sub) {
    case undefined:
    case "show": {
      const cfg = await loadWorkflowConfig(locttDir);
      const t = cfg.timeline;
      if (!t) {
        console.log("Timeline is not configured.");
        break;
      }
      if (t.dependency_relationship !== undefined) console.log(`dependency_relationship: ${t.dependency_relationship}`);
      if (t.default_zoom !== undefined) console.log(`default_zoom: ${t.default_zoom}`);
      if (t.show_arrows !== undefined) console.log(`show_arrows: ${t.show_arrows}`);
      if (t.default_grouping !== undefined) console.log(`default_grouping: ${t.default_grouping}`);
      break;
    }
    case "set": {
      await runCommand(async () => {
        const usage = `loctt timeline set [--dependency-relationship <key|->] [--default-zoom <day|week|month|->] [--show-arrows[=true|false]] [--default-grouping <builtin|field.key|->]`;
        // dependency_relationship: `-` is the explicit "no arrows" value
        // (null), NOT a clear-to-unset — core writes null through.
        const depRaw = getArg(args, "--dependency-relationship");
        const dependency_relationship = depRaw === undefined ? undefined : depRaw === "-" ? null : depRaw;
        const zoomRaw = getArg(args, "--default-zoom");
        const default_zoom = zoomRaw === undefined ? undefined
          : zoomRaw === "-" ? null
          : (VALID_TIMELINE_ZOOMS.includes(zoomRaw as TimelineZoom)
            ? (zoomRaw as TimelineZoom)
            : (() => { throw new UsageError(`--default-zoom must be one of: ${VALID_TIMELINE_ZOOMS.join(", ")} or "-" (got "${zoomRaw}")`); })());
        const arrowsGiven = args.some(a => a === "--show-arrows" || a.startsWith("--show-arrows="));
        const show_arrows = arrowsGiven ? hasFlag(args, "--show-arrows") : undefined;
        const groupRaw = getArg(args, "--default-grouping");
        const default_grouping = groupRaw === undefined ? undefined
          : groupRaw === "-" ? null
          : (groupRaw as TimelineGrouping);

        if (
          dependency_relationship === undefined && default_zoom === undefined &&
          show_arrows === undefined && default_grouping === undefined
        ) {
          throw new UsageError("nothing to change", usage);
        }
        await editTimelineConfig(locttDir, {
          ...(dependency_relationship !== undefined ? { dependency_relationship } : {}),
          ...(default_zoom !== undefined ? { default_zoom } : {}),
          ...(show_arrows !== undefined ? { show_arrows } : {}),
          ...(default_grouping !== undefined ? { default_grouping } : {}),
        });
        console.log(`Updated timeline config`);
      });
      break;
    }
    default:
      usageError("timeline", "show|set");
  }
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function usageError(command: string, subs: string): void {
  console.error(`Usage: loctt ${command} <${subs}> ...`);
  process.exitCode = EXIT.USAGE;
}
