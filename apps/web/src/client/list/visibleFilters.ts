import type { UserSettings, WorkflowConfig } from "@loctt/contracts";

import type { FacetKey } from "./FilterBar.tsx";

/**
 * The configurable visible-filter set (K97).
 *
 * As custom enum fields grow, FilterBar would render a FilterFacet per
 * field on top of the nine built-ins — 15-25+ permanent pills. K97 makes
 * the *visible* set configurable, scoped per-view with a per-user default
 * and a built-in fallback:
 *
 *   active view's set → per-user default → built-in default
 *
 * A filter is identified by a stable string id:
 *  - built-in facets by their {@link FacetKey} (`project`, `status`, …);
 *  - custom enum fields by `field.<key>` (matching the URL param key the
 *    chip and dropdown already use).
 *
 * This module is the pure resolution + (de)serialisation logic; FilterBar
 * wires it to `useUserSettings` / `useUserSettingsMutation` (the same
 * per-user settings surface the board's column visibility uses, A26/BRD-4)
 * and to the view's own stored set.
 */

/** A stable id for a filter: a built-in facet key or `field.<customKey>`. */
export type FilterId = string;

/**
 * The built-in default visible set (K97: the primary built-ins). Used when
 * neither the active view nor the user has set one — additive and
 * migration-free, so an existing tracker with no stored set sees exactly
 * these four.
 */
export const BUILTIN_DEFAULT_VISIBLE: readonly FilterId[] = [
  "project",
  "status",
  "priority",
  "assignee",
];

/**
 * The per-user settings key holding the default visible-filter set, stored
 * in `settings.yaml` alongside `board_hidden_columns` (A26). Read
 * defensively: `UserSettingsSchema` is `.passthrough()`, so anything that
 * is not an array of strings means "unset" rather than a throw.
 */
export const VISIBLE_FILTERS_KEY = "list_visible_filters";

/** Reads the per-user default visible set, or `undefined` when unset. */
export function userVisibleFiltersOf(
  settings: UserSettings | undefined,
): readonly FilterId[] | undefined {
  const raw = (settings as Record<string, unknown> | undefined)?.[VISIBLE_FILTERS_KEY];
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((x): x is string => typeof x === "string");
  // An empty stored array is a real choice ("show nothing extra") and is
  // preserved; only a missing/malformed value falls through to the default.
  return ids;
}

/**
 * Returns the full settings object to PUT with the visible set updated.
 *
 * `PUT /api/user-settings` replaces the whole document — there is no
 * PATCH — so the other keys must be carried through, exactly as
 * `withHiddenColumns` does for the board (BRD-4).
 */
export function withUserVisibleFilters(
  settings: UserSettings,
  visible: readonly FilterId[],
): UserSettings {
  return { ...settings, [VISIBLE_FILTERS_KEY]: [...visible] } as UserSettings;
}

/**
 * The complete catalog of filters a workspace can show: the nine built-in
 * facets plus one entry per enum custom field. Ordered built-ins first,
 * then custom fields in config order — the order the "Add filter" picker
 * lists them and the order the toolbar renders the resolved set in.
 *
 * `group` lets the picker section built-ins from custom fields.
 */
export interface FilterCatalogEntry {
  readonly id: FilterId;
  readonly label: string;
  readonly group: "builtin" | "custom";
}

/**
 * All built-in facet ids in canonical order, with their labels. Kept
 * parallel to FilterBar's `FACET_LABELS` / `FACET_KEYS`; passed in rather
 * than imported to keep this module free of the component's React deps.
 */
export function buildFilterCatalog(
  builtins: readonly { readonly id: FacetKey; readonly label: string }[],
  workflow: WorkflowConfig | undefined,
): readonly FilterCatalogEntry[] {
  const builtinEntries: FilterCatalogEntry[] = builtins.map(b => ({
    id: b.id,
    label: b.label,
    group: "builtin",
  }));
  const customEntries: FilterCatalogEntry[] = (workflow?.custom_fields ?? [])
    // Only enum custom fields render a FilterFacet (matching FilterBar's
    // existing `cf.type === "enum" && cf.values` guard); the rest cannot be
    // faceted, so they are not offered.
    .filter(cf => cf.type === "enum" && cf.values && cf.values.length > 0)
    .map(cf => ({ id: `field.${cf.key}`, label: cf.label, group: "custom" as const }));
  return [...builtinEntries, ...customEntries];
}

/**
 * Resolves the visible-filter set per K97's chain:
 *   active view's set → per-user default → built-in default.
 *
 * The result is filtered to the catalog (an id for a since-removed custom
 * field is dropped rather than rendered as a broken dropdown) AND to the
 * hidden facets (a scoped route — the sprint detail — withholds `sprint`
 * regardless of what a stored set names). Ordering follows the catalog so
 * the toolbar is stable no matter what order ids were stored in.
 *
 * B2 (K121): a custom field is only judged "removed" once the workflow
 * has actually loaded. While it is loading or has failed, the catalog
 * has no custom entries at all, so dropping every `field.*` id would make
 * the user's custom filters vanish with no explanation. With
 * `customFieldsKnown` false, stored `field.*` ids are kept (after the
 * catalog entries, in stored order) and the toolbar renders them as
 * unavailable, the way a built-in facet degrades when its source fails.
 */
export function resolveVisibleFilters(input: {
  /** The active view's stored set, when the URL names a view that has one. */
  readonly viewSet?: readonly FilterId[] | undefined;
  /** The per-user default, when the user has set one. */
  readonly userSet?: readonly FilterId[] | undefined;
  /** The full catalog, for ordering + dropping stale ids. */
  readonly catalog: readonly FilterCatalogEntry[];
  /** Facets a scoped route withholds (never shown even if a set names them). */
  readonly hidden?: readonly FilterId[];
  /**
   * True once the workflow (the custom-field source) has loaded. Until
   * then a `field.*` id missing from the catalog is unknown, not removed.
   * Defaults to true, the pre-B2 behaviour.
   */
  readonly customFieldsKnown?: boolean;
}): readonly FilterId[] {
  const chosen: readonly FilterId[] =
    input.viewSet ?? input.userSet ?? BUILTIN_DEFAULT_VISIBLE;
  const hidden = new Set(input.hidden ?? []);
  const wanted = new Set(chosen);
  // Walk the catalog so the order is canonical and stale ids are dropped;
  // an id in `wanted` but absent from the catalog (a removed custom field)
  // simply never matches.
  const fromCatalog = input.catalog
    .filter(e => wanted.has(e.id) && !hidden.has(e.id))
    .map(e => e.id);
  if (input.customFieldsKnown !== false) return fromCatalog;
  const inCatalog = new Set(input.catalog.map(e => e.id));
  const unknownCustom = chosen.filter(
    id => id.startsWith("field.") && !inCatalog.has(id) && !hidden.has(id),
  );
  return [...fromCatalog, ...unknownCustom];
}

/**
 * The filters NOT currently visible — what the "Add filter" picker offers.
 * Catalog order, minus the visible set and any hidden facet.
 */
export function addableFilters(
  catalog: readonly FilterCatalogEntry[],
  visible: readonly FilterId[],
  hidden: readonly FilterId[] = [],
): readonly FilterCatalogEntry[] {
  const shown = new Set(visible);
  const off = new Set(hidden);
  return catalog.filter(e => !shown.has(e.id) && !off.has(e.id));
}
