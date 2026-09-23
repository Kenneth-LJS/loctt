
import type {
  BrokenSavedQuery,
  EntityColor,
  Filter,
  QueriesConfig,
  SavedQuery,
} from "@loctt/contracts";
import { EntityColorSchema, FilterSchema, SavedQuerySchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getQueriesConfigPath } from "../paths/index.js";
import { FilterError, filtersToNode, normalizeFilters } from "../query/filters.js";
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
  // Accepted-but-not-validated here, then judged per-field by
  // `dropInvalidColor` below. Applying the strict colour schema at this
  // level would make one hand-edited bad colour object-fatal for the
  // WHOLE entry (the tolerant schema is `.strict()`, so a rejected
  // `color` fails the entry, not just the field) — and a decorative
  // field must never cost a view its filters. See the field's own
  // docstring in contracts/query.ts.
  color: z.unknown().optional(),
  archived: SavedQuerySchema.shape.archived,
}).strict();

const RawQueriesConfigSchema = z.object({
  queries: z.array(LoaderSavedQuerySchema),
}).strict();

/**
 * Extracts the offending character offset from a `FilterError`'s message,
 * when there is one.
 *
 * `FilterError` (query/filters.ts) does not carry a `position` field of
 * its own — it wraps `TokenizeError`/`ParseError`, whose `position` is
 * folded into the message text as "... at position N" by `LocttError`,
 * and the wrapping in `advancedToNode` does not preserve the field
 * itself. Parsing it back out of the message is the only route available
 * without changing `query/filters.ts` (out of scope here — `query/` has
 * no `views/`-style error-shape convention to extend, and `FilterError`'s
 * shape is shared with non-DSL failures like an uncombinable simple
 * filter, which have no position to report). Best-effort: absent when the
 * message has no such suffix.
 */
function extractPosition(message: string): number | undefined {
  const match = /at position (\d+)/.exec(message);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Validate one entry's stored `filters`.
 *
 * K102 removed the old `conditions`/`query` derivation entirely: there is
 * no migration path and nothing to repair, because a filter list is the
 * only stored form and it either validates or it does not. An absent
 * `filters` key reads as the empty list (a view with no filters matches
 * everything within its archived scope) rather than an error — that is a
 * meaningful, authorable state, not corruption.
 *
 * Shape-valid is not enough: an advanced filter's DSL text is only ever
 * tokenized/parsed by `filtersToNode`, so a shape-valid entry holding
 * malformed DSL (e.g. `status = = = done AND`) used to load as an
 * ordinary healthy view and only fail once actually run — the
 * `BrokenSavedQuery` degrade path this file documents for "filters no
 * longer validate" was unreachable for that whole defect class. Running
 * `filtersToNode` here, after shape validation, closes that gap: a
 * `FilterError` (thrown for an unparseable advanced filter or an
 * uncombinable simple one — see filters.ts) degrades the entry exactly
 * like a shape failure. This is still a per-ENTRY, non-object-fatal
 * check — it never throws out of this function.
 */
function resolveFilters(
  rawFilters: unknown,
): { ok: true; filters: Filter[] } | { ok: false; reason: string; position?: number } {
  if (rawFilters === undefined) return { ok: true, filters: [] };
  const parsed = z.array(FilterSchema).safeParse(rawFilters);
  if (!parsed.success) return { ok: false, reason: formatZodIssues("filters", parsed.error) };
  try {
    // The AST is discarded — only used to prove the filter list actually
    // parses/composes. Mirrors `assertFiltersValid` (views/manage.ts),
    // which validates the same way on write; this is the read-time
    // analogue for entries that reached disk before that gate existed, or
    // via a hand edit.
    filtersToNode(parsed.data);
  } catch (err) {
    if (err instanceof FilterError) {
      const position = extractPosition(err.message);
      return position !== undefined
        ? { ok: false, reason: err.message, position }
        : { ok: false, reason: err.message };
    }
    throw err;
  }
  return { ok: true, filters: parsed.data };
}

/**
 * Keep a view's `color` only when it is one of K103's three shapes;
 * otherwise DROP the field and leave the rest of the view intact.
 *
 * This is the MSL-22 salvage, applied to saved views: a colour is
 * cosmetic, and a view whose colour does not parse still has its id, its
 * name and its filters — everything a reference needs and everything
 * that makes it runnable. Per the corruption guide's ground rule ("when
 * in doubt, degrade"), the bad value costs its own FIELD, never the
 * entry and never the file. Degrading the whole entry to a
 * `BrokenSavedQuery` would take the view's filters out of service over a
 * decorative typo, and that is destruction by another route.
 *
 * **The schema is the judge, never a regex.** `integrity.ts` documents
 * what re-implementing this rule costs: `invalidLabelColors` was once a
 * hand-rolled hex test and silently dropped every valid palette and
 * per-mode colour the moment K103 widened the shape. Asking
 * `EntityColorSchema` is the only form that cannot drift when the
 * contract widens again.
 *
 * The dropped value is NOT silently forgotten: `checkDataIntegrity`
 * re-reads the raw file and reports it, so doctor names the view and the
 * unusable value (corruption-guide rule 4, "report, don't hide").
 */
function resolveColor(rawColor: unknown): EntityColor | undefined {
  if (rawColor === undefined) return undefined;
  const parsed = EntityColorSchema.safeParse(rawColor);
  return parsed.success ? parsed.data : undefined;
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
        ...(resolved.position !== undefined ? { position: resolved.position } : {}),
        index: i,
        // The entry's FULL raw YAML, so a write re-emits every field
        // rather than only {id,name} — Phase Z C2. Mirrors how the six
        // object-shaped configs preserve via `BrokenEntry.rawText`.
        rawText: renderRawText(item),
      });
      return;
    }

    const color = resolveColor(item.color);
    queries.push({
      id: item.id,
      name: item.name,
      filters: resolved.filters,
      ...(item.sort !== undefined ? { sort: item.sort } : {}),
      ...(item.display !== undefined ? { display: item.display } : {}),
      ...(item.archivedScope !== undefined ? { archivedScope: item.archivedScope } : {}),
      ...(item.icon !== undefined ? { icon: item.icon } : {}),
      // Field-local: an unresolvable colour is dropped, not fatal.
      ...(color !== undefined ? { color } : {}),
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
    ...(q.color !== undefined ? { color: q.color } : {}),
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
