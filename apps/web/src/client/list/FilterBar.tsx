import type { WorkflowConfig } from "@loctt/contracts";
// Per-file subpath, NOT the barrel: the barrel drags node:path into the
// browser bundle (A37).
import { filtersToSummary } from "@loctt/core/query/filters.js";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
  useViews,
} from "../api/hooks/sidebarData.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { ViewFormDialog } from "../settings/ViewFormDialog.tsx";
import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { Radio } from "../ui/Radio.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { TextField } from "../ui/TextField.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { AdvancedQuerySurface } from "./AdvancedQuerySurface.tsx";
import { buildFacetOptions, type FacetOptions } from "./facetOptions.ts";
import { FilterFacet, type FilterOption } from "./FilterFacet.tsx";
import { SaveViewDialog } from "./SaveViewDialog.tsx";
import {
  addableFilters,
  buildFilterCatalog,
  type FilterCatalogEntry,
  type FilterId,
  resolveVisibleFilters,
  userVisibleFiltersOf,
  withUserVisibleFilters,
} from "./visibleFilters.ts";

/**
 * The list view's filter bar (M1.3, redesigned per Ken's toolbar review
 * + K97). It owns the WHOLE toolbar row:
 *
 *  - **Left band — filters.** The *resolved visible-filter set* (K97),
 *    not every facet: a FilterFacet per visible built-in/custom-enum
 *    field, then a subtle "+ Add filter" affordance that opens a picker
 *    of every remaining filter. Below `sm` this band collapses into a
 *    single "Filters" button + bottom Sheet.
 *  - **Right band — view actions.** A clean, aligned cluster pinned to
 *    the top-right: "Save as view" as a star `IconButton`, plus a ⋯ on
 *    the one view that has extra rows for it (the board). These used to
 *    float in ListView's flex gutter, vertically centred in dead space
 *    and jumping as the chip row appeared; owning them here keeps them
 *    on the same baseline as the filters at one consistent control
 *    height. Refresh is gone (Q4) and so is Export (K30-web).
 *  - **Chip row.** The active filters as removable chips + "Clear all",
 *    below the toolbar.
 *
 * Advanced querying is folded into the filter system: there is no leading
 * "Advanced" pill. The builder is reached from the END of the Add-filter
 * menu ("Advanced query…") — one level in, not first — and opens the
 * visual {@link AdvancedQuerySurface} (builder-first; raw DSL is a
 * secondary toggle inside it).
 *
 * The URL is the single source of truth: every control reads its state
 * from the typed search params and writes back through `navigate`, so
 * back/forward and bookmarking work for free. Changing any filter resets
 * `page`.
 */

// `FacetOptions` moved to `./facetOptions.ts` (K102) so the saved-view
// dialog can offer the same options; re-exported here because the bar is
// still where callers reach for it.
export type { FacetOptions } from "./facetOptions.ts";

/** Filter facets backed by a fixed URL param + a data source. */
export type FacetKey =
  | "project" | "status" | "priority" | "type"
  | "assignee" | "reporter" | "labels" | "milestone" | "sprint";

const FACET_LABELS: Record<FacetKey, string> = {
  project: "Project",
  status: "Status",
  priority: "Priority",
  type: "Type",
  assignee: "Assignee",
  reporter: "Reporter",
  labels: "Label",
  milestone: "Milestone",
  sprint: "Sprint",
};

/**
 * Where the bar reads and writes its state, and which facets it may
 * offer.
 *
 * M4.7 (SPR-13) reuses this bar on `/sprints/$key`, which required
 * exactly two things to stop being hardcoded: the route the search
 * params belong to, and the ability to withhold one facet. Everything
 * else — the facet list, the option building, the chips, the clear-all
 * — is shared verbatim, which is what makes SPR-13's "no sprint-only
 * filter dialect" true by construction rather than by two
 * implementations agreeing for now.
 */
export interface FilterBarProps {
  /**
   * The route whose search params back the controls.
   *
   * `/board` and `/timeline` share the bar too (the cross-view scope
   * fix, Ken 2026-09-20): their search schemas are supersets of the
   * list's (BoardSearch === ListSearch; TimelineSearch extends it), so
   * every read the bar makes type-checks against all four, and every
   * write spreads `prev` so a view's private params (timeline
   * zoom/grouping/arrows, list page/sort/dir) survive a filter change.
   */
  readonly from?: "/list" | "/sprints/$key" | "/board" | "/timeline";
  /**
   * Facets to leave out. The sprint detail hides `sprint`: the page
   * *is* a sprint scope, and a control that could change or clear it
   * would let the user filter their way out of the route they are on.
   */
  readonly hiddenFacets?: readonly FacetKey[];
  /** Hidden where a saved view would not reproduce the scope. */
  readonly showSaveView?: boolean;
  /**
   * Extra rows for the ⋯ View-options menu, rendered as their own
   * "Configure" section.
   *
   * UI-3: the board used to carry a SECOND ⋯ menu in its PageHeader a
   * few pixels from this one, at a different size, holding its two
   * settings deep links — two identical-looking buttons whose contents
   * the user could not predict. This prop merges them into this one.
   *
   * It is a prop on the bar rather than a menu owned by `PageHeader`
   * because the bar owns the toolbar's right-hand action cluster, and
   * the board is the only view that had anything to merge: moving
   * ownership up to `PageHeader` would have added a menu to List,
   * Timeline, Sprints and Milestones to solve a Board-only problem.
   *
   * K30-web (Ken, 2026-09-23): with the web export gone, the board is
   * now the ONLY view that passes this — and therefore the only view
   * that renders a ⋯ at all. The menu is rendered only when it has
   * rows; see the cluster below.
   */
  readonly extraMenuSections?: ReactNode;
  /** Heading for `extraMenuSections`. Defaults to "Configure". */
  readonly extraMenuSectionLabel?: string;
}

export function FilterBar({
  from = "/list",
  hiddenFacets = [],
  showSaveView = true,
  extraMenuSections,
  extraMenuSectionLabel = "Configure",
}: FilterBarProps = {}) {
  const search = useSearch({ from });
  const navigate = useNavigate({ from });

  // VUE-8/10/11/31/32/33: the advanced DSL editor. Without this mount
  // the component was imported by nothing but its own test, so it was
  // tree-shaken out of the bundle entirely — `dsl-input` appeared zero
  // times in the built assets — while six blocker cases stayed green,
  // because every one of them was verified against the server API or
  // the unmounted module rather than the rendered page.
  const query = typeof (search as { q?: unknown }).q === "string"
    ? (search as { q: string }).q
    : "";
  // VUE-22: `?edit=1` opens the advanced editor pre-populated, so the
  // "fix this view" button on a broken saved view lands the malformed
  // query straight in the editor to repair in place.
  const openEditorRequested = (search as { edit?: unknown }).edit === true;
  const [advanced, setAdvanced] = useState(openEditorRequested);
  const [draft, setDraft] = useState(query);

  // K107 / Ken's ruling 2026-09-22 ("archiving is a one-way door, not a
  // filter"): the task list is a primary work surface, so it carries NO
  // archived-scope control — see the policy table in decisions.md § 9.
  // The capability is NOT removed: `?archived=` (K107) still reaches the
  // server exactly as before, it is simply no longer advertised by a
  // control here. `search.archived` flows straight into the tasks query
  // (see ListView), so a held/bookmarked `?archived=all` link keeps
  // working — this comment is the only trace of the control that used to
  // read/write it from this file.
  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const views = useViews();
  const workflow = useWorkflow();
  const userSettings = useUserSettings();
  const settingsMutation = useUserSettingsMutation();

  const [saveOpen, setSaveOpen] = useState(false);

  /**
   * Whether the ⋯ menu has anything to show.
   *
   * The `!== false` arm is not redundant: `extraMenuSections` is a
   * `ReactNode`, so a caller writing `extraMenuSections={cond && <X/>}`
   * passes `false` — a defined value that renders nothing. Without this
   * the trigger would open an empty panel, which is the exact failure
   * the "no empty menu" rule names.
   */
  const hasExtraMenu = extraMenuSections !== undefined
    && extraMenuSections !== false
    && extraMenuSections !== null;
  // K102: the active-view chip's Edit opens the shared view form dialog
  // seeded from the view's stored filters (it used to flatten the view
  // into `q=` and open the raw DSL editor — see `editActiveView`).
  const [editingView, setEditingView] = useState(false);
  // Below sm the facet band collapses into a single "Filters" button that
  // opens a bottom sheet (responsive plan GROUP B) — 9+ facet pills wrapping
  // into a column ate most of the screen before any task showed.
  const isNarrow = useIsNarrow();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // The "Add filter" picker Sheet on mobile (the desktop one is a Menu).
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  // ── Transient-UI reset on a filter switch ──────────────────────────
  //
  // The bar holds open-UI state that is NOT derived from the URL
  // (`advanced`, `draft`, and the two mobile sheets). When the user
  // switches which filter they are looking at — clicking saved filter B
  // in the sidebar while filter A is active, i.e. `search.view` or the
  // free-text `q` is replaced by a navigation — that transient UI is now
  // aimed at the wrong thing and must reset: the advanced editor closes,
  // its draft re-syncs to the new query, and any open sheet closes.
  //
  // The discriminator is "the user navigated to a DIFFERENT filter" vs
  // "the editor asked to open". The `?edit=1` path IS the editor opening
  // (the query chip's Edit, or a broken view's "Fix in editor") — it must
  // NOT be treated as a filter switch, or it would open then immediately
  // close itself. So `openEditorRequested` wins: when it is set, open the
  // editor from the URL query and strip `edit`; otherwise, when the
  // filter signature changed since the last render, reset.
  //
  // Keyed on the (view, q) pair — the "which filter am I looking at"
  // signature. The two parts are compared separately because they answer
  // two different questions:
  //   - `view` changing is UNAMBIGUOUSLY a switch to another saved
  //     filter/view (the sidebar sets `view=<id>`), or clearing one.
  //   - `q` changing is a switch ONLY when it did not come from the
  //     editor itself: applying a query from the OPEN editor writes `q`
  //     too, and that must NOT close the editor out from under the user.
  // So a `q` change counts as a switch only while the editor is closed (a
  // fresh q= navigation landing on the bar); a `q` change with the editor
  // open is an in-editor Apply and is left alone. A `view` change resets
  // regardless — that is always someone picking a different filter.
  // Facet/page/sort changes touch neither part, so the open editor
  // survives them.
  const viewSig = (search as { view?: string }).view ?? "";
  const filterSig = `${viewSig}\n${query}`;
  const lastViewSig = useRef(viewSig);
  const lastFilterSig = useRef(filterSig);
  // The last `q` the editor's own Apply wrote. A q= change is ambiguous by
  // URL alone: it is EITHER the editor applying (keep it open) OR a
  // navigation to a different filter from OUTSIDE the bar — the header
  // search writes `q` on /list too (Header `text ~ "…"`), and that IS a
  // switch. So the editor tags its own writes here, and the reset skips a
  // q change that matches the tag. Anything else that changes `q` (header
  // search, back/forward) is treated as a switch and closes the editor.
  const appliedByEditor = useRef<string | null>(null);
  useEffect(() => {
    if (openEditorRequested) {
      // The editor asked to open (query-chip Edit / broken-view fix).
      // Seed it from the URL query and clear the one-shot flag. Record
      // the signatures so the reset branch does not also fire for this
      // same navigation.
      lastViewSig.current = viewSig;
      lastFilterSig.current = filterSig;
      setDraft(query);
      setAdvanced(true);
      void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, edit: undefined }) });
      return;
    }
    const viewChanged = viewSig !== lastViewSig.current;
    const sigChanged = filterSig !== lastFilterSig.current;
    // An in-editor Apply is a `q` change (view unchanged) whose new value
    // is exactly what the editor just wrote — not a switch.
    const isOwnApply = !viewChanged && sigChanged && appliedByEditor.current === query;
    if (query !== appliedByEditor.current) appliedByEditor.current = null;
    const isSwitch = sigChanged && !isOwnApply;
    lastViewSig.current = viewSig;
    lastFilterSig.current = filterSig;
    if (isSwitch) {
      // A genuine switch to a different filter/view. Reset the transient
      // UI: close the editor, re-sync the draft to the new filter's query,
      // and close any open picker sheet/dialog.
      setAdvanced(false);
      setDraft(query);
      setAddSheetOpen(false);
      setFilterSheetOpen(false);
      setSaveOpen(false);
      setEditingView(false);
    }
  }, [openEditorRequested, viewSig, filterSig, query, navigate]);

  const options = useMemo(
    () =>
      buildFacetOptions({
        projects: projects.data?.items ?? [],
        users: users.data?.items ?? [],
        labels: labels.data?.items ?? [],
        milestones: milestones.data?.items ?? [],
        sprints: sprints.data?.items ?? [],
        workflow: workflow.data,
      }),
    [projects.data, users.data, labels.data, milestones.data, sprints.data, workflow.data],
  );

  const customFields = workflow.data?.custom_fields ?? [];

  // Which facets have no options because their source failed, rather
  // than because there are none (F4). Keyed the same way the dropdowns
  // are, so a new facet cannot silently miss out.
  const failedFacets = new Set<FacetKey>([
    ...(projects.isError ? (["project"] as const) : []),
    ...(users.isError ? (["assignee", "reporter"] as const) : []),
    ...(labels.isError ? (["labels"] as const) : []),
    ...(milestones.isError ? (["milestone"] as const) : []),
    ...(sprints.isError ? (["sprint"] as const) : []),
    ...(workflow.isError ? (["status", "priority", "type"] as const) : []),
  ]);

  // LST-33: which facets have SUCCESSFULLY loaded their options. A chip
  // may only be judged "dangling" (its value names a since-deleted
  // entity) once its source has actually loaded — otherwise a valid chip
  // renders as "no longer exists" during the load window, and stays that
  // way forever if the source errors. This mirrors `failedFacets` above:
  // "option not found" must not conflate loading, network failure, and
  // true deletion. Only `isSuccess` proves the option set is authoritative.
  const loadedFacets = new Set<FacetKey>([
    ...(projects.isSuccess ? (["project"] as const) : []),
    ...(users.isSuccess ? (["assignee", "reporter"] as const) : []),
    ...(labels.isSuccess ? (["labels"] as const) : []),
    ...(milestones.isSuccess ? (["milestone"] as const) : []),
    ...(sprints.isSuccess ? (["sprint"] as const) : []),
    ...(workflow.isSuccess ? (["status", "priority", "type"] as const) : []),
  ]);

  const setFilter = (key: string, next: string[]): void => {
    void navigate({
      search: prev => ({ ...prev, [key]: next.length > 0 ? next : undefined, page: undefined }),
    });
  };

  const facetOf = (key: FacetKey): readonly string[] =>
    (search[key] as readonly string[] | undefined) ?? [];

  const customFilters = readCustomFilters(search);

  // ── Configurable visible-filter set (K97) ──────────────────────────
  //
  // The catalog is every filter the workspace can show; the resolved set
  // is what the toolbar actually renders. Resolution chain:
  //   active view's set (URL `vf`) → per-user default → built-in default.
  // `vf` is a comma-separated FilterId list carried in the URL (source of
  // truth, .passthrough()) — a saved view stores it in its params like
  // any other filter, and it stays transient for a bare /list unless the
  // user saves it into a view or promotes it to their default.
  const catalog = useMemo(
    () =>
      buildFilterCatalog(
        (Object.keys(FACET_LABELS) as FacetKey[]).map(id => ({ id, label: FACET_LABELS[id] })),
        workflow.data,
      ),
    [workflow.data],
  );

  const viewSet = readVisibleFilterParam(search);
  const userSet = userVisibleFiltersOf(userSettings.data?.settings);
  // Both sets are derived from their source each render (a fresh array
  // identity every time), so the memo keys on their stable string forms —
  // extracted to locals so the dependency array stays statically checkable.
  const viewSetKey = viewSet?.join(",");
  const userSetKey = userSet?.join(",");
  const visibleFilters = useMemo(
    () =>
      resolveVisibleFilters({
        viewSet,
        userSet,
        catalog,
        hidden: hiddenFacets,
      }),
    // viewSet/userSet are keyed by their serialized forms (viewSetKey/
    // userSetKey); depending on the arrays directly would defeat the memo
    // (a new identity every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewSetKey, userSetKey, catalog, hiddenFacets],
  );

  const addable = addableFilters(catalog, visibleFilters, hiddenFacets);

  // Adding/removing a visible filter writes the resolved set into `vf`,
  // making the transient toolbar state explicit in the URL. Removing a
  // filter also clears any active value on it, so hiding a filter never
  // leaves an invisible, still-applied constraint (which would be an
  // un-removable filter with no chip to reverse it — the exact "filtered
  // for no visible reason" trap LST-53 fixed for `q=`).
  const setVisible = (next: readonly FilterId[]): void => {
    void navigate({
      search: prev => ({ ...prev, vf: next.length > 0 ? next.join(",") : undefined }),
    });
  };

  const addFilter = (id: FilterId): void => {
    setVisible([...visibleFilters, id]);
    setAddSheetOpen(false);
  };

  const removeFilter = (id: FilterId): void => {
    void navigate({
      search: prev => {
        const next: Record<string, unknown> = { ...prev };
        const kept = visibleFilters.filter(v => v !== id);
        next.vf = kept.length > 0 ? kept.join(",") : undefined;
        // Clear the removed filter's active value(s) too.
        next[id] = undefined;
        next.page = undefined;
        return next;
      },
    });
  };

  // K97: promote the current visible set to the per-user default for the
  // bare /list, via an explicit action in the Add-filter menu. Merges into
  // the whole settings doc (PUT replaces it) exactly as the board's column
  // visibility does.
  const saveAsDefault = (): void => {
    const current = userSettings.data?.settings ?? ({} as NonNullable<typeof userSettings.data>["settings"]);
    settingsMutation.mutate(withUserVisibleFilters(current, visibleFilters));
  };

  const activeChips = buildChips(search, options, customFields, loadedFacets, workflow.isSuccess)
    // A chip for a hidden facet would carry a ✕ that removes the very
    // scope the route is defined by.
    .filter(chip => !hiddenFacets.includes(chip.key as FacetKey));

  const clearAll = (): void => { void navigate({ search: clearedSearch }); };

  // LST-53 (UX-1): a free-text `q=` query is a filter too — every sidebar
  // saved filter lands the user on a `q=` URL — but it produced no chip,
  // so a short list had no visible reason and no in-page way back. It now
  // renders its own removable chip alongside the facet chips, and its
  // presence lights up the same "Clear all" affordance, matching how the
  // facet chips already explain and reverse a filtered view.
  const hasQuery = query.trim().length > 0;

  const clearQuery = (): void => {
    void navigate({
      search: prev => ({ ...prev, q: undefined, view: undefined, page: undefined }),
    });
  };

  // A `q=` DSL carries raw entity ids — `assignee = "01M2VY..."` — which
  // mean nothing to a person reading the chip (UX eval #6). Resolve any
  // quoted id in the query to its display name for the PREVIEW only; the
  // real query (and the Advanced editor) keep the ids. Covers users
  // (assignee/reporter/mentions), labels, milestones and sprints.
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users.data?.items ?? []) m.set(u.id, u.name ?? u.id);
    for (const l of labels.data?.items ?? []) m.set(l.id, l.name);
    for (const ms of milestones.data?.items ?? []) m.set(ms.id, ms.name);
    for (const sp of sprints.data?.items ?? []) m.set(sp.id, sp.name);
    return m;
  }, [users.data, labels.data, milestones.data, sprints.data]);

  const humanized = query.replace(/"([^"]+)"/g, (whole, id: string) => {
    const name = idToName.get(id);
    return name !== undefined ? `"${name}"` : whole;
  });

  // A truncated preview keeps the chip informative (which query is
  // running) without letting a long DSL expression blow out the row; the
  // full text is on the chip's title and in the Advanced editor.
  const queryPreview = humanized.length > 32 ? `${humanized.slice(0, 31)}…` : humanized;

  // A valid saved view is active (`?view=<id>`) and its query is resolved
  // SERVER-side, so the toolbar showed a filtered list with no facet chip
  // and no query text — the same "filtered for no visible reason" trap
  // LST-53 closed for `q=`, latent for saved views. Surface it as its own
  // chip: named, editable, clearable. Resolution is client-side against
  // the loaded `queries.yaml` (useViews); an id that does not resolve to a
  // present, non-broken query renders NO chip — ListView's `missingView`
  // and `brokenView` banners already own those two cases, and duplicating
  // them here would double the message.
  const activeViewId = typeof (search as { view?: unknown }).view === "string"
    ? (search as { view: string }).view
    : undefined;
  const activeView = activeViewId === undefined
    ? undefined
    : (views.data?.queries ?? []).find(v => v.id === activeViewId);
  const hasActiveView = activeView !== undefined;
  // What the view matches, for the chip. K102: a view stores an ORDERED
  // filter list and no derived query string, so this is the shared
  // display-only summary — computed here, never persisted, never parsed
  // back. The preview truncates to the same ~32-char budget as the q=
  // chip, with the full text on the chip's title.
  const viewSummary = activeView === undefined ? "" : filtersToSummary(activeView.filters);
  const viewSummaryPreview =
    viewSummary.length > 32 ? `${viewSummary.slice(0, 31)}…` : viewSummary;

  // Editing a saved view opens the SAME view form dialog Settings and the
  // sidebar use, seeded from the view's stored filters.
  //
  // It used to flatten the view into `q=<its query>` and open the raw DSL
  // editor. K102 removed the thing that made that possible — a view has no
  // single query string any more — and it was the behaviour Ken struck
  // out: a view built from dropdowns must reopen as dropdowns, not as DSL.
  const editActiveView = (): void => { setEditingView(true); };

  // Clearing the active view returns to all tasks, mirroring `clearQuery`.
  const clearActiveView = (): void => {
    void navigate({
      search: prev => ({ ...prev, view: undefined, page: undefined }),
    });
  };

  const hasActive = activeChips.length > 0 || hasQuery || hasActiveView;

  const openAdvanced = (): void => { setDraft(query); setAdvanced(true); setAddSheetOpen(false); };

  if (advanced) {
    return (
      <AdvancedQuerySurface
        query={query}
        draft={draft}
        onDraftChange={setDraft}
        // K83-ii: applying writes ONLY `q`, leaving every facet chip
        // param untouched, so q + chips compose as intersection in the
        // URL (LST-40). An empty query removes the `q` param (LST-41).
        onApply={(q: string) => {
          // Tag this as the editor's own write so the transient-reset
          // effect does not mistake the resulting `q` change for a switch
          // to a different filter and close the editor (see appliedByEditor).
          appliedByEditor.current = q.trim().length > 0 ? q : "";
          void navigate({
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              q: q.trim().length > 0 ? q : undefined,
            }),
          });
        }}
        onSwitchToBasic={(next: Record<string, unknown>) => {
          setAdvanced(false);
          void navigate({ search: () => next });
        }}
        onClose={() => { setAdvanced(false); }}
        workflow={workflow.data}
        projects={(projects.data?.items ?? []).map(p => ({ value: p.id, label: p.name }))}
        users={(users.data?.items ?? []).map(u => ({ value: u.id, label: u.name ?? u.id }))}
        labels={(labels.data?.items ?? []).map(l => ({ value: l.id, label: l.name }))}
        milestones={(milestones.data?.items ?? []).map(m => ({ value: m.id, label: m.name }))}
        sprints={(sprints.data?.items ?? []).map(s => ({ value: s.id, label: s.name }))}
      />
    );
  }

  // The number of active facet filters (the chip count, excluding the
  // free-text query) — the badge on the mobile "Filters" button.
  const activeFacetCount = activeChips.length;

  // One dropdown for a resolved-visible filter id, be it a built-in facet
  // or a `field.<key>` custom enum. Extracted so it renders identically
  // inline (desktop) and inside the mobile filter Sheet — both call the
  // same setFilter/navigate writes, so state never forks.
  const renderFilterControl = (id: FilterId) => {
    if (!id.startsWith("field.")) {
      const key = id as FacetKey;
      return (
        <FilterFacet
          key={key}
          label={FACET_LABELS[key]}
          options={options[key]}
          unavailable={failedFacets.has(key)}
          selected={facetOf(key)}
          onChange={next => setFilter(key, next)}
          onRemove={() => { removeFilter(key); }}
          // LST-40/MSL-7: labels are set-valued, so 2+ selected can mean
          // "has all of these" or "has any". Offer the choice inline
          // once it matters; other facets are scalar and OR is the only
          // sensible reading.
          {...(key === "labels" && facetOf("labels").length >= 2
            ? { matchToggle: (
                <LabelsMatchToggle
                  value={search.labels_match ?? "any"}
                  onChange={mode => void navigate({
                    search: prev => ({
                      ...prev,
                      labels_match: mode === "all" ? "all" : undefined,
                      page: undefined,
                    }),
                  })}
                />
              ) }
            : {})}
        />
      );
    }
    const cfKey = id.slice("field.".length);
    const cf = customFields.find(c => c.key === cfKey);
    if (cf === undefined || cf.type !== "enum" || !cf.values || cf.values.length === 0) return null;
    return (
      <FilterFacet
        key={cf.key}
        label={cf.label}
        options={cf.values.map(v => ({ value: v.key, label: v.label }))}
        selected={customFilters[cf.key] ?? []}
        onChange={next => setFilter(`field.${cf.key}`, next)}
        onRemove={() => { removeFilter(`field.${cf.key}`); }}
      />
    );
  };

  const facetControls = (
    <>{visibleFilters.map(renderFilterControl)}</>
  );

  // The desktop "+ Add filter" affordance: a Menu listing every addable
  // filter (grouped built-in / custom, searchable when long), with the
  // "Advanced query…" escape hatch and "Save as default" at the end.
  const addFilterMenu = (
    <Menu
      align="start"
      aria-label="Add filter"
      trigger={({ toggle, ...aria }) => (
        <Button
          variant="ghost"
          size="md"
          testId="add-filter"
          onClick={toggle}
          {...aria}
        >
          <Icon name="plus" size={14} />
          Add filter
        </Button>
      )}
    >
      {({ close }) => (
        <AddFilterPanel
          addable={addable}
          onAdd={id => { addFilter(id); close(); }}
          onOpenAdvanced={() => { openAdvanced(); close(); }}
          onSaveDefault={from === "/list" ? () => { saveAsDefault(); close(); } : undefined}
        />
      )}
    </Menu>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar: a single row split into two bands — filters (left),
          view actions (right). `flex-wrap` + `min-w-0` lets the filter
          band wrap while the action cluster stays pinned right until
          there is no room, then drops below. One control height (h-8)
          across every band. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* Left band — filters. Inline at >= sm; collapsed into a
            "Filters" button + bottom sheet below sm (GROUP B). The same
            controls render in both, so they write the same search params
            either way. */}
        {!isNarrow && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {facetControls}
            {/* The Add-filter affordance leads nothing: it sits at the
                END of the filter row, subtle (ghost), one level in. */}
            {addFilterMenu}
          </div>
        )}

        {isNarrow && (
          <Button
            variant="secondary"
            testId="filters-open"
            onClick={() => { setFilterSheetOpen(true); }}
          >
            <Icon name="search" size={14} className="text-text-tertiary" />
            Filters
            {activeFacetCount > 0 && (
              <span
                data-testid="filters-active-count"
                className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7857rem] font-medium text-accent-contrast"
              >
                {activeFacetCount}
              </span>
            )}
          </Button>
        )}

        <div className="flex-1" />

        {/* Right band — view actions (Ken's toolbar review, U23). No
            manual refresh (Q4): freshness is TanStack Query staleTime +
            focus refetch.

            **Shape, after the web export was removed (K30-web, Ken
            2026-09-23).** UI-2 had built this as a single ⋯ menu whose
            order was create → act → configure:

              1. Save as view  (create)
              2. Export CSV / Export JSON  (act)
              3. `extraMenuSections`  (configure — the board's deep links)

            Dropping the export deleted the whole "act" section, which
            left list and timeline with a popover containing ONE row.
            A menu is a disclosure for a set; for a single action it is
            two clicks, a portal and roving-focus machinery to reach one
            thing. So:

            - **"Save as view" is a direct `IconButton`** (star — the
              same glyph the sidebar marks saved views with) on EVERY
              view that offers it. Ken's steer, 2026-09-23.
            - **The ⋯ renders only when it has rows**, i.e. only when
              `extraMenuSections` is passed. Today that is the board
              alone. A trigger that opens an empty panel is worse than
              no trigger, and the sprint detail (`showSaveView={false}`,
              no extra sections) would otherwise render exactly that.

            The star sits in the same slot on all four task views, so
            the action does not move between views — the board simply
            has a ⋯ *beside* it for its two config deep links. That is
            the consistency UI-3 was protecting; what varies is the
            presence of a second, differently-labelled control, which
            was already true.

            Tooltip is the native `title` (plus the `aria-label`
            `IconButton` requires). Its ~1s delay is UI-23e's open item,
            not this control's — no custom tooltip primitive was built
            here.

            On mobile these live in the filters Sheet instead, so this
            cluster is desktop-only. */}
        {!isNarrow && (showSaveView || hasExtraMenu) && (
          <div className="flex items-center gap-2" data-testid="view-actions">
            {showSaveView && (
              // UI-23e: a real tooltip, not `title`. This is the control
              // that motivated the primitive — icon-only, so its name is
              // invisible, and `title`'s ~1s delay never showed on
              // keyboard focus at all. The bubble repeats the
              // `aria-label`, so it stays `aria-hidden` (no `describes`)
              // and is not announced twice.
              <Tooltip label="Save as view" testId="view-actions-save-view-tip">
                <IconButton
                  variant="secondary"
                  // `sm` (24.5px), matching the board's "+ Add task" and
                  // the ⋯ beside it.
                  size="sm"
                  aria-label="Save as view"
                  testId="view-actions-save-view"
                  onClick={() => { setSaveOpen(true); }}
                >
                  <Icon name="star" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {hasExtraMenu && (
              <Menu
                align="end"
                aria-label="View options"
                trigger={({ toggle, ...aria }) => (
                  <Tooltip label="View options" testId="view-actions-menu-tip">
                    <IconButton
                      variant="secondary"
                      size="sm"
                      aria-label="View options"
                      testId="view-actions-menu"
                      onClick={toggle}
                      {...aria}
                    >
                      <Icon name="more" size={16} />
                    </IconButton>
                  </Tooltip>
                )}
              >
                {() => (
                  <div data-testid="view-actions-extra-section">
                    <p className="px-3 py-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
                      {extraMenuSectionLabel}
                    </p>
                    {extraMenuSections}
                  </div>
                )}
              </Menu>
            )}
          </div>
        )}
      </div>

      {isNarrow && filterSheetOpen && (
        <Sheet
          title="Filters"
          testId="filters-sheet"
          onClose={() => { setFilterSheetOpen(false); }}
          footer={
            <div className="flex items-center justify-between">
              <button
                type="button"
                data-testid="filters-sheet-clear"
                disabled={!hasActive}
                onClick={() => { void navigate({ search: () => ({}) }); }}
                className="text-[0.9286rem] text-text-secondary underline-offset-2 hover:underline disabled:opacity-40"
              >
                Clear all
              </button>
              <Button size="md" onClick={() => { setFilterSheetOpen(false); }}>
                Done
              </Button>
            </div>
          }
        >
          {/* Same facet controls as desktop, stacked full-width. Changes
              apply live (they write search params) — the list behind the
              sheet updates as on desktop. */}
          <div className="flex flex-col gap-2 [&_button]:w-full">
            {facetControls}
            {addable.length > 0 && (
              <Button
                variant="ghost"
                size="md"
                testId="add-filter-mobile"
                onClick={() => { setAddSheetOpen(true); }}
              >
                <Icon name="plus" size={14} />
                Add filter
              </Button>
            )}
            <Button variant="ghost" size="md" testId="advanced-open-mobile" onClick={openAdvanced}>
              Advanced query…
            </Button>
            {showSaveView && (
              <Button size="md" onClick={() => { setFilterSheetOpen(false); setSaveOpen(true); }}>
                <Icon name="star" size={14} />
                Save as view
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {/* The Add-filter picker as a Sheet on mobile — the same content the
          desktop Menu shows, reusing the sanctioned mobile overlay (K97:
          unify popover-on-desktop / Sheet-on-mobile). */}
      {isNarrow && addSheetOpen && (
        <Sheet
          title="Add filter"
          testId="add-filter-sheet"
          onClose={() => { setAddSheetOpen(false); }}
        >
          <AddFilterPanel
            addable={addable}
            onAdd={addFilter}
            onOpenAdvanced={openAdvanced}
            onSaveDefault={from === "/list" ? saveAsDefault : undefined}
          />
        </Sheet>
      )}

      {hasActive ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasActiveView ? (
            // The active saved view as a removable chip, styled like the
            // q= query chip (LST-53) — accent-muted, NOT font-mono (K98:
            // mono is code/CLI only). Its label is a BUTTON that opens the
            // view form dialog seeded from the view's stored filters, so
            // a view is editable from where it's shown; the full summary is
            // on the title so the truncated preview can be read on hover.
            <span
              data-testid="active-view-chip"
              className="inline-flex items-center gap-1 rounded bg-accent-muted px-2 py-0.5 text-[0.8571rem] text-accent"
            >
              {/* UI-23e: `describes` is ON here, unlike the icon-only
                  buttons above. The bubble carries the full filter
                  summary, which the `aria-label` ("Edit view <name>")
                  does NOT contain and the visible chip truncates — so it
                  is real added information, not a repeat of the name,
                  and a screen reader should get it as a description. */}
              <Tooltip
                label={`Edit view "${activeView.name}": ${viewSummary}`}
                describes
                testId="active-view-chip-edit-tip"
              >
              <button
                type="button"
                data-testid="active-view-chip-edit"
                aria-label={`Edit view ${activeView.name}`}
                onClick={editActiveView}
                className="inline-flex cursor-pointer items-center gap-1 hover:underline"
              >
                <span className="text-accent/70">View:</span>
                <span>{activeView.name}</span>
                {viewSummary !== "" ? (
                  <span className="max-w-[24ch] truncate text-accent/70">{viewSummaryPreview}</span>
                ) : null}
              </button>
              </Tooltip>
              <button
                type="button"
                aria-label="Clear active view"
                onClick={clearActiveView}
                className="ml-0.5 cursor-pointer text-accent/70 hover:text-accent"
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ) : null}
          {hasQuery ? (
            // LST-53: the active free-text query as a removable chip. Its
            // ✕ clears just `q` (and the saved-view id it may have come
            // from); "Clear all" below wipes everything.
            <span
              data-testid="query-chip"
              className="inline-flex items-center gap-1 rounded bg-accent-muted px-2 py-0.5 text-[0.8571rem] text-accent"
            >
              {/* The query text is a BUTTON that opens the advanced editor
                  pre-loaded with this query — so a query filter is editable
                  from where it's shown, not only removable (Ken). The full
                  query is on the title so a truncated preview can be read on
                  hover; the visible text is the truncated, id-humanized
                  preview. */}
              <button
                type="button"
                data-testid="query-chip-edit"
                title={`Edit query: ${humanized}`}
                aria-label={`Edit query: ${humanized}`}
                onClick={openAdvanced}
                className="inline-flex cursor-pointer items-center gap-1 hover:underline"
              >
                <span className="text-accent/70">Query:</span>
                <span className="max-w-[24ch] truncate">{queryPreview}</span>
              </button>
              <button
                type="button"
                aria-label="Remove query filter"
                onClick={clearQuery}
                className="ml-0.5 cursor-pointer text-accent/70 hover:text-accent"
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ) : null}
          {activeChips.map(chip => {
            const removeButton = (extraClass: string) => (
              <button
                type="button"
                aria-label={`Remove ${chip.facetLabel} ${
                  chip.dangling === true ? chip.value : chip.label
                }`}
                onClick={() => {
                  const current = chipValues(search, chip.key);
                  const next = current.filter(v => v !== chip.value);
                  void navigate({
                    search: prev => ({
                      ...prev,
                      [chip.key]: next.length > 0 ? next : undefined,
                      page: undefined,
                    }),
                  });
                }}
                className={`ml-0.5 cursor-pointer ${extraClass}`}
              >
                <Icon name="close" size={12} />
              </button>
            );
            // LST-33: a dangling reference reads as "gone", not as a
            // normal filter. Warning-toned, the id truncated as a
            // diagnostic tail (matching cells.tsx's deleted-user form),
            // and it says "no longer exists" so an empty result is not
            // mistaken for a valid-but-empty filter. Still removable.
            if (chip.dangling === true) {
              return (
                <span
                  key={`${chip.key}:${chip.value}`}
                  title={`No ${chip.facetLabel.toLowerCase()} matches ${chip.value}`}
                  className="inline-flex items-center gap-1 rounded bg-warn-bg px-2 py-0.5 text-[0.8571rem] text-warn-fg"
                >
                  <span className="opacity-80">{chip.facetLabel}:</span>
                  <code>{chip.value.slice(-6)}</code>
                  <span className="italic">(no longer exists)</span>
                  {removeButton("text-warn-fg/70 hover:text-warn-fg")}
                </span>
              );
            }
            return (
              <span
                key={`${chip.key}:${chip.value}`}
                className="inline-flex items-center gap-1 rounded bg-accent-muted px-2 py-0.5 text-[0.8571rem] text-accent"
              >
                <span className="text-accent/70">{chip.facetLabel}:</span>
                {chip.label}
                {removeButton("text-accent/70 hover:text-accent")}
              </span>
            );
          })}
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      ) : null}

      {saveOpen ? <SaveViewDialog search={search} onClose={() => setSaveOpen(false)} /> : null}
      {editingView && activeView !== undefined ? (
        <ViewFormDialog existing={activeView} onClose={() => { setEditingView(false); }} />
      ) : null}
    </div>
  );
}

/**
 * The Add-filter picker's body, shared by the desktop Menu panel and the
 * mobile Sheet (K97: one pattern, two shells). Lists every addable filter
 * grouped built-in / custom, searchable when long, then the "Advanced
 * query…" escape hatch and (on /list) "Save as default".
 */
function AddFilterPanel({
  addable,
  onAdd,
  onOpenAdvanced,
  onSaveDefault,
}: {
  readonly addable: readonly FilterCatalogEntry[];
  readonly onAdd: (id: FilterId) => void;
  readonly onOpenAdvanced: () => void;
  readonly onSaveDefault?: (() => void) | undefined;
}) {
  const [filter, setFilter] = useState("");
  // Search once the list is long enough to scan-hunt (same threshold feel
  // as the facet's typeahead).
  const searchable = addable.length >= 8;
  const q = filter.trim().toLowerCase();
  const shown = searchable && q !== ""
    ? addable.filter(e => e.label.toLowerCase().includes(q))
    : addable;

  const builtins = shown.filter(e => e.group === "builtin");
  const customs = shown.filter(e => e.group === "custom");

  const section = (title: string, entries: readonly FilterCatalogEntry[]) =>
    entries.length === 0 ? null : (
      <div className="py-1">
        <p className="px-3 py-1 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">{title}</p>
        {entries.map(e => (
          <MenuItem key={e.id} testId={`add-filter-${e.id}`} onSelect={() => { onAdd(e.id); }}>
            {e.label}
          </MenuItem>
        ))}
      </div>
    );

  return (
    <div data-testid="add-filter-panel" className="min-w-[220px]">
      {searchable && (
        <div className="border-b border-border-subtle p-1.5">
          <TextField
            type="search"
            size="sm"
            aria-label="Search filters"
            placeholder="Search filters…"
            value={filter}
            onChange={e => { setFilter(e.target.value); }}
          />
        </div>
      )}

      {addable.length === 0 ? (
        <p className="px-3 py-2 text-[0.8571rem] italic text-text-tertiary">
          Every filter is already shown.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-2 text-[0.8571rem] italic text-text-tertiary">No filters match.</p>
      ) : (
        <>
          {section("Built-in", builtins)}
          {section("Custom fields", customs)}
        </>
      )}

      <div className="border-t border-border-subtle py-1">
        <MenuItem testId="advanced-open" onSelect={onOpenAdvanced}>
          <Icon name="settings" size={14} className="text-text-tertiary" />
          Advanced query…
        </MenuItem>
        {onSaveDefault !== undefined && (
          <MenuItem testId="save-default-filters" onSelect={onSaveDefault}>
            <Icon name="star" size={14} className="text-text-tertiary" />
            Save these as my default
          </MenuItem>
        )}
      </div>
    </div>
  );
}

/**
 * Reads the `vf` visible-filter param (comma-separated FilterIds) from the
 * URL. Returns `undefined` when absent so resolution falls through to the
 * per-user default; an explicit empty value ("show nothing extra") is
 * preserved as an empty array.
 */
function readVisibleFilterParam(search: Partial<ListSearch>): readonly FilterId[] | undefined {
  const raw = (search as Record<string, unknown>).vf;
  if (typeof raw === "string") {
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  return undefined;
}

/**
 * Drops every filter from the URL search, leaving sort and columns.
 *
 * Exported because LST-8 puts a "Clear filters" action in the *empty
 * state* as well as the chip row: a filter that matches nothing has to
 * offer a way out from where the user is looking. Two copies of this
 * would drift the moment a facet is added.
 */
export function clearedSearch<T extends Record<string, unknown>>(prev: T): T {
  const next: Record<string, unknown> = { ...prev };
  for (const k of [...FACET_KEYS, "q", "page"]) next[k] = undefined;
  for (const k of Object.keys(next)) if (k.startsWith("field.")) next[k] = undefined;
  return next as T;
}

const FACET_KEYS: readonly FacetKey[] = [
  "project", "status", "priority", "type", "assignee", "reporter", "labels", "milestone", "sprint",
];

function readCustomFilters(search: Partial<ListSearch>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(search)) {
    if (k.startsWith("field.")) {
      const key = k.slice("field.".length);
      out[key] = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? v.split(",") : [];
    }
  }
  return out;
}

interface Chip {
  key: string; // URL param key (facet key or `field.<key>`)
  facetLabel: string;
  value: string;
  label: string;
  /**
   * LST-33: the filter value names an entity the tracker no longer has
   * (a since-deleted milestone/user/label). The chip must SAY so rather
   * than render the raw ULID as a normal-looking label — a bare id reads
   * as an ordinary filter that just happens to match nothing, which is
   * indistinguishable from a valid entity with no tasks. Mirrors the
   * "(deleted user)" treatment in cells.tsx (K21/K22): the id is the only
   * remaining handle on the broken referent, so we keep a truncated form
   * as diagnostic, not as vocabulary.
   */
  dangling?: boolean;
}

// Exported for unit test: the dangling-vs-loading logic (LST-33) is a
// pure function of (value, options, load-state) and is the exact place
// the loading-race regression lives — asserting it directly is more
// robust than waiting one out through the rendered page.
export function buildChips(
  search: Partial<ListSearch>,
  options: FacetOptions,
  customFields: WorkflowConfig["custom_fields"],
  // LST-33: the facets whose option source has SUCCESSFULLY loaded. A
  // value is only judged dangling for a facet in this set (see `resolve`).
  loadedFacets: ReadonlySet<FacetKey>,
  // Custom-field options come from the workflow config; this is its
  // successful-load flag, gating dangling detection for `field.*` chips.
  customFieldsLoaded: boolean,
): Chip[] {
  const chips: Chip[] = [];
  // Resolve a value to its human label; when nothing matches AND the
  // facet's source has successfully loaded, the value is a dangling
  // reference (LST-33) — the caller marks the chip so the UI can say
  // "no longer exists" instead of showing the raw id. When the source
  // has NOT loaded (still fetching, or errored), a miss means "unknown
  // yet", not "deleted": fall back to the raw value with no dangling
  // marker so a valid chip never flashes as gone.
  const resolve = (
    opts: readonly FilterOption[],
    value: string,
    loaded: boolean,
  ): { label: string; dangling: boolean } => {
    const hit = opts.find(o => o.value === value);
    if (hit) return { label: hit.label, dangling: false };
    return { label: value, dangling: loaded };
  };

  for (const key of FACET_KEYS) {
    for (const value of search[key] ?? []) {
      const { label, dangling } = resolve(options[key], value, loadedFacets.has(key));
      chips.push({ key, facetLabel: FACET_LABELS[key], value, label, dangling });
    }
  }
  const custom = readCustomFilters(search);
  for (const cf of customFields) {
    for (const value of custom[cf.key] ?? []) {
      const hit = cf.values?.find(v => v.key === value);
      chips.push({
        key: `field.${cf.key}`,
        facetLabel: cf.label,
        value,
        label: hit?.label ?? value,
        // Custom-field options ride the workflow config; only judge a
        // custom-field value dangling once that config has loaded.
        dangling: customFieldsLoaded && hit === undefined,
      });
    }
  }
  return chips;
}

/** Current values for a chip's URL key (facet array or custom field). */
function chipValues(search: Partial<ListSearch>, key: string): string[] {
  if (key.startsWith("field.")) {
    return readCustomFilters(search)[key.slice("field.".length)] ?? [];
  }
  const v: unknown = (search as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * LST-40/MSL-7: the All/Any choice for a multi-label filter. "All" means
 * a task must carry every selected label (AND); "Any" means any of them
 * (OR, the default). Two radios rather than a checkbox so both states are
 * named — a bare "match all" checkbox leaves "off" ambiguous.
 */
function LabelsMatchToggle({
  value,
  onChange,
}: {
  readonly value: "all" | "any";
  readonly onChange: (mode: "all" | "any") => void;
}) {
  return (
    <fieldset className="flex items-center gap-3 text-[0.8571rem] text-text-secondary">
      <legend className="sr-only">Match</legend>
      <span className="text-text-tertiary">Match</span>
      {(["any", "all"] as const).map(mode => (
        <label key={mode} className="inline-flex items-center gap-1">
          <Radio
            name="labels-match"
            data-testid={`labels-match-${mode}`}
            checked={value === mode}
            onChange={() => { onChange(mode); }}
          />
          {mode === "any" ? "Any" : "All"}
        </label>
      ))}
    </fieldset>
  );
}
