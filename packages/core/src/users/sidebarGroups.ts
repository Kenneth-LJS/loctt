import type {
  SavedViewSidebarId,
  SidebarBuiltinViewId,
  SidebarGroupId,
  SidebarGroups,
  SidebarItemId,
  UserSettings,
} from "@loctt/contracts";
import {
  isSidebarItemId,
  parseSavedViewSidebarId,
  savedViewSidebarId,
  SIDEBAR_BUILTIN_VIEW_IDS,
  SIDEBAR_GROUP_IDS,
  SIDEBAR_GROUPS_VERSION,
  SIDEBAR_ITEM_IDS,
  SidebarGroupsSchema,
} from "@loctt/contracts";

/**
 * Sidebar-groups customization (SHL-45, K125, K158): reading and
 * resolving the per-user `sidebar_groups` setting that orders and
 * hides the sidebar's groups and the views inside its Views group.
 *
 * Pure logic over ids, imports nothing from node, so the web client can import it directly (its barrel pulls
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
 * view takes when the user has not placed it (`queries.yaml` order, then
 * broken views (VUE-22)). Archived views are not listed (VUE-25); they
 * stay runnable by id.
 */
export function sidebarSavedViews(
  queries: readonly { readonly id: string; readonly name: string; readonly archived?: boolean | undefined }[],
  broken: readonly { readonly id: string; readonly name: string }[],
): readonly SidebarSavedView[] {
  const healthy = queries.filter(q => q.archived !== true);
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
 * K158 value, plus the entries that had to be dropped so a caller
 * (doctor) can report them.
 *
 * `dropped` names each thing that was lifted out and why: `"unknown"`
 * (not a sidebar id), `"duplicate"` (a second occurrence of an id already
 * kept), or `"malformed"` (a non-list value for a field, a non-string
 * element, a stray/typo'd key, or a `version` this build does not know),
 * tagged with the list (`order`/`hidden`) it came from.
 * `wholeValueDropped` is true when the value was not even a shaped object
 * (a scalar, a bare list), so it degraded to "no customization" entirely.
 *
 * `olderLayout` is true when the value is an object without `version`:
 * the shape loctt wrote before K158. The 0.3.0 → 0.4.0 upgrade step
 * converts it (K160); one still on disk after that is corrupt, reads as
 * the default layout, and doctor tells the user to upgrade the tracker or
 * reset the layout. It is not per-field salvaged: its ids meant other
 * things (`views` was the List / Board / Timeline switcher).
 */
export interface SalvagedSidebarGroups {
  readonly groups: SidebarGroups;
  readonly dropped: readonly SidebarGroupsDrop[];
  readonly wholeValueDropped: boolean;
  readonly olderLayout: boolean;
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
 * A clean K158 value passes through untouched. A shaped but dirty value
 * keeps every valid id and lifts out only the bad ones: a single stray id
 * degrades one entry, not the entire customization. A value that is not
 * a shaped object at all degrades to "no customization"
 * (`wholeValueDropped`), and so does an object without `version`, the
 * pre-K158 shape (`olderLayout`, K160). A `version` other than 2 is
 * reported and read as the K158 set, the newest this build knows.
 *
 * This is the single tolerance point for the setting: the settings loader
 * runs a corrupt `sidebar_groups` through it (rather than dropping the
 * whole key), the readers below run every raw value through it, and
 * doctor reads `dropped` and the two flags to report what it lifted out.
 */
export function salvageSidebarGroups(raw: unknown): SalvagedSidebarGroups {
  const none = { version: SIDEBAR_GROUPS_VERSION } as const;
  if (raw === undefined) return { groups: none, dropped: [], wholeValueDropped: false, olderLayout: false };
  const v2 = SidebarGroupsSchema.safeParse(raw);
  if (v2.success) return { groups: v2.data, dropped: [], wholeValueDropped: false, olderLayout: false };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { groups: none, dropped: [], wholeValueDropped: true, olderLayout: false };
  }
  const obj = raw as Record<string, unknown>;
  if (!("version" in obj)) return { groups: none, dropped: [], wholeValueDropped: false, olderLayout: true };
  const dropped: SidebarGroupsDrop[] = [];
  if (obj["version"] !== SIDEBAR_GROUPS_VERSION) {
    dropped.push({ list: "order", id: `version ${describeValue(obj["version"])}`, reason: "malformed" });
  }
  const order = sanitizeIds(obj["order"], "order", isSidebarItemId, dropped);
  const hidden = sanitizeIds(obj["hidden"], "hidden", isSidebarItemId, dropped);
  // A key other than version/order/hidden is a typo (`hiden: [...]`) whose
  // ids would otherwise vanish with no trace. Record each so doctor names it.
  for (const key of Object.keys(obj)) {
    if (key !== "order" && key !== "hidden" && key !== "version") {
      dropped.push({ list: "order", id: `unknown key "${key}"`, reason: "malformed" });
    }
  }
  const groups: SidebarGroups = { version: SIDEBAR_GROUPS_VERSION };
  if (order.length > 0) groups.order = order as SidebarItemId[];
  if (hidden.length > 0) groups.hidden = hidden as SidebarItemId[];
  return { groups, dropped, wholeValueDropped: false, olderLayout: false };
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

/**
 * Reads `sidebar_groups` out of settings in the K158 shape, tolerating a
 * hand-edited file (`salvageSidebarGroups`): a corrupt part drops alone,
 * and a value that is not a K158 object at all reads as the default.
 */
export function readSidebarGroups(settings: UserSettings | undefined): SidebarGroups {
  const raw = (settings as { sidebar_groups?: unknown } | undefined)?.sidebar_groups;
  return salvageSidebarGroups(raw).groups;
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
 * same settings write.
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

/** Whether `id` names a top-level group (not a Views child). */
export function isSidebarGroupId(id: string): id is SidebarGroupId {
  return GROUP_IDS.has(id);
}
