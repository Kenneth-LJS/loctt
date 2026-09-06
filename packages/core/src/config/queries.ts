
import type { BrokenSavedQuery, QueriesConfig, SavedQuery } from "@loctt/contracts";
import { SavedQuerySchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getQueriesConfigPath } from "../paths/index.js";
import { ParseError, parseQuery } from "../query/parser.js";
import { tokenize, TokenizeError } from "../query/tokenizer.js";
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

const RawQueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
}).strict();

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

  // Per north-star principle 5: one entry whose DSL no longer parses
  // (a hand edit, most often) must not blank the whole catalog. Good
  // entries become `SavedQuery`s; a bad one becomes a `BrokenSavedQuery`
  // marker carrying its raw text, the parser's message and the offending
  // position, so a surface can list it as broken and mark the fault in
  // place (VUE-22) rather than 500-ing the healthy views beside it.
  //
  // Object-fatal problems still throw: the duplicate-id check below, and
  // everything the schema already rejected above (missing array, missing
  // id/name/query, bad sort). Only a per-ENTRY query error degrades.
  const seenIds = new Set<string>();
  const queries: SavedQuery[] = [];
  const broken: BrokenSavedQuery[] = [];
  parsed.queries.forEach((item, i) => {
    // Duplicate ids are object-fatal: two entries sharing an id makes
    // "run view <id>" ambiguous, so we cannot silently pick one. Checked
    // before DSL parsing so a duplicate is reported the same way whether
    // or not the query also happens to be broken.
    if (seenIds.has(item.id)) {
      throw new QueriesConfigError(`duplicate query id: ${item.id}`);
    }
    seenIds.add(item.id);

    // DSL validation. Bad query strings are user-fixable and degrade to
    // a broken marker rather than crashing the rest of the load.
    try {
      parseQuery(tokenize(item.query));
    } catch (err) {
      if (err instanceof TokenizeError || err instanceof ParseError) {
        broken.push({
          id: item.id,
          name: item.name,
          query: item.query,
          error: err.message,
          // Both carry a numeric character offset; kept so a surface can
          // mark the exact spot (VUE-22: "the offending position").
          position: err.position,
          index: i,
          // The entry's FULL schema-valid YAML (id/name/query and any
          // sort/display/archived), so a write re-emits every field rather
          // than only {id,name,query} — Phase Z C2. Mirrors how the six
          // object-shaped configs preserve via `BrokenEntry.rawText`.
          rawText: renderRawText(item),
        });
        return;
      }
      throw err;
    }

    queries.push({
      id: item.id,
      name: item.name,
      query: item.query,
      ...(item.sort !== undefined ? { sort: item.sort } : {}),
      ...(item.display !== undefined ? { display: item.display } : {}),
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

/** Build a plain serializable object for one SavedQuery. */
function serializeSavedQuery(q: QueriesConfig["queries"][number]): Record<string, unknown> {
  return {
    id: q.id,
    name: q.name,
    query: q.query,
    ...(q.sort !== undefined ? {
      sort: q.sort.map(s => ({ field: s.field, direction: s.direction })),
    } : {}),
    ...(q.display !== undefined ? { display: serializeDisplay(q.display) } : {}),
    ...(q.archived === true ? { archived: true } : {}),
  };
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
 * `id/name/query` and any `sort`/`display`/`archived`. Emitting only
 * `{id,name,query}` (as this once did) silently stripped a broken view's
 * optional fields on any unrelated write: Phase Z finding C2, the residual
 * loss inside K28. This mirrors `brokenEntriesToPlain` (health.ts).
 *
 * Fallback: if `rawText` will not re-parse to an object (should not happen
 * for a schema-valid entry, whose YAML `renderRawText` produced), fall back
 * to `{id,name,query}` rather than writing a broken shape — the query
 * string is kept verbatim so a later fix edits the real text.
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
  return { id: b.id, name: b.name, query: b.query };
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
