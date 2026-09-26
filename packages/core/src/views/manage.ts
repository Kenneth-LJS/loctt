import type { ArchivedScope, BrokenSavedQuery, EntityColor, Filter, QueriesConfig, SavedQuery, WorkflowConfig } from "@loctt/contracts";
import { isViewNameTaken, VIEW_NAME_TAKEN_MESSAGE, viewNameKey } from "@loctt/contracts";
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

/**
 * A write that would give a view a name another view already has (B21,
 * K129). A `ViewError`, so every surface that already reports view errors
 * reports this one; its own class so the API can point at the name field.
 */
export class ViewNameTakenError extends ViewError {
  constructor() {
    super(VIEW_NAME_TAKEN_MESSAGE);
    this.name = "ViewNameTakenError";
  }
}

/**
 * Refuses `name` when another view on disk already answers to it
 * (K129). Every entry counts: archived views and broken entries still
 * resolve by name, so a clash with either makes `--view <name>`
 * ambiguous just the same. `exceptId` is the view being renamed.
 *
 * Only NEW clashes are refused. Two views that already share a name on
 * disk (written before K129, or by hand) keep loading, running by id,
 * and taking edits that leave their name alone.
 */
function assertNameFree(config: QueriesConfig, name: string, exceptId?: string): void {
  const entries = [...config.queries, ...(config.broken ?? [])];
  if (isViewNameTaken(name, entries, exceptId)) throw new ViewNameTakenError();
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
    throw new ViewError(`Multiple views named '${ref}'. Refer by id instead.`);
  }
  throw new ViewError(`Unknown view: ${ref}`);
}

/**
 * Resolves a view ref against the healthy catalog AND the preserved
 * broken entries (K102-broken-repair).
 *
 * This is deliberately a SEPARATE resolver rather than a widening of
 * `findView`. `findView` answers "give me a runnable view", and every
 * read path — running a view, listing, pinning — is correct to fail on a
 * broken ref. Only the two WRITE paths that can legitimately target a
 * corrupt record (`editView`, `deleteView`) opt into this one, so no
 * existing caller changes behaviour.
 *
 * Resolution order mirrors `findView`: id first across both pools, then
 * unique name across both pools. A name shared between a healthy and a
 * broken entry is ambiguous for the same reason two healthy ones are.
 */
export function findViewOrBroken(
  config: QueriesConfig,
  ref: string,
): { kind: "view"; view: SavedQuery } | { kind: "broken"; entry: BrokenSavedQuery } {
  const broken = config.broken ?? [];
  const byId = config.queries.find(q => q.id === ref);
  if (byId) return { kind: "view", view: byId };
  const brokenById = broken.find(b => b.id === ref);
  if (brokenById) return { kind: "broken", entry: brokenById };

  const namedViews = config.queries.filter(q => q.name === ref);
  const namedBroken = broken.filter(b => b.name === ref);
  const total = namedViews.length + namedBroken.length;
  if (total > 1) {
    throw new ViewError(`Multiple views named '${ref}'. Refer by id instead.`);
  }
  const onlyView = namedViews[0];
  if (onlyView) return { kind: "view", view: onlyView };
  const onlyBroken = namedBroken[0];
  if (onlyBroken) return { kind: "broken", entry: onlyBroken };

  throw new ViewError(`Unknown view: ${ref}`);
}

/**
 * The gate text for a write aimed at a broken entry without the explicit
 * opt-in. It names the entry, says what is wrong, says what the write
 * would destroy, and says exactly how to proceed — never a bare
 * `unknown view: <ulid>` (Ken's ruling, K102-broken-repair).
 */
function brokenWriteGate(entry: BrokenSavedQuery, verb: "replace" | "delete"): ViewError {
  return new ViewError(
    `View '${entry.name}' (${entry.id}) is broken. Its stored filters could not be read (${entry.error}). `
    + `Its original text is preserved in queries.yaml and ${verb === "delete" ? "deleting" : "replacing"} it would discard that text. `
    + `Fix queries.yaml by hand to keep it, or ${verb} it anyway with --force (CLI), `
    + `replaceBroken: true (MCP and API).`,
  );
}

/**
 * Rejects an archive/unarchive aimed at a broken entry.
 *
 * Archiving a view whose filters do not load is meaningless, and
 * succeeding silently would imply the entry is healthy — so there is no
 * opt-in here, only a clear refusal (Ken's ruling, K102-broken-repair).
 */
function assertNotBrokenForArchive(
  config: QueriesConfig,
  ref: string,
  verb: "archive" | "unarchive",
): void {
  const broken = config.broken ?? [];
  if (broken.length === 0) return;
  let resolved;
  try {
    resolved = findViewOrBroken(config, ref);
  } catch {
    // Unknown or ambiguous: let `findView` below produce its own message.
    return;
  }
  if (resolved.kind !== "broken") return;
  const entry = resolved.entry;
  throw new ViewError(
    `View '${entry.name}' (${entry.id}) is broken. Its stored filters could not be read (${entry.error}). `
    + `A broken view cannot be ${verb}d: ${verb === "archive" ? "archiving" : "unarchiving"} it would imply it still works. `
    + `Fix queries.yaml by hand, or replace or delete the view.`,
  );
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
    throw new ViewError(`Invalid filter: ${(err as Error).message}`);
  }
  // An empty filter list is valid — it matches everything in scope.
  if (node === undefined) return;
  try {
    validateQuery(node, workflow ? { workflow } : {});
  } catch (err) {
    throw new ViewError(`Invalid filter: ${(err as Error).message}`);
  }
}

export interface CreateViewInput {
  readonly name: string;
  /** The view's filters, in authored order. May be empty. */
  readonly filters: readonly Filter[];
  readonly sort?: SavedQuery["sort"];
  readonly archivedScope?: ArchivedScope;
  readonly icon?: string;
  /**
   * K103's three-shape colour. Ken, 2026-09-23: colour follows icon
   * wherever both exist, so a saved view carries one. Whether it can be
   * APPLIED is a render-time question about the icon (an emoji is never
   * tinted) — core stores what it is given either way, so switching an
   * emoji back to a Lucide glyph restores the colour rather than
   * demanding it be picked again.
   */
  readonly color?: EntityColor;
}

/** Creates a new saved view. Generates a stable ulid. */
export async function createView(
  locttDir: string,
  input: CreateViewInput,
): Promise<SavedQuery> {
  await assertFiltersValid(locttDir, input.filters);
  return withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    assertNameFree(config, input.name);
    const created: SavedQuery = {
      id: ulid(),
      name: input.name,
      // Spacing-only normalization; order and shape are as authored.
      filters: normalizeFilters(input.filters),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.archivedScope !== undefined ? { archivedScope: input.archivedScope } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
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
  /** `null` clears the colour; `undefined` leaves it unchanged. */
  readonly color?: EntityColor | null;
  /**
   * Explicit opt-in to REPLACE a broken entry, discarding the original
   * text `queries.yaml` still holds for it (K102-broken-repair). Ignored
   * for a healthy view — a healthy edit is unaffected by this flag in
   * every way, which is the point of gating on the resolved entry rather
   * than on the flag.
   */
  readonly replaceBroken?: boolean;
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
    const resolved = findViewOrBroken(config, ref);
    if (resolved.kind === "broken") {
      return repairBrokenView(locttDir, config, resolved.entry, changes);
    }
    const existing = resolved.view;
    // A rename is checked; keeping the name (or changing only its case
    // or spacing) is not, so an edit to one of two views that already
    // share a name still goes through.
    if (changes.name !== undefined && viewNameKey(changes.name) !== viewNameKey(existing.name)) {
      assertNameFree(config, changes.name, existing.id);
    }
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
      // Same three-way as `icon`: null clears, a value sets, omission
      // KEEPS. The keep arm is what stops an unrelated web edit (the
      // dialog omits what it does not offer) from silently dropping a
      // colour set through the CLI or MCP.
      ...(changes.color === null
        ? {}
        : changes.color !== undefined
          ? { color: changes.color }
          : existing.color !== undefined
            ? { color: existing.color }
            : {}),
      ...(existing.archived === true ? { archived: true } : {}),
    };
    const next = config.queries.map(q => (q.id === existing.id ? updated : q));
    await saveQueriesConfig(locttDir, { queries: next, ...(config.broken ? { broken: config.broken } : {}) });
    return updated;
  });
}

/**
 * Replaces a broken entry with a healthy view, KEEPING ITS ID
 * (K102-broken-repair).
 *
 * Nothing of the old entry is carried forward except `id` and, when the
 * caller did not supply one, `name`: its other fields live only inside
 * `rawText`, which did not validate as a whole, so reading individual
 * fields back out of it would be guessing. This is a REPLACEMENT, which
 * is why it takes an explicit opt-in.
 *
 * Keeping the id is what makes it a repair rather than a
 * delete-and-recreate: pins, sidebar order and any other reference to the
 * view by id survive.
 *
 * Note the resulting ORDER: `saveQueriesConfig` writes the healthy
 * queries first and the preserved broken entries after them, so a
 * repaired entry moves from its old file position to the end of the
 * healthy list. Position is not a stored, user-meaningful property of a
 * view (there is no `order` field; the sidebar sorts by its own rules),
 * so this is a cosmetic move in the file rather than a change to the
 * view.
 *
 * Called with the state lock already held.
 */
async function repairBrokenView(
  locttDir: string,
  config: QueriesConfig,
  entry: BrokenSavedQuery,
  changes: EditViewInput,
): Promise<SavedQuery> {
  if (changes.replaceBroken !== true) {
    throw brokenWriteGate(entry, "replace");
  }
  if (changes.name !== undefined && viewNameKey(changes.name) !== viewNameKey(entry.name)) {
    assertNameFree(config, changes.name, entry.id);
  }
  const repaired: SavedQuery = {
    id: entry.id,
    name: changes.name ?? entry.name,
    // A broken entry has no readable filters, so an omitted list means
    // "no filters" rather than "keep what was there" — there is nothing
    // to keep. An empty list is a valid view (matches everything in
    // scope), and the caller has explicitly opted into the replacement.
    filters: normalizeFilters(changes.filters ?? []),
    ...(changes.sort !== undefined && changes.sort !== null ? { sort: changes.sort } : {}),
    ...(changes.archivedScope !== undefined ? { archivedScope: changes.archivedScope } : {}),
    ...(changes.icon !== undefined && changes.icon !== null ? { icon: changes.icon } : {}),
    ...(changes.color !== undefined && changes.color !== null ? { color: changes.color } : {}),
  };
  const remainingBroken = (config.broken ?? []).filter(b => b.id !== entry.id);
  await saveQueriesConfig(locttDir, {
    queries: [...config.queries, repaired],
    ...(remainingBroken.length > 0 ? { broken: remainingBroken } : {}),
  });
  return repaired;
}

/** Marks a view as archived. No-op when already archived. */
export async function archiveView(locttDir: string, ref: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadQueriesConfig(locttDir);
    assertNotBrokenForArchive(config, ref, "archive");
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
    assertNotBrokenForArchive(config, ref, "unarchive");
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
      // Rebuilt field by field, so a new field omitted here is a field
      // SILENTLY DELETED by unarchiving (the corruption guide's
      // "a writer preserves what it did not touch", rule 2).
      ...(existing.color !== undefined ? { color: existing.color } : {}),
    };
    const next = config.queries.map(q => (q.id === existing.id ? cleared : q));
    await saveQueriesConfig(locttDir, { queries: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export interface DeleteViewOptions {
  /** If true, removes the view from queries.yaml. Default is soft-delete (archive). */
  readonly hard?: boolean;
  /**
   * Explicit opt-in to delete a BROKEN entry, discarding the original
   * text `queries.yaml` preserves for it (K102-broken-repair). Delete
   * means delete — no `rawText` survives by design — so this takes the
   * same explicit consent as a replace rather than a quieter one.
   * Ignored for a healthy view.
   *
   * A SOFT delete of a broken entry is archive, which is refused
   * outright: this flag does not unlock it.
   */
  readonly replaceBroken?: boolean;
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
    const resolved = findViewOrBroken(config, ref);
    if (resolved.kind === "broken") {
      if (options.replaceBroken !== true) {
        throw brokenWriteGate(resolved.entry, "delete");
      }
      const entryId = resolved.entry.id;
      const remainingBroken = (config.broken ?? []).filter(b => b.id !== entryId);
      await saveQueriesConfig(locttDir, {
        queries: config.queries,
        ...(remainingBroken.length > 0 ? { broken: remainingBroken } : {}),
      });
      return;
    }
    const target = resolved.view;
    await saveQueriesConfig(locttDir, {
      queries: config.queries.filter(q => q.id !== target.id),
      ...(config.broken ? { broken: config.broken } : {}),
    });
  });
}
