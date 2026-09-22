
import type {
  BrokenSavedQuery,
  Filter,
  QueriesConfig,
  SavedQuery,
} from "@loctt/contracts";
import { FilterSchema, SavedQuerySchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getQueriesConfigPath } from "../paths/index.js";
import { normalizeFilters } from "../query/filters.js";
import { renderRawText } from "../task/frontmatter.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class QueriesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueriesConfigError";
  }
}

/**
 * The TOLERANT loader schema for one entry — deliberately NOT
 * `SavedQuerySchema`. It requires `id`/`name` and validates
 * `sort`/`display`/`archivedScope`/`icon`/`archived` strictly (so those
 * stay object-fatal), but accepts `filters` as an arbitrary optional
 * value.
 *
 * Why: applying the strict `filters` schema at load would make ONE
 * hand-edited bad filter reject the WHOLE file (object-fatal), taking
 * every healthy sibling view with it. The loader validates `filters`
 * per-entry below instead, so a bad one degrades to a `BrokenSavedQuery`
 * marker (north-star principle 5) while the rest of the catalog loads.
 * Write paths still go through `SavedQuerySchema`, so the on-disk shape
 * stays strict.
 */
const LoaderSavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // Accepted-but-not-validated here; validated per-entry below so ONE bad
  // filter list degrades its own entry instead of the whole file.
  filters: z.unknown().optional(),
  sort: SavedQuerySchema.shape.sort,
  display: SavedQuerySchema.shape.display,
  archivedScope: SavedQuerySchema.shape.archivedScope,
  icon: SavedQuerySchema.shape.icon,
  archived: SavedQuerySchema.shape.archived,
}).strict();

const RawQueriesConfigSchema = z.object({
  queries: z.array(LoaderSavedQuerySchema),
}).strict();

/**
 * Validate one entry's stored `filters`.
 *
 * K102 removed the old `conditions`/`query` derivation entirely: there is
 * no migration path and nothing to repair, because a filter list is the
 * only stored form and it either validates or it does not. An absent
 * `filters` key reads as the empty list (a view with no filters matches
 * everything within its archived scope) rather than an error — that is a
 * meaningful, authorable state, not corruption.
 */
function resolveFilters(
  rawFilters: unknown,
): { ok: true; filters: Filter[] } | { ok: false; reason: string } {
  if (rawFilters === undefined) return { ok: true, filters: [] };
  const parsed = z.array(FilterSchema).safeParse(rawFilters);
  if (parsed.success) return { ok: true, filters: parsed.data };
  return { ok: false, reason: formatZodIssues("filters", parsed.error) };
}

export function parseQueriesConfig(yamlContent: string): QueriesConfig {
  const raw: unknown = safeParseYaml(yamlContent, "queries.yaml");
  let parsed: z.infer<typeof RawQueriesConfigSchema>;
  try {
    parsed = RawQueriesConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new QueriesConfigError(`queries.yaml is not valid: ${formatZodIssues("queries config", err)}`);
    }
    throw err;
  }

  // Per north-star principle 5: one entry whose filters no longer
  // validate (a hand edit, most often) must not blank the whole catalog.
  // Good entries become `SavedQuery`s; a bad one becomes a
  // `BrokenSavedQuery` marker carrying its raw text and the validation
  // message, so a surface can list it as broken and mark the fault in
  // place (VUE-22) rather than 500-ing the healthy views beside it.
  //
  // Object-fatal problems still throw: the duplicate-id check below, and
  // everything the tolerant schema still rejected above (missing array,
  // missing id/name, bad sort/display). Only per-ENTRY filter failures
  // degrade.
  const seenIds = new Set<string>();
  const queries: SavedQuery[] = [];
  const broken: BrokenSavedQuery[] = [];
  parsed.queries.forEach((item, i) => {
    // Duplicate ids are object-fatal: two entries sharing an id makes
    // "run view <id>" ambiguous, so we cannot silently pick one.
    if (seenIds.has(item.id)) {
      throw new QueriesConfigError(`duplicate query id: ${item.id}`);
    }
    seenIds.add(item.id);

    const resolved = resolveFilters(item.filters);
    if (!resolved.ok) {
      broken.push({
        id: item.id,
        name: item.name,
        // Display-only: the entry's filters did not validate, so there is
        // nothing safe to render from them. The authoritative bytes are
        // in `rawText`.
        summary: "(unreadable filters)",
        error: resolved.reason,
        index: i,
        // The entry's FULL raw YAML, so a write re-emits every field
        // rather than only {id,name} — Phase Z C2. Mirrors how the six
        // object-shaped configs preserve via `BrokenEntry.rawText`.
        rawText: renderRawText(item),
      });
      return;
    }

    queries.push({
      id: item.id,
      name: item.name,
      filters: resolved.filters,
      ...(item.sort !== undefined ? { sort: item.sort } : {}),
      ...(item.display !== undefined ? { display: item.display } : {}),
      ...(item.archivedScope !== undefined ? { archivedScope: item.archivedScope } : {}),
      ...(item.icon !== undefined ? { icon: item.icon } : {}),
      ...(item.archived === true ? { archived: true } : {}),
    });
  });

  return {
    queries,
    // Omitted, not `[]`, when everything parsed — so a consumer reading
    // only `queries` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

/**
 * Build a plain serializable object for one SavedQuery.
 *
 * The filter list is written AS AUTHORED (K102): order preserved, each
 * filter in its own form, nothing merged into a canonical DSL. The only
 * transformation is `normalizeFilters`, which rewrites an advanced
 * filter's WHITESPACE and nothing else (Ken: "you may normalise spacing,
 * dont edit anything else"); a simple filter passes through untouched.
 */
function serializeSavedQuery(q: QueriesConfig["queries"][number]): Record<string, unknown> {
  return {
    id: q.id,
    name: q.name,
    filters: normalizeFilters(q.filters).map(serializeFilter),
    ...(q.sort !== undefined ? {
      sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
    } : {}),
    ...(q.display !== undefined ? { display: serializeDisplay(q.display) } : {}),
    ...(q.archivedScope !== undefined ? { archivedScope: q.archivedScope } : {}),
    ...(q.icon !== undefined ? { icon: q.icon } : {}),
    ...(q.archived === true ? { archived: true } : {}),
  };
}

/**
 * Serialize one filter to a plain, YAML-friendly object.
 *
 * The union stays DISCRIMINATED on disk — a simple filter emits
 * field/op/values and NO query key, an advanced filter emits only its
 * query. That is what lets the loader read the kind back rather than
 * infer it, which is what makes a reopened view render each filter as the
 * thing it was authored as (K102).
 */
function serializeFilter(f: Filter): Record<string, unknown> {
  if (f.kind === "advanced") {
    return { kind: "advanced", query: f.query };
  }
  return { kind: "simple", field: f.field, op: f.op, values: [...f.values] };
}

function serializeDisplay(d: NonNullable<QueriesConfig["queries"][number]["display"]>): Record<string, unknown> {
  return {
    ...(d.mode !== undefined ? { mode: d.mode } : {}),
    ...(d.columns !== undefined ? { columns: d.columns } : {}),
    ...(d.group_by !== undefined ? { group_by: d.group_by } : {}),
    ...(d.zoom !== undefined ? { zoom: d.zoom } : {}),
    ...(d.grouping !== undefined ? { grouping: d.grouping } : {}),
    ...(d.show_arrows !== undefined ? { show_arrows: d.show_arrows } : {}),
  };
}

/**
 * A broken entry (K28) re-serialized to its FULL on-disk shape. It is
 * emitted alongside the valid queries so a write NEVER drops a
 * corrupt-but-preserved sibling the write did not touch (the config
 * analogue of the task write guard).
 *
 * `b.rawText` is the entry's own YAML (`renderRawText` = `stringifyYaml`),
 * so re-parsing it reconstructs every field the entry had on disk —
 * `id`/`name`, its unreadable `filters` block verbatim, and any
 * `sort`/`display`/`archived`. Emitting only `{id,name}` silently strips a
 * broken view's other fields on any unrelated write: Phase Z finding C2,
 * the residual loss inside K28. This mirrors `brokenEntriesToPlain`
 * (health.ts). Preserving the ORIGINAL filter bytes matters more under
 * K102 than it did before: they are the only record of what the user
 * meant, and a later hand fix edits that real text.
 *
 * Fallback: if `rawText` will not re-parse to an object (should not happen
 * for a schema-valid entry, whose YAML `renderRawText` produced), fall back
 * to `{id,name}` rather than writing a broken shape.
 */
function serializeBrokenQuery(b: BrokenSavedQuery): Record<string, unknown> {
  try {
    const parsed: unknown = parseYaml(b.rawText);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unparseable rawText — fall through to the minimal shape below.
  }
  return { id: b.id, name: b.name };
}

export function serializeQueriesConfig(config: QueriesConfig): string {
  return stringifyYaml(buildQueriesPlainObject(config));
}

/**
 * The written shape: valid queries AND any preserved broken entries, in a
 * single `queries` array (a broken entry is a saved query whose `query`
 * does not parse — it belongs in the same list, and re-loading re-sorts
 * it into `broken`). K28: dropping the broken entries here is silent data
 * loss.
 */
function buildQueriesPlainObject(config: QueriesConfig): { queries: Record<string, unknown>[] } {
  return {
    queries: [
      ...config.queries.map(serializeSavedQuery),
      ...(config.broken ?? []).map(serializeBrokenQuery),
    ],
  };
}

export async function saveQueriesConfig(
  locttDir: string,
  config: QueriesConfig,
): Promise<void> {
  // Validate the VALID entries round-trip (the broken ones are, by
  // definition, not valid — they are carried verbatim, not re-validated).
  parseQueriesConfig(stringifyYaml({ queries: config.queries.map(serializeSavedQuery) }));
  await writeYamlAtomically(getQueriesConfigPath(locttDir), buildQueriesPlainObject(config));
}

export async function loadQueriesConfig(locttDir: string): Promise<QueriesConfig> {
  const filePath = getQueriesConfigPath(locttDir);
  // Rethrown as a named cause rather than a bare errno: these throw on
  // absence too (deliberately — the file is required), so the caller
  // needs to know which file and why.
  const file = await readFileState(filePath);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT", path: filePath });
  }
  return parseQueriesConfig(file.content);
}
