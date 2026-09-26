
import type {
  BrokenEntry,
  CustomFieldDef,
  PriorityDef,
  RelationshipDef,
  StatusDef,
  TaskTypeDef,
  WorkflowBroken,
  WorkflowConfig,
} from "@loctt/contracts";
import {
  BoardsConfigSchema,
  CliConfigSchema,
  CustomFieldDefSchema,
  EstimationConfigSchema,
  KeyConfigSchema,
  PriorityDefSchema,
  RelationshipDefSchema,
  StatusDefSchema,
  TaskTypeDefSchema,
  TimelineConfigSchema,
} from "@loctt/contracts";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getWorkflowConfigPath } from "../paths/index.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { collectValidEntries } from "./health.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

/** Errors thrown when workflow config is invalid. */
export class WorkflowConfigError extends LocttError {
  constructor(message: string) {
    // `config_invalid`, not the `unknown` an un-attributed Error
    // falls back to. The message already names the file, the field
    // path and what was expected (ERR-10); what was missing was a
    // code, so every surface reported a schema problem as an
    // unexplained server failure. V1: core states its own cause.
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
    this.name = "WorkflowConfigError";
  }
}

/**
 * The outer shape of workflow.yaml. The five sub-lists
 * (statuses/priorities/task_types/relationships/custom_fields) are held
 * as `z.array(z.unknown())` here so a single wrong-typed ENTRY degrades to
 * a `BrokenEntry` (via `collectValidEntries` below) instead of the strict
 * per-entry schema throwing and blanking the whole workflow — which drives
 * rendering on every task surface (statuses especially: a task's `status`
 * resolves against them). Everything else stays object-fatal:
 *
 *  - `key` (the prefix) is identity-bearing; a missing/malformed one has
 *    no coherent degrade.
 *  - a missing or non-array sub-list is not a collection to degrade around.
 *  - `estimation` / `boards` / `timeline` / `cli` are single records, not
 *    lists — there is no "one bad entry among many" to set aside, and each
 *    is structurally load-bearing (boards drives column layout, estimation
 *    drives burndown). A malformed one still throws, exactly as before.
 *  - an unknown top-level key still throws (`.strict()`), as before.
 */
const RawWorkflowConfigSchema = z.object({
  key: KeyConfigSchema,
  cli: CliConfigSchema.optional(),
  statuses: z.array(z.unknown()),
  priorities: z.array(z.unknown()),
  task_types: z.array(z.unknown()),
  relationships: z.array(z.unknown()),
  custom_fields: z.array(z.unknown()),
  estimation: EstimationConfigSchema.optional(),
  boards: BoardsConfigSchema.optional(),
  timeline: TimelineConfigSchema.optional(),
}).strict();

/**
 * Parses and validates raw YAML content into a WorkflowConfig.
 *
 * TWO modes, because `parseWorkflowConfig` has two callers with opposite
 * needs and one contract cannot serve both:
 *
 *  - **Strict (default).** Any per-entry fault throws, exactly as this
 *    function always has. This is the WRITE gate: `assertWorkflowConfigValid`
 *    round-trips a caller's config through `parseWorkflowConfig(serialize(cfg))`
 *    and relies on the THROW to reject a bad edit *before* it touches disk
 *    (an enum with empty `values`, a status with a bad category). Degrading
 *    silently here would let those writes land — so strict stays the
 *    default, preserving the long-standing public contract.
 *  - **Tolerant (`{ tolerant: true }`).** The five sub-lists
 *    (statuses/priorities/task_types/relationships/custom_fields) degrade
 *    per-entry (north-star principle 5): a good entry loads, a corrupt one
 *    becomes a `BrokenEntry` grouped under its sub-list in `broken`, and the
 *    rest of the workflow still loads. Degrading a bad status leaves every
 *    GOOD status resolvable, so tasks on healthy statuses render even when
 *    one status entry was hand-broken. This is the READ path
 *    (`loadWorkflowConfig`): a workflow.yaml already on disk must never be
 *    made wholly unloadable by one bad entry.
 *
 * In BOTH modes, object-fatal problems throw with an attributed message: a
 * malformed outer structure, a missing/non-array sub-list, a malformed
 * scalar config (`key`/`estimation`/`boards`/`timeline`/`cli`), or an
 * unknown top-level key — see `RawWorkflowConfigSchema`. There is no
 * coherent collection to degrade around for any of those.
 *
 * Cross-entry consistency (duplicate keys, dangling board statuses,
 * relationship inverse collisions) is deliberately NOT checked here: a
 * config already on disk is reported by `loctt doctor`
 * (`validateWorkflowConfig`) rather than made unloadable, exactly as
 * before. Every *write* runs those checks — `saveWorkflowConfig` rejects
 * rather than persisting a config `doctor` would flag.
 *
 * The one cross-entry invariant this loader enforces is the schema's
 * "exactly one default status" rule. In tolerant mode it fires only when
 * statuses parsed cleanly: if any status degraded, the survivors' default
 * count is not trustworthy (the corrupt entry may have been the default),
 * and failing on it would blank the workflow over a single bad entry — the
 * very thing degradation exists to prevent. So when a status is broken, the
 * default-count check is skipped; the broken entry is surfaced in
 * `broken.statuses`, and `defaultStatus()` falls back to the first status.
 * In strict mode a broken status has already thrown, so the check always
 * runs — the default-count rule fires exactly as it did before.
 */
export function parseWorkflowConfig(
  yamlContent: string,
  options: { tolerant?: boolean } = {},
): WorkflowConfig {
  const tolerant = options.tolerant === true;
  const raw: unknown = safeParseYaml(yamlContent, "workflow.yaml");

  let outer: z.infer<typeof RawWorkflowConfigSchema>;
  try {
    outer = RawWorkflowConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new WorkflowConfigError(`workflow.yaml is not valid: ${formatZodIssues("workflow config", err)}`);
    }
    throw err;
  }

  const statuses = collectValidEntries<StatusDef>(outer.statuses, StatusDefSchema, "status", keyOf);
  const priorities = collectValidEntries<PriorityDef>(outer.priorities, PriorityDefSchema, "priority", keyOf);
  const taskTypes = collectValidEntries<TaskTypeDef>(outer.task_types, TaskTypeDefSchema, "task_type", keyOf);
  const relationships = collectValidEntries<RelationshipDef>(outer.relationships, RelationshipDefSchema, "relationship", keyOf);
  const customFields = collectValidEntries<CustomFieldDef>(outer.custom_fields, CustomFieldDefSchema, "custom_field", keyOf);

  const brokenPairs: readonly [keyof WorkflowBroken, BrokenEntry[]][] = [
    ["statuses", statuses.broken],
    ["priorities", priorities.broken],
    ["task_types", taskTypes.broken],
    ["relationships", relationships.broken],
    ["custom_fields", customFields.broken],
  ];

  // Strict mode: a per-entry fault is fatal, preserving the pre-tolerance
  // contract the write gate depends on. Report the first broken sub-list's
  // first entry with the same attributed shape a whole-config parse used to
  // produce, so callers that matched on the message still match.
  if (!tolerant) {
    for (const [list, entries] of brokenPairs) {
      const e = entries[0];
      if (e !== undefined) {
        const where = e.id !== undefined ? `${list}[${e.index}] (${e.id})` : `${list}[${e.index}]`;
        throw new WorkflowConfigError(`workflow.yaml is not valid: ${where} ${e.error}`);
      }
    }
  }

  // Exactly one default status. A per-entry schema cannot see siblings, so
  // this cross-entry rule lives here. When a status degraded (tolerant mode
  // only — strict has already thrown), the survivors' default count is not
  // trustworthy, so the check is skipped and the broken entry stands alone
  // in `broken.statuses`.
  if (statuses.broken.length === 0 && statuses.valid.length > 0) {
    const defaults = statuses.valid.filter(s => s.default === true);
    if (defaults.length === 0) {
      throw new WorkflowConfigError(
        `workflow.yaml is not valid: statuses must have exactly one status with 'default: true', but none does. Add it to the status new tasks should start in.`,
      );
    }
    if (defaults.length > 1) {
      throw new WorkflowConfigError(
        `workflow.yaml is not valid: statuses must have exactly one status with 'default: true', but ${defaults.length} do: ${defaults.map(s => s.key).join(", ")}.`,
      );
    }
  }

  const broken: WorkflowBroken = {};
  for (const [list, entries] of brokenPairs) {
    if (entries.length > 0) broken[list] = entries;
  }
  const hasBroken = Object.keys(broken).length > 0;

  return {
    key: outer.key,
    ...(outer.cli !== undefined ? { cli: outer.cli } : {}),
    statuses: statuses.valid,
    priorities: priorities.valid,
    task_types: taskTypes.valid,
    relationships: relationships.valid,
    custom_fields: customFields.valid,
    ...(outer.estimation !== undefined ? { estimation: outer.estimation } : {}),
    ...(outer.boards !== undefined ? { boards: outer.boards } : {}),
    ...(outer.timeline !== undefined ? { timeline: outer.timeline } : {}),
    // Omitted (not `{}`) when everything parsed — a consumer reading only
    // `statuses` etc. is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk. Only ever populated
    // in tolerant mode (strict mode threw before reaching here).
    ...(hasBroken ? { broken } : {}),
  };
}

/**
 * Names a workflow sub-list entry by its `key` when it still carries a
 * readable one, so a `BrokenEntry` can say WHICH status/priority/… is
 * broken. Workflow entries are keyed by `key` (not `id`), so the default
 * `id`-reader in `collectValidEntries` would never find one. Must never
 * throw — a corrupt entry may have no key at all.
 */
function keyOf(raw: unknown): string | undefined {
  if (raw !== null && typeof raw === "object" && "key" in raw) {
    const key = (raw as { key: unknown }).key;
    if (typeof key === "string" && key.length > 0) return key;
  }
  return undefined;
}

export async function loadWorkflowConfig(locttDir: string): Promise<WorkflowConfig> {
  const filePath = getWorkflowConfigPath(locttDir);
  // Rethrown as a named cause rather than a bare errno: these throw on
  // absence too (deliberately — the file is required), so the caller
  // needs to know which file and why.
  const file = await readFileState(filePath);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT", path: filePath });
  }
  // Tolerant on read: a workflow.yaml already on disk must never be made
  // wholly unloadable by one hand-broken entry (north-star principle 5).
  // One bad status/priority/type/relationship/custom-field degrades to a
  // `BrokenEntry` in `broken` and the rest of the workflow loads, so every
  // task on a GOOD status still resolves and renders. Writes stay strict —
  // `saveWorkflowConfig` round-trips through the default (throwing) mode.
  return parseWorkflowConfig(file.content, { tolerant: true });
}
