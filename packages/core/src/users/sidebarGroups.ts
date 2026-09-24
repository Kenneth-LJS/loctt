import type { SidebarFilterId, SidebarGroupId, SidebarGroups, SidebarItemId, UserSettings } from "@loctt/contracts";
import { SIDEBAR_FILTER_IDS, SIDEBAR_ITEM_IDS, SidebarGroupsSchema } from "@loctt/contracts";

/**
 * Sidebar-groups customization (SHL-45): reading and resolving the
 * per-user `sidebar_groups` setting that controls which built-in
 * sidebar groups/filters show and in what order.
 *
 * This is the twin of `pins.ts`: pure logic over ids, imports nothing
 * from node, so the web client can import it directly (its barrel pulls
 * in the filesystem paths module, which has no browser build).
 */

const KNOWN_IDS: ReadonlySet<string> = new Set(SIDEBAR_ITEM_IDS);

/**
 * Splits a caller-supplied id list into the known ids (de-duplicated,
 * first occurrence winning) and the unknown ones, for a WRITE path that
 * must reject a typo rather than swallow it (SHL-45, B2 bug 4).
 *
 * The *reader* degrades a hand-edited file silently (a stray id in
 * settings.yaml must never make the sidebar unrenderable); a *write* is
 * a deliberate command, so an unknown id there is a typo the surface
 * should refuse and name — "you thought you hid a group, nothing
 * happened". CLI and MCP both call this so their validation is identical.
 *
 * Duplicates are not errors — they carry no typo signal and the schema
 * de-dups anyway — so they are folded silently into `known`.
 */
export function validateSidebarIds(raw: readonly string[]): {
  readonly known: SidebarItemId[];
  readonly unknown: string[];
} {
  const seen = new Set<string>();
  const known: SidebarItemId[] = [];
  const unknown: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string") continue;
    if (!KNOWN_IDS.has(id)) { unknown.push(id); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    known.push(id as SidebarItemId);
  }
  return { known, unknown };
}

/** The full set of valid ids, for building a "valid ids are: …" message. */
export const SIDEBAR_VALID_IDS: readonly string[] = SIDEBAR_ITEM_IDS;

/**
 * Reads `sidebar_groups` out of settings, tolerating a hand-edited file
 * (per the corruption-handling guide).
 *
 * `UserSettings` round-trips through `.passthrough()`, so this key can
 * hold anything at all. A value that is not a clean `SidebarGroups` is
 * treated as "no customization" (default order, all visible) rather
 * than throwing — a broken preference must never make the sidebar
 * unrenderable (P7). Within a value that IS shaped right, unknown and
 * duplicate ids are dropped rather than rejecting the whole setting, so
 * a single stray id degrades one entry, not the entire customization.
 */
export function readSidebarGroups(settings: UserSettings | undefined): SidebarGroups {
  const raw = (settings as { sidebar_groups?: unknown } | undefined)?.sidebar_groups;
  return salvageSidebarGroups(raw).groups;
}

/**
 * The outcome of salvaging a raw `sidebar_groups` value: the usable
 * `SidebarGroups`, plus the entries that had to be dropped so a caller
 * (doctor) can report them.
 *
 * `dropped` names each thing that was lifted out and why — `"unknown"`
 * (not a built-in id), `"duplicate"` (a second occurrence of an id already
 * kept), or `"malformed"` (a non-list value for a field, a non-string
 * element, or a stray/typo'd key whose ids would otherwise vanish) —
 * tagged with the list (`order`/`hidden`) it came from. `wholeValueDropped`
 * is true when the value was not even a shaped object (a scalar, a bare
 * list), so there was nothing to salvage per-field and it degraded to
 * "no customization" entirely.
 */
export interface SalvagedSidebarGroups {
  readonly groups: SidebarGroups;
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
 * A clean value passes through untouched. A shaped-but-dirty value
 * (`{ order?, hidden? }` holding a stray/duplicate id) keeps every valid
 * id and lifts out only the bad ones — a single stray id degrades one
 * entry, not the entire customization. A value that is not a shaped
 * object at all (a scalar, a bare list) has no per-field structure to
 * preserve and degrades to "no customization" (`wholeValueDropped`).
 *
 * This is the single tolerance point for the setting: the settings
 * loader runs a corrupt `sidebar_groups` through it (rather than dropping
 * the whole key), the web client runs a raw API object through it, and
 * doctor reads `dropped` to report what it lifted out.
 */
export function salvageSidebarGroups(raw: unknown): SalvagedSidebarGroups {
  if (raw === undefined) return { groups: {}, dropped: [], wholeValueDropped: false };
  const parsed = SidebarGroupsSchema.safeParse(raw);
  if (parsed.success) return { groups: parsed.data, dropped: [], wholeValueDropped: false };
  // The schema rejected it. If it is not even a shaped object there is
  // nothing to salvage per-field — degrade to "no customization".
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { groups: {}, dropped: [], wholeValueDropped: true };
  }
  // Shaped but dirty: keep only known, de-duplicated ids, and record the
  // rest so doctor can name them.
  const obj = raw as Record<string, unknown>;
  const dropped: SidebarGroupsDrop[] = [];
  const order = sanitizeIds(obj["order"], "order", dropped);
  const hidden = sanitizeIds(obj["hidden"], "hidden", dropped);
  // A key other than order/hidden is a typo (`hiden: [...]`) whose ids
  // would otherwise vanish with no trace — the user thinks they hid a
  // group and nothing happened. Record each so doctor names the stray key.
  for (const key of Object.keys(obj)) {
    if (key !== "order" && key !== "hidden") {
      dropped.push({ list: "order", id: `unknown key "${key}"`, reason: "malformed" });
    }
  }
  const result: SidebarGroups = {};
  if (order.length > 0) result.order = order;
  if (hidden.length > 0) result.hidden = hidden;
  return { groups: result, dropped, wholeValueDropped: false };
}

/**
 * Keep only known ids, first occurrence wins, others dropped — appending
 * a `SidebarGroupsDrop` for EVERY value lifted out so doctor can name it.
 * A present-but-non-array list (a scalar `hidden: "sprints"`), and a
 * non-string element inside a list (`[42, "labels"]`), are recorded as
 * `malformed` drops rather than skipped silently — a silent salvage doctor
 * cannot see is exactly what the corruption-handling-guide forbids.
 */
function sanitizeIds(
  value: unknown,
  list: "order" | "hidden",
  dropped: SidebarGroupsDrop[],
): SidebarItemId[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    // The key is present but not a list — the whole field is unusable.
    // Record it so doctor reports "hidden was set but is not a list".
    dropped.push({ list, id: describeValue(value), reason: "malformed" });
    return [];
  }
  const seen = new Set<string>();
  const out: SidebarItemId[] = [];
  for (const v of value) {
    if (typeof v !== "string") { dropped.push({ list, id: describeValue(v), reason: "malformed" }); continue; }
    if (!KNOWN_IDS.has(v)) { dropped.push({ list, id: v, reason: "unknown" }); continue; }
    if (seen.has(v)) { dropped.push({ list, id: v, reason: "duplicate" }); continue; }
    seen.add(v);
    out.push(v as SidebarItemId);
  }
  return out;
}

/** A short, safe label for a non-string value in a doctor message. */
function describeValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "an object";
  // Primitives only past here — never call String() on an object (it would
  // stringify to "[object Object]"); the guards above have excluded those.
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return `${v}`;
  }
  return `a ${typeof v}`;
}

/**
 * The resolved render decision for one sidebar item.
 *
 * `hidden` items are still returned (in their resolved order) so a
 * surface can render an editor that lists them; a renderer that only
 * shows the sidebar filters on `visible`.
 */
export interface ResolvedSidebarItem {
  readonly id: SidebarItemId;
  readonly hidden: boolean;
}

/**
 * Resolves a stored `sidebar_groups` setting against the full catalog
 * of built-in ids into a single ordered, de-duplicated list with a
 * `hidden` flag per item (SHL-45).
 *
 * Rules, all degrade-safe:
 *  - Items named in `order` come first, in that order.
 *  - Any catalog id NOT in `order` follows, in its natural default
 *    order — so an absent setting yields the default order, all
 *    visible, and a partial `order` need not enumerate everything.
 *  - An id in `hidden` is marked `hidden: true`.
 *  - Unknown ids in the setting were already dropped by the reader;
 *    an id in the setting that is not in `catalog` (e.g. a filter id
 *    passed a group-only catalog) is skipped here too.
 *
 * `catalog` is passed in rather than hardcoded so the same resolver
 * orders the top-level groups (given the group catalog) and, if a
 * caller wants, the built-in filters (given the filter catalog).
 */
export function resolveSidebarOrder(
  groups: SidebarGroups,
  catalog: readonly SidebarItemId[],
): readonly ResolvedSidebarItem[] {
  const inCatalog = new Set<string>(catalog);
  const hidden = new Set(groups.hidden ?? []);
  const order = (groups.order ?? []).filter(id => inCatalog.has(id));
  const placed = new Set(order);
  const tail = catalog.filter(id => !placed.has(id));
  return [...order, ...tail].map(id => ({ id, hidden: hidden.has(id) }));
}

/**
 * One row of the Customize-sidebar panel's NESTED view (K125): either a
 * plain top-level item, or the "Filters" group with its built-ins as
 * children.
 *
 * This is a presentation shape derived from the same flat
 * `order`/`hidden` storage `resolveSidebarOrder` already reads — nesting
 * the six `SIDEBAR_FILTER_IDS` under one group is a panel-rendering
 * concern, not a new stored shape beyond the `filters` group id itself.
 */
export type GroupedSidebarRow =
  | { readonly kind: "item"; readonly id: SidebarGroupId; readonly hidden: boolean }
  | {
      readonly kind: "filters-group";
      readonly hidden: boolean;
      readonly children: readonly { readonly id: SidebarFilterId; readonly hidden: boolean }[];
    };

/**
 * Resolves `sidebar_groups` into the nested rows the Customize-sidebar
 * panel renders: the top-level groups (from the `groupCatalog` passed in,
 * normally `SIDEBAR_GROUP_IDS`) with the six built-ins collapsed into
 * one `filters-group` row, in their own resolved order.
 *
 * **Migrating an existing flat stored order (K125).** Before this
 * ticket, a user could only reorder/hide each built-in filter
 * INDIVIDUALLY — there was no `filters` group id. A stored `order` from
 * that era mixes filter ids in among the group ids at the top level
 * (e.g. `["overdue", "projects", "labels"]`), with no `filters` entry
 * to say where the new group row belongs. Rule chosen (recorded as
 * A339): the migrated group's position is the position of the FIRST
 * filter id found in the flat resolved order (falling back to
 * `filters`'s own default catalog slot when no filter id appears in
 * `order` at all — a user who never touched a filter's position gets
 * the group in its natural default place). The six filters' own inner
 * order and hidden flags are preserved exactly — this function reads
 * them through the existing `resolveSidebarOrder(groups,
 * SIDEBAR_FILTER_IDS)` call, unchanged by this migration. A user who HAS
 * already explicitly placed `filters` in `order` (a fresh save made
 * after this ticket) is honored as stored — the fallback only fires
 * when `filters` itself is absent from `order`.
 */
export function resolveGroupedSidebarOrder(
  groups: SidebarGroups,
  groupCatalog: readonly SidebarGroupId[],
): readonly GroupedSidebarRow[] {
  const filterOrder = resolveSidebarOrder(groups, SIDEBAR_FILTER_IDS);
  const filterIds: ReadonlySet<string> = new Set(SIDEBAR_FILTER_IDS);
  const hiddenSet = new Set(groups.hidden ?? []);
  const filtersGroupHidden = hiddenSet.has("filters");

  const filtersGroupRow: GroupedSidebarRow = {
    kind: "filters-group",
    hidden: filtersGroupHidden,
    children: filterOrder.map(f => ({ id: f.id as SidebarFilterId, hidden: f.hidden })),
  };

  // Migration: does the STORED order already say where `filters` goes?
  const storedOrder = groups.order ?? [];
  const filtersAlreadyPlaced = storedOrder.includes("filters");

  if (filtersAlreadyPlaced) {
    // Post-migration shape: resolve the group catalog normally (it
    // already contains "filters" as one entry) and drop any lingering
    // individual filter id from the top-level order — those only
    // control the CHILDREN now, never a top-level slot.
    const topOrder = storedOrder.filter(id => !filterIds.has(id));
    const resolved = resolveSidebarOrder({ ...groups, order: topOrder }, groupCatalog);
    return resolved.map(r =>
      r.id === "filters" ? filtersGroupRow : { kind: "item", id: r.id as SidebarGroupId, hidden: r.hidden },
    );
  }

  // Migration path: no `filters` entry in the stored order. Splice the
  // group row in at the position of the first individual filter id in
  // `storedOrder`, if any; otherwise fall through to the group's
  // default catalog position (resolveSidebarOrder's normal behavior).
  const firstFilterIndex = storedOrder.findIndex(id => filterIds.has(id));
  const topOrderWithoutFilters = storedOrder.filter(id => !filterIds.has(id));

  const migratedOrder =
    firstFilterIndex === -1
      ? topOrderWithoutFilters
      : [
          ...topOrderWithoutFilters.slice(0, firstFilterIndex),
          "filters" as const,
          ...topOrderWithoutFilters.slice(firstFilterIndex),
        ];

  const resolved = resolveSidebarOrder({ ...groups, order: migratedOrder }, groupCatalog);
  return resolved.map(r =>
    r.id === "filters" ? filtersGroupRow : { kind: "item", id: r.id as SidebarGroupId, hidden: r.hidden },
  );
}
