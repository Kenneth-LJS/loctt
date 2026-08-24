
import type { ListViewConfig } from "@loctt/contracts";
import { ListViewConfigSchema } from "@loctt/contracts";
import { z } from "zod";

import { getListViewConfigPath } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

/**
 * Errors thrown when `list-view.yaml` is invalid. The file is committed
 * and hand-editable, so a parse failure should give the user a clear
 * line/path to fix rather than a stack trace.
 */
export class ListViewConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListViewConfigError";
  }
}

/**
 * Parses raw YAML content into a `ListViewConfig`. Throws
 * `ListViewConfigError` with a formatted message on schema violation.
 */
export function parseListViewConfig(yamlContent: string): ListViewConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "list-view.yaml"));
  try {
    return ListViewConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ListViewConfigError(formatZodIssues("list-view config", err));
    }
    throw err;
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
  // Drop the whole `filters` block when it becomes empty so the
  // on-disk file doesn't carry a no-op section.
  if (Object.keys(nextFilters).length === 0) return {};
  return { filters: nextFilters };
}

function buildPlainObject(config: ListViewConfig): Record<string, unknown> {
  if (!config.filters) return {};
  const filters: Record<string, unknown> = {};
  if (config.filters.visible !== undefined) {
    filters["visible"] = [...config.filters.visible];
  }
  if (config.filters.hidden !== undefined) {
    filters["hidden"] = [...config.filters.hidden];
  }
  return { filters };
}
