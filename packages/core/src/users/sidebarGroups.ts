import type {
  LegacySidebarGroups,
  LegacySidebarItemId,
  SavedViewSidebarId,
  SidebarBuiltinViewId,
  SidebarGroupId,
  SidebarGroups,
  SidebarItemId,
  StoredSidebarGroups,
  UserSettings,
} from "@loctt/contracts";
import {
  isSidebarItemId,
  LEGACY_SIDEBAR_GROUP_IDS,
  LEGACY_SIDEBAR_ITEM_IDS,
  LegacySidebarGroupsSchema,
  parseSavedViewSidebarId,
  savedViewSidebarId,
  SIDEBAR_BUILTIN_VIEW_IDS,
  SIDEBAR_GROUP_IDS,
  SIDEBAR_GROUPS_VERSION,
  SIDEBAR_ITEM_IDS,
  SidebarGroupsSchema,
} from "@loctt/contracts";

/**
 * Sidebar-groups customization (SHL-45, K125, K158): reading, migrating
 * and resolving the per-user `sidebar_groups` setting that orders and
 * hides the sidebar's groups and the views inside its Views group.
 *
 * This is the twin of `pins.ts`: pure logic over ids, imports nothing
 * from node, so the web client can import it directly (its barrel pulls
 * in the filesystem paths module, which has no browser build).
 *
 * ## The K158 model
 *
 * One `views` group holds the built-in views and the saved views in one
 * ordered, hideable list (Ken: *"it should be 1. then we can re-order
 * them, and we can hide"*). Its children are the six built-in ids and
 * `view:<id>` for each saved view. The List / Board / Timeline switcher
 * is `layouts`.
 *
 * Saved views are data, not a closed catalog, so every resolver here
 * takes the saved views the caller loaded (`SidebarSavedView[]`, built by
 * `sidebarSavedViews`) in their default order. A `view:<id>` naming a view
 * that is not in that list (deleted, or archived) is skipped: a deleted
 * view drops out of the order.
 */

const BUILTIN_IDS: ReadonlySet<string> = new Set(SIDEBAR_BUILTIN_VIEW_IDS);
const GROUP_IDS: ReadonlySet<string> = new Set(SIDEBAR_GROUP_IDS);

/** A saved view as the sidebar lists it. */
export interface SidebarSavedView {
  /** The view's `queries.yaml` id (not the `view:` sidebar id). */
  readonly id: string;
  readonly name: string;
  /** Its filters no longer load (VUE-22): shown with a warning, never counted. */
  readonly broken: boolean;
}

/**
 * The saved views the sidebar can list, in their DEFAULT order: the one a
 * view takes when the user has not placed it.
 *
 * That order is the one the sidebar used before K158, so nothing moves on
 * the first load after it: pinned views first in pin order (SET-13), then
 * the rest in `queries.yaml` order, then broken views (VUE-22). Archived
 * views are not listed (VUE-25); they stay runnable by id.
 */
export function sidebarSavedViews(
  queries: readonly { readonly id: string; readonly name: string; readonly archived?: boolean | undefined }[],
  broken: readonly { readonly id: string; readonly name: string }[],
  pins: readonly string[],
): readonly SidebarSavedView[] {
  const active = queries.filter(q => q.archived !== true);
  const byId = new Map(active.map(q => [q.id, q]));
  const pinned = pins.flatMap(id => {
    const q = byId.get(id);
    return q === undefined ? [] : [q];
  });
  const pinnedIds = new Set(pinned.map(q => q.id));
  const healthy = [...pinned, ...active.filter(q => !pinnedIds.has(q.id))];
  const seen = new Set(healthy.map(q => q.id));
  return [
    ...healthy.map(q => ({ id: q.id, name: q.name, broken: false })),
    ...broken.filter(b => !seen.has(b.id)).map(b => ({ id: b.id, name: b.name, broken: true })),
  ];
}

/**
 * Splits a caller-supplied id list into the known ids (de-duplicated,
 * first occurrence winning) and the unknown ones, for a WRITE path that
 * must reject a typo rather than swallow it (SHL-45, B2 bug 4).
 *
 * Known: a group id, a built-in view id, or `view:<id>` for a saved view
 * in `savedViews`. A `view:` id for a view that does not exist is a typo
 * here (the command named it deliberately), even though the reader
 * tolerates one in a stored file.
 *
 * The *reader* degrades a hand-edited file silently (a stray id in
 * settings.yaml must never make the sidebar unrenderable); a *write* is
 * a deliberate command, so an unknown id there is a typo the surface
 * should refuse and name. CLI and MCP both call this so their validation
 * is identical. Duplicates are folded silently into `known`.
 */
export function validateSidebarIds(
  raw: readonly string[],
  savedViews: readonly SidebarSavedView[],
): {
  readonly known: SidebarItemId[];
  readonly unknown: string[];
} {
  const viewIds = new Set(savedViews.map(v => v.id));
  const seen = new Set<string>();
  const known: SidebarItemId[] = [];
  const unknown: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const viewId = parseSavedViewSidebarId(id);
    const ok = viewId !== undefined ? viewIds.has(viewId) : isSidebarItemId(id);
    if (!ok) { unknown.push(id); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    known.push(id as SidebarItemId);
  }
  return { known, unknown };
}

/** The fixed valid ids, for building a "valid ids are: …" message. */
export const SIDEBAR_VALID_IDS: readonly string[] = SIDEBAR_ITEM_IDS;

/**
 * "Valid ids: …" for a refused write: the fixed ids, then each saved view
 * as `view:<id>`.
 */
export function sidebarValidIdsList(savedViews: readonly SidebarSavedView[]): string {
  return [...SIDEBAR_ITEM_IDS, ...savedViews.map(v => savedViewSidebarId(v.id))].join(", ");
}

/**
 * The outcome of salvaging a raw `sidebar_groups` value: the usable
 * stored value (the K158 shape, or a pre-K158 one still to migrate), plus
 * the entries that had to be dropped so a caller (doctor) can report
 * them.
 *
 * `dropped` names each thing that was lifted out and why: `"unknown"`
 * (not a sidebar id), `"duplicate"` (a second occurrence of an id already
 * kept), or `"malformed"` (a non-list value for a field, a non-string
 * element, a stray/typo'd key, or a `version` this build does not know),
 * tagged with the list (`order`/`hidden`) it came from.
 * `wholeValueDropped` is true when the value was not even a shaped object
 * (a scalar, a bare list), so it degraded to "no customization" entirely.
 *
 * A pre-K158 value is NOT a drop: it is a valid older format, migrated on
 * read (`readSidebarGroups`), and doctor says nothing about it.
 */
export interface SalvagedSidebarGroups {
  readonly groups: StoredSidebarGroups;
  readonly dropped: readonly SidebarGroupsDrop[];
  readonly wholeValueDropped: boolean;
}

export interface SidebarGroupsDrop {
  readonly list: "order" | "hidden";
  readonly id: string;
  readonly reason: "unknown" | "duplicate" | "malformed";
}

/**
 * Salvages a raw `sidebar_groups` value **per field** (SHL-45, the
 * field-local principle from the corruption-handling-guide).
 *
 * A clean value (either format) passes through untouched. A shaped but
 * dirty value keeps every valid id and lifts out only the bad ones: a
 * single stray id degrades one entry, not the entire customization. A
 * value that is not a shaped object at all degrades to "no
 * customization" (`wholeValueDropped`).
 *
 * The format is decided by `version`: present means the K158 id set (a
 * version other than 2 is reported and read as the K158 set, the newest
 * this build knows); absent means the pre-K158 set.
 *
 * This is the single tolerance point for the setting: the settings loader
 * runs a corrupt `sidebar_groups` through it (rather than dropping the
 * whole key), the readers below run every raw value through it, and
 * doctor reads `dropped` to report what it lifted out.
 */
export function salvageSidebarGroups(raw: unknown): SalvagedSidebarGroups {
  if (raw === undefined) return { groups: { version: SIDEBAR_GROUPS_VERSION }, dropped: [], wholeValueDropped: false };
  const v2 = SidebarGroupsSchema.safeParse(raw);
  if (v2.success) return { groups: v2.data, dropped: [], wholeValueDropped: false };
  const legacy = LegacySidebarGroupsSchema.safeParse(raw);
  if (legacy.success) return { groups: legacy.data, dropped: [], wholeValueDropped: false };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { groups: { version: SIDEBAR_GROUPS_VERSION }, dropped: [], wholeValueDropped: true };
  }
  const obj = raw as Record<string, unknown>;
  const dropped: SidebarGroupsDrop[] = [];
  const isV2 = "version" in obj;
  if (isV2 && obj["version"] !== SIDEBAR_GROUPS_VERSION) {
    dropped.push({ list: "order", id: `version ${describeValue(obj["version"])}`, reason: "malformed" });
  }
  const valid: (id: string) => boolean = isV2
    ? isSidebarItemId
    : id => (LEGACY_SIDEBAR_ITEM_IDS as readonly string[]).includes(id);
  const order = sanitizeIds(obj["order"], "order", valid, dropped);
  const hidden = sanitizeIds(obj["hidden"], "hidden", valid, dropped);
  // A key other than version/order/hidden is a typo (`hiden: [...]`) whose
  // ids would otherwise vanish with no trace. Record each so doctor names it.
  for (const key of Object.keys(obj)) {
    if (key !== "order" && key !== "hidden" && !(isV2 && key === "version")) {
      dropped.push({ list: "order", id: `unknown key "${key}"`, reason: "malformed" });
    }
  }
  if (isV2) {
    const groups: SidebarGroups = { version: SIDEBAR_GROUPS_VERSION };
    if (order.length > 0) groups.order = order as SidebarItemId[];
    if (hidden.length > 0) groups.hidden = hidden as SidebarItemId[];
    return { groups, dropped, wholeValueDropped: false };
  }
  const groups: LegacySidebarGroups = {};
  if (order.length > 0) groups.order = order as LegacySidebarItemId[];
  if (hidden.length > 0) groups.hidden = hidden as LegacySidebarItemId[];
  return { groups, dropped, wholeValueDropped: false };
}

/**
 * Keep only valid ids, first occurrence wins, others dropped, appending a
 * `SidebarGroupsDrop` for EVERY value lifted out so doctor can name it.
 */
function sanitizeIds(
  value: unknown,
  list: "order" | "hidden",
  valid: (id: string) => boolean,
  dropped: SidebarGroupsDrop[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    dropped.push({ list, id: describeValue(value), reason: "malformed" });
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") { dropped.push({ list, id: describeValue(v), reason: "malformed" }); continue; }
    if (!valid(v)) { dropped.push({ list, id: v, reason: "unknown" }); continue; }
    if (seen.has(v)) { dropped.push({ list, id: v, reason: "duplicate" }); continue; }
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** A short, safe label for a non-string value in a doctor message. */
function describeValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "an object";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return `${v}`;
  }
  return `a ${typeof v}`;
}

function isLegacy(groups: StoredSidebarGroups): groups is LegacySidebarGroups {
  return !("version" in groups);
}

/**
 * Whether the stored `sidebar_groups` is still a pre-K158 value. A writer
 * that migrates it needs the saved views loaded first: the pre-K158 value
 * can hide or place them as a block, and the K158 value names each one.
 */
export function isLegacySidebarGroups(settings: UserSettings | undefined): boolean {
  const raw = (settings as { sidebar_groups?: unknown } | undefined)?.sidebar_groups;
  return raw !== undefined && isLegacy(salvageSidebarGroups(raw).groups);
}

/**
 * Reads `sidebar_groups` out of settings in the K158 shape, tolerating a
 * hand-edited file and migrating a pre-K158 value (see
 * `migrateLegacySidebarGroups`).
 *
 * `savedViews` is needed for the migration only: a pre-K158 setting could
 * place or hide the saved views as a block, and the K158 shape names each
 * one. A K158 value is returned as salvaged, whatever `savedViews` holds.
 */
export function readSidebarGroups(
  settings: UserSettings | undefined,
  savedViews: readonly SidebarSavedView[],
): SidebarGroups {
  const raw = (settings as { sidebar_groups?: unknown } | undefined)?.sidebar_groups;
  const stored = salvageSidebarGroups(raw).groups;
  return isLegacy(stored) ? migrateLegacySidebarGroups(stored, savedViews) : stored;
}

/** The two id lists a resolver reads; ids it does not know are skipped. */
export interface SidebarOrderInput {
  readonly order?: readonly string[] | undefined;
  readonly hidden?: readonly string[] | undefined;
}

/**
 * Resolves a stored order against a catalog into one ordered,
 * de-duplicated list with a `hidden` flag per item.
 *
 *  - Items named in `order` come first, in that order.
 *  - Any catalog id NOT in `order` follows, in catalog order.
 *  - An id in `hidden` is marked hidden.
 *  - An id not in `catalog` is skipped.
 */
export function resolveSidebarOrder<Id extends string>(
  groups: SidebarOrderInput,
  catalog: readonly Id[],
): readonly { readonly id: Id; readonly hidden: boolean }[] {
  const inCatalog = new Set<string>(catalog);
  const hidden = new Set<string>(groups.hidden ?? []);
  const order = (groups.order ?? []).filter((id): id is Id => inCatalog.has(id));
  const placed = new Set<string>(order);
  const tail = catalog.filter(id => !placed.has(id));
  return [...order, ...tail].map(id => ({ id, hidden: hidden.has(id) }));
}

/** One child of the Views group, as resolved for rendering. */
export type SidebarViewChild =
  | { readonly kind: "builtin"; readonly id: SidebarBuiltinViewId; readonly hidden: boolean }
  | {
      readonly kind: "saved";
      readonly id: SavedViewSidebarId;
      readonly viewId: string;
      readonly name: string;
      readonly broken: boolean;
      readonly hidden: boolean;
    };

/**
 * One top-level row of the resolved sidebar: a plain group, or the Views
 * group with its children. `hidden` on a child is the child's OWN flag;
 * the sidebar also hides every child while the group is hidden
 * (`resolveRenderedSidebarItems` folds that in).
 */
export type SidebarLayoutRow =
  | { readonly kind: "group"; readonly id: Exclude<SidebarGroupId, "views">; readonly hidden: boolean }
  | { readonly kind: "views"; readonly hidden: boolean; readonly children: readonly SidebarViewChild[] };

/**
 * Resolves a K158 `sidebar_groups` value into the rows the web sidebar,
 * the Customize-sidebar panel, the CLI and MCP all read.
 *
 * Groups: the stored order, then unplaced groups at their catalog slots.
 * Views children: the children placed in `order` (by their relative
 * position there), then unplaced built-ins in their default order, then
 * unplaced saved views in `savedViews` order. A new saved view therefore
 * appends, and a `view:<id>` whose view is gone is skipped.
 */
export function resolveSidebarLayout(
  groups: SidebarOrderInput,
  savedViews: readonly SidebarSavedView[],
): readonly SidebarLayoutRow[] {
  const hidden = new Set<string>(groups.hidden ?? []);
  const byChildId = new Map(savedViews.map(v => [savedViewSidebarId(v.id) as string, v]));
  const childCatalog: string[] = [...SIDEBAR_BUILTIN_VIEW_IDS, ...byChildId.keys()];
  const childRows = resolveSidebarOrder(groups, childCatalog);
  const children: SidebarViewChild[] = childRows.map(c => {
    const saved = byChildId.get(c.id);
    if (saved === undefined) {
      return { kind: "builtin", id: c.id as SidebarBuiltinViewId, hidden: c.hidden };
    }
    return {
      kind: "saved",
      id: c.id as SavedViewSidebarId,
      viewId: saved.id,
      name: saved.name,
      broken: saved.broken,
      hidden: c.hidden,
    };
  });
  return resolveSidebarOrder(groups, SIDEBAR_GROUP_IDS).map(r =>
    r.id === "views"
      ? { kind: "views", hidden: hidden.has("views"), children }
      : { kind: "group", id: r.id, hidden: r.hidden },
  );
}

/**
 * The K158 value that stores `rows` exactly: the FULL order (each group,
 * with the Views children listed straight after `views`) and the full
 * hidden list. The Customize-sidebar panel writes through this, so the
 * file and what is on screen never drift.
 *
 * `previous` is the value being replaced. A `view:<id>` it holds that
 * `rows` does not list (an archived view, which the sidebar does not
 * show) is kept, at the end of the order and in `hidden` as it was, so
 * restoring the view brings back its place and its flag.
 */
export function sidebarGroupsFromLayout(
  rows: readonly SidebarLayoutRow[],
  previous?: SidebarOrderInput,
): SidebarGroups {
  const order: SidebarItemId[] = [];
  const hidden: SidebarItemId[] = [];
  for (const row of rows) {
    if (row.kind === "group") {
      order.push(row.id);
      if (row.hidden) hidden.push(row.id);
      continue;
    }
    order.push("views");
    if (row.hidden) hidden.push("views");
    for (const child of row.children) {
      order.push(child.id);
      if (child.hidden) hidden.push(child.id);
    }
  }
  const listed = new Set<string>(order);
  for (const id of previous?.order ?? []) {
    if (!listed.has(id) && parseSavedViewSidebarId(id) !== undefined) order.push(id as SavedViewSidebarId);
  }
  for (const id of previous?.hidden ?? []) {
    if (!listed.has(id) && parseSavedViewSidebarId(id) !== undefined) hidden.push(id as SavedViewSidebarId);
  }
  return {
    version: SIDEBAR_GROUPS_VERSION,
    order,
    ...(hidden.length > 0 ? { hidden } : {}),
  };
}

/**
 * `groups` without any mention of one saved view: the web's delete drops
 * the deleted view's `view:<id>` from the order and the hidden list in the
 * same settings write that drops its pin.
 */
export function forgetSavedViewInSidebar(groups: SidebarGroups, viewId: string): SidebarGroups {
  const id = savedViewSidebarId(viewId);
  const order = (groups.order ?? []).filter(o => o !== id);
  const hidden = (groups.hidden ?? []).filter(h => h !== id);
  return {
    version: SIDEBAR_GROUPS_VERSION,
    ...(order.length > 0 ? { order } : {}),
    ...(hidden.length > 0 ? { hidden } : {}),
  };
}

/**
 * `groups` with one item's own hidden flag set or cleared (the sidebar's
 * ⋯ → Hide, K158). The order is left as stored.
 */
export function setSidebarItemHidden(
  groups: SidebarGroups,
  id: SidebarItemId,
  hide: boolean,
): SidebarGroups {
  const rest = (groups.hidden ?? []).filter(h => h !== id);
  const hidden = hide ? [...rest, id] : rest;
  const { hidden: _drop, ...base } = groups;
  return hidden.length > 0 ? { ...base, hidden } : base;
}

/**
 * One entry of the flat read-back CLI and MCP print (A346, K158): every
 * group, with the Views group's children straight after it. A child is
 * `hidden` when its own flag is set OR the Views group is hidden, which
 * is what the sidebar shows. Saved views carry their name, and `broken`
 * when their filters no longer load.
 */
export interface ResolvedSidebarItem {
  readonly id: SidebarItemId;
  readonly hidden: boolean;
  readonly name?: string;
  readonly broken?: boolean;
}

export function resolveRenderedSidebarItems(
  groups: SidebarOrderInput,
  savedViews: readonly SidebarSavedView[],
): readonly ResolvedSidebarItem[] {
  const out: ResolvedSidebarItem[] = [];
  for (const row of resolveSidebarLayout(groups, savedViews)) {
    if (row.kind === "group") {
      out.push({ id: row.id, hidden: row.hidden });
      continue;
    }
    out.push({ id: "views", hidden: row.hidden });
    for (const child of row.children) {
      const hidden = row.hidden || child.hidden;
      out.push(
        child.kind === "saved"
          ? { id: child.id, hidden, name: child.name, ...(child.broken ? { broken: true } : {}) }
          : { id: child.id, hidden },
      );
    }
  }
  return out;
}

// ── Pre-K158 settings ────────────────────────────────────────────────

/**
 * Migrates a pre-K158 `sidebar_groups` value to the K158 shape so the
 * sidebar looks the same as it did (A370).
 *
 * The old value is first resolved exactly as the old sidebar rendered it
 * (including K125's A339 rule for a value older still: a `filters` group
 * absent from `order` sits where the first built-in id did). Then:
 *
 *  - `views` (the switcher) becomes `layouts`, same place, same flag.
 *  - `saved-filters` and `filters` become one `views` group, placed where
 *    the EARLIER of the two sat.
 *  - Its children are the two old sections' rows in the order they
 *    rendered: the built-ins in their stored order and the saved views in
 *    `savedViews` order, whichever section came first leading.
 *  - Hidden: `views` is hidden only when both old groups were. Otherwise
 *    the children of a hidden old group are hidden one by one, so what
 *    was hidden stays hidden. Every built-in's own flag is kept.
 *
 * A saved view created after the migration is not covered by an old
 * "saved views hidden" choice: it appends, visible, like any new view.
 */
export function migrateLegacySidebarGroups(
  legacy: LegacySidebarGroups,
  savedViews: readonly SidebarSavedView[],
): SidebarGroups {
  const rows = resolveLegacyRows(legacy);
  const savedHidden = rows.find(r => r.id === "saved-filters")?.hidden ?? false;
  const filtersRow = rows.find(r => r.id === "filters");
  const filtersHidden = filtersRow?.hidden ?? false;
  const bothHidden = savedHidden && filtersHidden;

  const order: SidebarItemId[] = [];
  const hidden: SidebarItemId[] = [];
  const children: SidebarItemId[] = [];
  const childHidden: SidebarItemId[] = [];
  let viewsPlaced = false;

  for (const row of rows) {
    if (row.id === "saved-filters" || row.id === "filters") {
      if (!viewsPlaced) {
        order.push("views");
        if (bothHidden) hidden.push("views");
        viewsPlaced = true;
      }
      if (row.id === "filters") {
        for (const c of row.children ?? []) {
          children.push(c.id);
          // When the whole group is hidden the built-ins keep only their
          // own flags; otherwise a hidden Filters group hides each one.
          if (c.hidden || (filtersHidden && !bothHidden)) childHidden.push(c.id);
        }
      } else {
        for (const v of savedViews) {
          const id = savedViewSidebarId(v.id);
          children.push(id);
          if (savedHidden && !bothHidden) childHidden.push(id);
        }
      }
      continue;
    }
    const id: SidebarGroupId = row.id === "views" ? "layouts" : row.id;
    order.push(id);
    if (row.hidden) hidden.push(id);
  }

  // Children sit straight after `views` (only their relative order
  // matters; this keeps the file readable).
  const at = order.indexOf("views");
  order.splice(at + 1, 0, ...children);
  const allHidden = [...hidden, ...childHidden];
  return {
    version: SIDEBAR_GROUPS_VERSION,
    order,
    ...(allHidden.length > 0 ? { hidden: allHidden } : {}),
  };
}

interface LegacyRow {
  readonly id: (typeof LEGACY_SIDEBAR_GROUP_IDS)[number];
  readonly hidden: boolean;
  readonly children?: readonly { readonly id: SidebarBuiltinViewId; readonly hidden: boolean }[];
}

/**
 * The pre-K158 sidebar's rows, as it rendered them (K125/A339): the
 * `filters` group at its stored position, or, when a value older still
 * has no `filters` entry, where the first built-in id sat.
 */
function resolveLegacyRows(groups: LegacySidebarGroups): readonly LegacyRow[] {
  const filterOrder = resolveSidebarOrder(groups, SIDEBAR_BUILTIN_VIEW_IDS);
  const storedOrder: readonly string[] = groups.order ?? [];
  const hiddenSet = new Set<string>(groups.hidden ?? []);
  const withoutBuiltins = storedOrder.filter(id => !BUILTIN_IDS.has(id));
  let topOrder: string[];
  if (storedOrder.includes("filters")) {
    topOrder = withoutBuiltins;
  } else {
    const firstBuiltin = storedOrder.findIndex(id => BUILTIN_IDS.has(id));
    topOrder = firstBuiltin === -1
      ? withoutBuiltins
      : [...withoutBuiltins.slice(0, firstBuiltin), "filters", ...withoutBuiltins.slice(firstBuiltin)];
  }
  return resolveSidebarOrder({ order: topOrder, hidden: [...hiddenSet] }, LEGACY_SIDEBAR_GROUP_IDS).map(r =>
    r.id === "filters"
      ? { id: r.id, hidden: r.hidden, children: filterOrder }
      : { id: r.id, hidden: r.hidden },
  );
}

/** Whether `id` names a top-level group (not a Views child). */
export function isSidebarGroupId(id: string): id is SidebarGroupId {
  return GROUP_IDS.has(id);
}
