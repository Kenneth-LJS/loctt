import type { QueriesConfig, SavedQuery } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadQueriesConfig,
  saveQueriesConfig,
} from "../config/queries.js";
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

export interface CreateViewInput {
  readonly name: string;
  readonly query: string;
  readonly sort?: SavedQuery["sort"];
}

/** Creates a new saved view. Generates a stable ulid. */
export async function createView(
  locttDir: string,
  input: CreateViewInput,
): Promise<SavedQuery> {
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const created: SavedQuery = {
      id: ulid(),
      name: input.name,
      query: input.query,
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
    };
    await saveQueriesConfig(locttDir, {
      queries: [...config.queries, created],
    });
    return created;
  });
}

export interface EditViewInput {
  readonly name?: string;
  readonly query?: string;
  readonly sort?: SavedQuery["sort"] | null;
}

export async function editView(
  locttDir: string,
  ref: string,
  changes: EditViewInput,
): Promise<SavedQuery> {
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    const existing = findView(config, ref);
    const updated: SavedQuery = {
      id: existing.id,
      name: changes.name ?? existing.name,
      query: changes.query ?? existing.query,
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
    await saveQueriesConfig(locttDir, { queries: next });
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
    await saveQueriesConfig(locttDir, { queries: next });
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
      ...(existing.sort !== undefined ? { sort: existing.sort } : {}),
    };
    const next = config.queries.map(q => (q.id === existing.id ? cleared : q));
    await saveQueriesConfig(locttDir, { queries: next });
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
    });
  });
}
