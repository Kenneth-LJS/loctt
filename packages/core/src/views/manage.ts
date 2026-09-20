import type { QueriesConfig, SavedQuery, WorkflowConfig } from "@loctt/contracts";
import type { BuilderTree } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadQueriesConfig,
  saveQueriesConfig,
} from "../config/queries.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { conditionsToDsl, queryToConditions } from "../query/builderTree.js";
import { parseQuery } from "../query/parser.js";
import { tokenize } from "../query/tokenizer.js";
import { validateQuery } from "../query/validate.js";
import { withStateLock } from "../state/index.js";

export class ViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewError";
  }
}

/** Resolves a view ref (id or unique name) to its definition. */
export function findView(config: QueriesConfig, ref: string): SavedQuery {
  const byId = config.queries.find(q => q.id === ref);
  if (byId) return byId;
  const byName = config.queries.filter(q => q.name === ref);
  if (byName.length === 1) {
    const only = byName[0];
    if (only) return only;
  }
  if (byName.length > 1) {
    throw new ViewError(`multiple views named '${ref}'; refer by id instead`);
  }
  throw new ViewError(`unknown view: ${ref}`);
}

/**
 * Rejects a saved-view query that cannot be parsed or references
 * something that does not exist.
 *
 * Validating on write matters more here than for an ad-hoc query.
 * `loadQueriesConfig` rejects the ENTIRE file when one entry is
 * malformed, so a single bad view does not merely fail to run — it
 * takes every other saved view with it on the next read. A view is
 * also written once and run many times, often by someone other than
 * its author.
 *
 * Workflow config is optional: without it, field names are still
 * checked and enum *values* are deferred rather than guessed at.
 */
async function assertQueryValid(locttDir: string, query: string): Promise<void> {
  let workflow: WorkflowConfig | undefined;
  try {
    workflow = await loadWorkflowConfig(locttDir);
  } catch {
    // No usable workflow config — validate what we can without it.
  }
  try {
    validateQuery(parseQuery(tokenize(query)), workflow ? { workflow } : {});
  } catch (err) {
    throw new ViewError(`invalid query: ${(err as Error).message}`);
  }
}

/**
 * Resolve a view's filter into the `{ query, conditions }` pair the stored
 * shape needs, deriving whichever the caller did not supply.
 *
 * - `conditions` given → `query` is DERIVED from it by the spacing-only
 *   serializer (conditions are the source of truth). Any `query` the
 *   caller also passed is ignored — the derived string is authoritative.
 * - only `query` given (the CLI/MCP raw-DSL path, wired in a later stage) →
 *   `conditions` are DERIVED by parsing the DSL. If the DSL does not
 *   parse we REJECT rather than store a view with no structured form. With
 *   the total BuilderTree, every construct the parser accepts is
 *   representable, so the only rejection here is a genuine parse error;
 *   `assertQueryValid` (the caller) additionally checks the DSL semantics.
 *
 * Exactly one of the two must be present.
 */
function resolveViewFilter(
  input: { readonly conditions?: BuilderTree; readonly query?: string },
): { query: string; conditions: BuilderTree } {
  if (input.conditions !== undefined) {
    return { conditions: input.conditions, query: conditionsToDsl(input.conditions) };
  }
  if (input.query !== undefined) {
    const res = queryToConditions(input.query);
    if (!res.ok) {
      throw new ViewError(`invalid query: ${res.reason}`);
    }
    // Re-derive the query from the parsed conditions so what we store is
    // exactly what the conditions serialize to (spacing normalized) — the
    // stored `query` is never independently trusted.
    return { conditions: res.tree, query: conditionsToDsl(res.tree) };
  }
  throw new ViewError("a view needs either conditions or a query");
}

export interface CreateViewInput {
  readonly name: string;
  /** The DSL string. Optional when `conditions` is supplied. */
  readonly query?: string;
  /** Structured conditions. Optional when `query` is supplied. */
  readonly conditions?: BuilderTree;
  readonly sort?: SavedQuery["sort"];
}

/** Creates a new saved view. Generates a stable ulid. */
export async function createView(
  locttDir: string,
  input: CreateViewInput,
): Promise<SavedQuery> {
  const { query, conditions } = resolveViewFilter(input);
  await assertQueryValid(locttDir, query);
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const created: SavedQuery = {
      id: ulid(),
      name: input.name,
      query,
      conditions,
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
    };
    await saveQueriesConfig(locttDir, {
      queries: [...config.queries, created],
      ...(config.broken ? { broken: config.broken } : {}),
    });
    return created;
  });
}

export interface EditViewInput {
  readonly name?: string;
  readonly query?: string;
  readonly conditions?: BuilderTree;
  readonly sort?: SavedQuery["sort"] | null;
}

export async function editView(
  locttDir: string,
  ref: string,
  changes: EditViewInput,
): Promise<SavedQuery> {
  // Recompute the {query, conditions} pair when the filter changes.
  // `conditions` wins (query is derived); a raw-DSL edit derives the
  // conditions. An edit that touches neither leaves both as-is.
  const filterChanged = changes.conditions !== undefined || changes.query !== undefined;
  const nextFilter = filterChanged
    ? resolveViewFilter({
        ...(changes.conditions !== undefined ? { conditions: changes.conditions } : {}),
        ...(changes.query !== undefined ? { query: changes.query } : {}),
      })
    : undefined;
  if (nextFilter !== undefined) {
    await assertQueryValid(locttDir, nextFilter.query);
  }
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const existing = findView(config, ref);
    const updated: SavedQuery = {
      id: existing.id,
      name: changes.name ?? existing.name,
      query: nextFilter?.query ?? existing.query,
      conditions: nextFilter?.conditions ?? existing.conditions,
      ...(changes.sort === null
        ? {}
        : changes.sort !== undefined
          ? { sort: changes.sort }
          : existing.sort !== undefined
            ? { sort: existing.sort }
            : {}),
      ...(existing.archived === true ? { archived: true } : {}),
    };
    const next = config.queries.map(q => (q.id === existing.id ? updated : q));
    await saveQueriesConfig(locttDir, { queries: next, ...(config.broken ? { broken: config.broken } : {}) });
    return updated;
  });
}

/** Marks a view as archived. No-op when already archived. */
export async function archiveView(locttDir: string, ref: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const existing = findView(config, ref);
    if (existing.archived === true) return;
    const updated: SavedQuery = { ...existing, archived: true };
    const next = config.queries.map(q => (q.id === existing.id ? updated : q));
    await saveQueriesConfig(locttDir, { queries: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

/** Clears the archived flag on a view. */
export async function unarchiveView(locttDir: string, ref: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const existing = findView(config, ref);
    if (existing.archived !== true) return;
    const cleared: SavedQuery = {
      id: existing.id,
      name: existing.name,
      query: existing.query,
      conditions: existing.conditions,
      ...(existing.sort !== undefined ? { sort: existing.sort } : {}),
    };
    const next = config.queries.map(q => (q.id === existing.id ? cleared : q));
    await saveQueriesConfig(locttDir, { queries: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export interface DeleteViewOptions {
  /** If true, removes the view from queries.yaml. Default is soft-delete (archive). */
  readonly hard?: boolean;
}

export async function deleteView(
  locttDir: string,
  ref: string,
  options: DeleteViewOptions = {},
): Promise<void> {
  if (options.hard !== true) {
    await archiveView(locttDir, ref);
    return;
  }
  await withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const target = findView(config, ref);
    await saveQueriesConfig(locttDir, {
      queries: config.queries.filter(q => q.id !== target.id),
      ...(config.broken ? { broken: config.broken } : {}),
    });
  });
}
