import type { ArchivedScope, Filter, QueriesConfig, SavedQuery, WorkflowConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadQueriesConfig,
  saveQueriesConfig,
} from "../config/queries.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { filtersToNode, normalizeFilters } from "../query/filters.js";
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
 * Rejects a saved view whose filters cannot be executed or reference
 * something that does not exist.
 *
 * Validating on write matters more here than for an ad-hoc query. A view
 * is written once and run many times, often by someone other than its
 * author, and a filter that cannot execute makes the view useless at
 * every call site rather than at one prompt.
 *
 * Validation runs against the COMPOSED AST (`filtersToNode`) — the same
 * in-memory composition execution uses — so what is validated is exactly
 * what will run. The AST is discarded here; only the filter list is
 * stored (K102).
 *
 * Workflow config is optional: without it, field names are still
 * checked and enum *values* are deferred rather than guessed at.
 */
async function assertFiltersValid(locttDir: string, filters: readonly Filter[]): Promise<void> {
  let workflow: WorkflowConfig | undefined;
  try {
    workflow = await loadWorkflowConfig(locttDir);
  } catch {
    // No usable workflow config — validate what we can without it.
  }
  // `filtersToNode` throws FilterError on an unparseable advanced filter
  // or an uncombinable simple one; both are "this view is invalid".
  let node;
  try {
    node = filtersToNode(filters);
  } catch (err) {
    throw new ViewError(`invalid filter: ${(err as Error).message}`);
  }
  // An empty filter list is valid — it matches everything in scope.
  if (node === undefined) return;
  try {
    validateQuery(node, workflow ? { workflow } : {});
  } catch (err) {
    throw new ViewError(`invalid filter: ${(err as Error).message}`);
  }
}

export interface CreateViewInput {
  readonly name: string;
  /** The view's filters, in authored order. May be empty. */
  readonly filters: readonly Filter[];
  readonly sort?: SavedQuery["sort"];
  readonly archivedScope?: ArchivedScope;
  readonly icon?: string;
}

/** Creates a new saved view. Generates a stable ulid. */
export async function createView(
  locttDir: string,
  input: CreateViewInput,
): Promise<SavedQuery> {
  await assertFiltersValid(locttDir, input.filters);
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const created: SavedQuery = {
      id: ulid(),
      name: input.name,
      // Spacing-only normalization; order and shape are as authored.
      filters: normalizeFilters(input.filters),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.archivedScope !== undefined ? { archivedScope: input.archivedScope } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
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
  /**
   * Replaces the WHOLE ordered filter list. Omit to leave the view's
   * filters untouched — there is no partial-filter patch, because order
   * is meaningful (K102), so a caller sends the list it wants.
   */
  readonly filters?: readonly Filter[];
  readonly sort?: SavedQuery["sort"] | null;
  readonly archivedScope?: ArchivedScope;
  /** `null` clears the icon; `undefined` leaves it unchanged. */
  readonly icon?: string | null;
}

export async function editView(
  locttDir: string,
  ref: string,
  changes: EditViewInput,
): Promise<SavedQuery> {
  if (changes.filters !== undefined) {
    await assertFiltersValid(locttDir, changes.filters);
  }
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const existing = findView(config, ref);
    const updated: SavedQuery = {
      id: existing.id,
      name: changes.name ?? existing.name,
      filters: changes.filters !== undefined
        ? normalizeFilters(changes.filters)
        : existing.filters,
      ...(changes.sort === null
        ? {}
        : changes.sort !== undefined
          ? { sort: changes.sort }
          : existing.sort !== undefined
            ? { sort: existing.sort }
            : {}),
      ...(existing.display !== undefined ? { display: existing.display } : {}),
      ...(changes.archivedScope !== undefined
        ? { archivedScope: changes.archivedScope }
        : existing.archivedScope !== undefined
          ? { archivedScope: existing.archivedScope }
          : {}),
      ...(changes.icon === null
        ? {}
        : changes.icon !== undefined
          ? { icon: changes.icon }
          : existing.icon !== undefined
            ? { icon: existing.icon }
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
      filters: existing.filters,
      ...(existing.sort !== undefined ? { sort: existing.sort } : {}),
      ...(existing.display !== undefined ? { display: existing.display } : {}),
      ...(existing.archivedScope !== undefined ? { archivedScope: existing.archivedScope } : {}),
      ...(existing.icon !== undefined ? { icon: existing.icon } : {}),
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
