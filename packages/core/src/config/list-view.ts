
import type { BrokenEntry, ListViewConfig, ListViewFilters } from "@loctt/contracts";
import { ListViewConfigSchema, RawListViewConfigSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getListViewConfigPath } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { collectValidEntries } from "./health.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

/**
 * Errors thrown when `list-view.yaml` is invalid. The file is committed
 * and hand-editable, so a parse failure should give the user a clear
 * line/path to fix rather than a stack trace.
 */
export class ListViewConfigError extends LocttError {
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
    this.name = "ListViewConfigError";
  }
}

/** One filter-chip key: a non-empty string. The per-ENTRY unit that degrades. */
const ChipKeySchema = z.string().min(1);

/**
 * The `collectValidEntries` labels for the two chip arrays. A broken
 * chip's `error` is prefixed with its label (`formatZodIssues`), which is
 * the only signal recording *which* array it came from — `BrokenEntry`
 * itself carries no array tag. K28 preservation (`buildPlainObject`) reads
 * these prefixes back to splice a broken chip into the array it belongs to.
 */
const VISIBLE_CHIP_LABEL = "list-view visible chip";
const HIDDEN_CHIP_LABEL = "list-view hidden chip";

/**
 * Parses raw YAML content into a `ListViewConfig`. Throws
 * `ListViewConfigError` with a formatted message on an object-fatal
 * schema violation; degrades a per-entry one to a `BrokenEntry`.
 *
 * list-view.yaml is more record-shaped than the other list configs:
 * its only genuine per-entry lists are the `filters.visible` and
 * `filters.hidden` chip-key arrays. Those degrade per entry (a
 * non-string or empty chip key becomes a `BrokenEntry`; the good keys
 * in the same array still load) — the VUE-22 pattern generalized via
 * `collectValidEntries`.
 *
 * Everything else stays object-fatal, because there is no coherent
 * collection to degrade around (ground rule 1):
 *  - a malformed outer structure (not an object, unknown top-level or
 *    `filters` keys, `filters` not an object);
 *  - a `visible`/`hidden` that is not an array at all;
 *  - the cross-entry checks (a duplicate within an array, a key in both
 *    arrays) — a duplicate or an overlap is an *ambiguity* the loader
 *    cannot silently resolve, exactly like the duplicate-id check in
 *    `queries.ts`, so it throws rather than degrading.
 */
export function parseListViewConfig(yamlContent: string): ListViewConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "list-view.yaml"));

  // Object-fatal outer shape: `{ filters?: { visible?: [], hidden?: [] } }`
  // with no stray keys and both sub-fields genuine arrays. The entries
  // stay `unknown` here so one corrupt chip key does not fail the whole
  // `.parse()` and blank the saved view (that is the per-entry degrade
  // below). A stray `broken:` is rejected: RawListViewConfigSchema has no
  // such key.
  let outer: z.infer<typeof RawListViewConfigSchema>;
  try {
    outer = RawListViewConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ListViewConfigError(`list-view.yaml is not valid: ${formatZodIssues("list-view config", err)}`);
    }
    throw err;
  }

  if (!outer.filters) return {};

  // Per-ENTRY degrade (north-star principle 5). A wrong-typed or empty
  // chip key in one array no longer blanks every chip in the file: that
  // entry becomes a `BrokenEntry` (index + raw text + validator message)
  // and the rest load. `label` names which array so a surface can point
  // at the right one — a chip key has no id to name it by.
  const broken: BrokenEntry[] = [];
  const filters: ListViewFilters = {};

  if (outer.filters.visible !== undefined) {
    const { valid, broken: brk } = collectValidEntries<string>(
      outer.filters.visible, ChipKeySchema, VISIBLE_CHIP_LABEL,
    );
    broken.push(...brk);
    filters.visible = valid;
  }
  if (outer.filters.hidden !== undefined) {
    const { valid, broken: brk } = collectValidEntries<string>(
      outer.filters.hidden, ChipKeySchema, HIDDEN_CHIP_LABEL,
    );
    broken.push(...brk);
    filters.hidden = valid;
  }

  // Cross-entry, object-fatal — run only over the entries that validated
  // (a `BrokenEntry` has no trustworthy key to collide on). A duplicate
  // within an array or a key in both arrays is an ambiguity the loader
  // cannot silently resolve, so it throws exactly as before.
  assertNoDuplicates(filters.visible, "visible");
  assertNoDuplicates(filters.hidden, "hidden");
  assertNoOverlap(filters.visible, filters.hidden);

  // Re-run the full contract schema over the reassembled, salvaged config
  // so the returned value is exactly a `ListViewConfig` and any invariant
  // not covered above still holds. It cannot fail on the checks above
  // (already enforced) and the entries are now known-good strings.
  const parsed = ListViewConfigSchema.parse({
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  });

  return {
    ...parsed,
    // Omitted, not `[]`, when everything parsed — so a consumer reading
    // only `filters` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

/** Object-fatal: a chip key repeated within one array is ambiguous. */
function assertNoDuplicates(arr: readonly string[] | undefined, field: "visible" | "hidden"): void {
  if (!arr) return;
  const seen = new Set<string>();
  for (const k of arr) {
    if (seen.has(k)) {
      throw new ListViewConfigError(`list-view.yaml is not valid: duplicate entry '${k}' in ${field}`);
    }
    seen.add(k);
  }
}

/** Object-fatal: a key in both `visible` and `hidden` is contradictory. */
function assertNoOverlap(visible: readonly string[] | undefined, hidden: readonly string[] | undefined): void {
  if (!visible || !hidden) return;
  const hiddenSet = new Set(hidden);
  for (const k of visible) {
    if (hiddenSet.has(k)) {
      throw new ListViewConfigError(`list-view.yaml is not valid: '${k}' appears in both visible and hidden`);
    }
  }
}

/**
 * Loads `.loctt/config/list-view.yaml`. Returns an empty config (which
 * the UI interprets as "show every chip by default") when the file is
 * absent — the workspace doesn't have to opt in.
 */
export async function loadListViewConfig(locttDir: string): Promise<ListViewConfig> {
  const path = getListViewConfigPath(locttDir);
  // Absent is a supported state; unreadable is not. V9: a config value
  // is a definition other data references, not a record of an event, so
  // LocTT refuses rather than building on one it could not read. The
  // file is never written over, which is what P-11 protects.
  const file = await readFileState(path);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") return {};
  if (file.content.trim() === "") return {};
  return parseListViewConfig(file.content);
}

/**
 * Atomically writes `list-view.yaml`. Runs the schema on the value
 * being written so a programmatic caller can't poke a malformed shape
 * onto disk.
 */
export async function saveListViewConfig(
  locttDir: string,
  config: ListViewConfig,
): Promise<void> {
  const validated = ListViewConfigSchema.parse(config);
  await writeYamlAtomically(getListViewConfigPath(locttDir), buildPlainObject(validated));
}

/**
 * Removes any references to `removedCustomFieldKeys` from the
 * `list-view.yaml#filters.visible/hidden` arrays. Returns a new config
 * (does not mutate). Used by `applyWorkflowEdit` to keep the list-view
 * config consistent when custom fields are deleted from `workflow.yaml`.
 *
 * The function string-matches blindly: a key passed in
 * `removedCustomFieldKeys` is pruned regardless of whether it happens
 * to share a name with a built-in field. The caller is responsible
 * for passing only removed custom-field keys. In practice
 * `applyWorkflowEdit` collects this set from
 * `prev.custom_fields[].key`, and the workflow schema forbids custom
 * fields named after built-ins, so the collision is unreachable.
 *
 * Pruning semantics: when an array becomes empty after pruning, it is
 * dropped from the output rather than retained as `visible: []`. Per
 * the workspace config contract (see `ListViewConfigSchema`), absent
 * `visible` means "show every chip by default." An explicit empty
 * list would mean "show no chips" — but a list that became empty
 * solely because every entry referenced a now-deleted custom field
 * almost certainly reflects stale state, not a deliberate "hide all"
 * choice. Collapse to absent so the workspace returns to the safe
 * default; the doctor's dangling-ref check would have flagged any
 * surviving discrepancy before this point.
 */
export function pruneListViewForRemovedCustomFields(
  config: ListViewConfig,
  removedCustomFieldKeys: ReadonlySet<string>,
): ListViewConfig {
  if (removedCustomFieldKeys.size === 0) return config;
  const filters = config.filters;
  if (!filters) return config;

  const prunedVisible = filters.visible?.filter(k => !removedCustomFieldKeys.has(k));
  const prunedHidden = filters.hidden?.filter(k => !removedCustomFieldKeys.has(k));

  const visibleChanged =
    filters.visible !== undefined && prunedVisible !== undefined &&
    prunedVisible.length !== filters.visible.length;
  const hiddenChanged =
    filters.hidden !== undefined && prunedHidden !== undefined &&
    prunedHidden.length !== filters.hidden.length;
  if (!visibleChanged && !hiddenChanged) return config;

  const nextFilters: NonNullable<ListViewConfig["filters"]> = {};
  if (prunedVisible !== undefined && prunedVisible.length > 0) {
    nextFilters.visible = prunedVisible;
  }
  if (prunedHidden !== undefined && prunedHidden.length > 0) {
    nextFilters.hidden = prunedHidden;
  }
  // Carry any preserved broken chips through unchanged (K28): a corrupt
  // chip another process left is not one of `removedCustomFieldKeys` (it
  // has no valid key to match) and must survive this prune-and-save.
  const preserveBroken = config.broken ? { broken: config.broken } : {};
  // Drop the whole `filters` block when it becomes empty so the
  // on-disk file doesn't carry a no-op section.
  if (Object.keys(nextFilters).length === 0) return { ...preserveBroken };
  return { filters: nextFilters, ...preserveBroken };
}

/**
 * Reconstruct a broken chip's stored scalar from its `rawText` (the
 * entry's own YAML — a bare chip key, not an object). Returns `undefined`
 * when the rawText will not re-parse to a scalar, so it is skipped rather
 * than corrupting the write. The object analogue is `brokenEntriesToPlain`
 * in `health.js`; a chip is a scalar, so it needs this narrower re-emit.
 */
function brokenChipToScalar(b: BrokenEntry): unknown {
  try {
    return parseYaml(b.rawText);
  } catch {
    return undefined;
  }
}

/**
 * Split preserved broken chips back into the array each came from, keyed
 * off the label prefix baked into `BrokenEntry.error` (the only record of
 * membership). A chip whose prefix matches neither label, or whose rawText
 * will not re-parse, is dropped rather than guessed into an array.
 */
function partitionBrokenChips(
  broken: readonly BrokenEntry[] | undefined,
): { visible: unknown[]; hidden: unknown[] } {
  const out = { visible: [] as unknown[], hidden: [] as unknown[] };
  for (const b of broken ?? []) {
    const scalar = brokenChipToScalar(b);
    if (scalar === undefined) continue;
    if (b.error.startsWith(VISIBLE_CHIP_LABEL)) out.visible.push(scalar);
    else if (b.error.startsWith(HIDDEN_CHIP_LABEL)) out.hidden.push(scalar);
  }
  return out;
}

/**
 * The written shape. K28: a broken chip another process left must survive
 * an unrelated write — re-emitting only the valid chips silently drops it
 * (P1 data loss). Broken chips are spliced back into `visible`/`hidden`
 * (they re-load into `broken`), so an array is emitted when it holds valid
 * chips OR preserved broken ones, even if `config.filters` itself is
 * empty.
 */
function buildPlainObject(config: ListViewConfig): Record<string, unknown> {
  const brokenChips = partitionBrokenChips(config.broken);
  const filters: Record<string, unknown> = {};

  const visibleValid = config.filters?.visible;
  if (visibleValid !== undefined || brokenChips.visible.length > 0) {
    filters["visible"] = [...(visibleValid ?? []), ...brokenChips.visible];
  }
  const hiddenValid = config.filters?.hidden;
  if (hiddenValid !== undefined || brokenChips.hidden.length > 0) {
    filters["hidden"] = [...(hiddenValid ?? []), ...brokenChips.hidden];
  }

  if (Object.keys(filters).length === 0) return {};
  return { filters };
}
