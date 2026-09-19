import type { WorkflowConfig } from "@loctt/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import type { ListSearch } from "../router/listSearch.ts";
import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ICON } from "../ui/icons.ts";
import { Sheet } from "../ui/Sheet.tsx";
import { ToolbarButton } from "../ui/ToolbarButton.tsx";
import { AdvancedQuerySurface } from "./AdvancedQuerySurface.tsx";
import { FilterDropdown, type FilterOption } from "./FilterDropdown.tsx";
import { SaveViewDialog } from "./SaveViewDialog.tsx";

/**
 * The list view's filter bar (M1.3). Renders a dropdown per facet
 * (Project, Status, Priority, Type, Assignee, Label, Milestone, Sprint,
 * plus any workflow custom fields), the active filters as removable
 * chips, a "Show archived" toggle, and "Save as view".
 *
 * The URL is the single source of truth: every control reads its state
 * from the typed search params and writes back through `navigate`, so
 * back/forward and bookmarking work for free. Changing any filter
 * resets `page` so you don't land on an out-of-range page.
 */

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
  /** The route whose search params back the controls. */
  readonly from?: "/list" | "/sprints/$key";
  /**
   * Facets to leave out. The sprint detail hides `sprint`: the page
   * *is* a sprint scope, and a control that could change or clear it
   * would let the user filter their way out of the route they are on.
   */
  readonly hiddenFacets?: readonly FacetKey[];
  /** Hidden where a saved view would not reproduce the scope. */
  readonly showSaveView?: boolean;
}

export function FilterBar({
  from = "/list",
  hiddenFacets = [],
  showSaveView = true,
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

  // When `?edit=1` arrives while the bar is already mounted (the user
  // was on /list and clicked a broken view), open the editor and seed it
  // from the URL query, then strip `edit` so switching back to basic
  // does not immediately re-open it. Initial mount is covered by the
  // useState seed above; this handles the in-place navigation.
  useEffect(() => {
    if (!openEditorRequested) return;
    setDraft(query);
    setAdvanced(true);
    void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, edit: undefined }) });
  }, [openEditorRequested, query, navigate]);

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const workflow = useWorkflow();

  const [saveOpen, setSaveOpen] = useState(false);
  // Below sm the facet band collapses into a single "Filters" button that
  // opens a bottom sheet (responsive plan GROUP B) — 9+ facet pills wrapping
  // into a column ate most of the screen before any task showed.
  const isNarrow = useIsNarrow();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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

  const hasActive = activeChips.length > 0 || hasQuery;

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

  // The facet dropdowns + custom-field facets, extracted so they render
  // identically inline (desktop) and inside the mobile filter Sheet — both
  // call the same setFilter/navigate writes, so state never forks.
  const facetControls = (
    <>
      {FACET_KEYS.filter(key => !hiddenFacets.includes(key)).map(key => (
        <FilterDropdown
          key={key}
          label={FACET_LABELS[key]}
          options={options[key]}
          unavailable={failedFacets.has(key)}
          selected={facetOf(key)}
          onChange={next => setFilter(key, next)}
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
      ))}

      {customFields.map(cf =>
        cf.type === "enum" && cf.values && cf.values.length > 0 ? (
          <FilterDropdown
            key={cf.key}
            label={cf.label}
            options={cf.values.map(v => ({ value: v.key, label: v.label }))}
            selected={customFilters[cf.key] ?? []}
            onChange={next => setFilter(`field.${cf.key}`, next)}
          />
        ) : null,
      )}
    </>
  );

  const showArchivedControl = (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[0.9286rem] text-text-secondary">
      <Checkbox
        checked={search.archived === true}
        onChange={e =>
          void navigate({
            search: prev => ({ ...prev, archived: e.target.checked ? true : undefined, page: undefined }),
          })
        }
      />
      Show archived
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar, regrouped into three bands (K-2/K-3/S-3/S-4): the
          facets, the Advanced mode-toggle, then the actions. `flex-wrap`
          + `min-w-0` lets the bands reflow and condense on a narrow
          viewport rather than overflowing (S-11 mobile / UX-16 collapse):
          the facet band wraps first, and the action band stays pinned
          right until there is no room, then drops below. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* Band 1 — Advanced mode-toggle. A ToolbarButton (B1) so it
            shares the one pill height/style with the facets and shows the
            active look while the advanced editor is the mode in use. */}
        <ToolbarButton
          testId="advanced-query-toggle"
          size="sm"
          active={hasQuery}
          onClick={() => { setDraft(query); setAdvanced(true); }}
        >
          Advanced
        </ToolbarButton>

        {/* Band 2 — facets. Inline at >= sm; collapsed into a "Filters"
            button + bottom sheet below sm (GROUP B). The same controls are
            rendered in both places (facetControls), so they write the same
            search params either way. */}
        {!isNarrow && facetControls}

        {isNarrow && (
          <button
            type="button"
            data-testid="filters-open"
            onClick={() => { setFilterSheetOpen(true); }}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-border-default px-3 text-[0.9286rem] text-text-primary hover:bg-bg-muted"
          >
            Filters
            {activeFacetCount > 0 && (
              <span
                data-testid="filters-active-count"
                className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7857rem] font-medium text-accent-contrast"
              >
                {activeFacetCount}
              </span>
            )}
          </button>
        )}

        <div className="flex-1" />

        {/* Band 3 — actions. Show archived + Save-as-view stay inline at
            >= sm; on mobile they move into the filter sheet. */}
        {!isNarrow && showArchivedControl}

        {!isNarrow && showSaveView && (
          <Button size="md" onClick={() => setSaveOpen(true)}>
            <span aria-hidden="true">{ICON.star}</span>
            Save as view
          </Button>
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
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-[0.9286rem] text-text-secondary">
              <Checkbox
                checked={search.archived === true}
                onChange={e =>
                  void navigate({
                    search: prev => ({ ...prev, archived: e.target.checked ? true : undefined, page: undefined }),
                  })
                }
              />
              Show archived
            </label>
            {showSaveView && (
              <Button size="md" onClick={() => { setFilterSheetOpen(false); setSaveOpen(true); }}>
                <span aria-hidden="true">{ICON.star}</span>
                Save as view
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {hasActive ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasQuery ? (
            // LST-53: the active free-text query as a removable chip. Its
            // ✕ clears just `q` (and the saved-view id it may have come
            // from); "Clear all" below wipes everything.
            <span
              data-testid="query-chip"
              title={humanized}
              className="inline-flex items-center gap-1 rounded bg-accent-muted px-2 py-0.5 text-[0.8571rem] text-accent"
            >
              <span className="text-accent/70">Query:</span>
              <span className="max-w-[24ch] truncate font-mono">{queryPreview}</span>
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
                  <code className="font-mono">{chip.value.slice(-6)}</code>
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
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[0.8571rem] text-text-tertiary hover:bg-bg-muted hover:text-text-primary"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {saveOpen ? <SaveViewDialog search={search} onClose={() => setSaveOpen(false)} /> : null}
    </div>
  );
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

export interface FacetOptions {
  project: FilterOption[];
  status: FilterOption[];
  priority: FilterOption[];
  type: FilterOption[];
  assignee: FilterOption[];
  reporter: FilterOption[];
  labels: FilterOption[];
  milestone: FilterOption[];
  sprint: FilterOption[];
}

interface NamedEntity {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean | undefined;
}

/**
 * Like {@link NamedEntity} but `name` may be `undefined` (O5 — a corrupt
 * or absent profile name is field-local; the user still loads). Only the
 * user facet degrades this way, so it is a separate shape rather than
 * loosening every entity's `name`.
 */
interface NamedUser {
  readonly id: string;
  readonly name?: string | undefined;
  readonly archived?: boolean | undefined;
}

function buildFacetOptions(input: {
  projects: readonly NamedEntity[];
  users: readonly NamedUser[];
  labels: readonly NamedEntity[];
  milestones: readonly NamedEntity[];
  sprints: readonly NamedEntity[];
  workflow: WorkflowConfig | undefined;
}): FacetOptions {
  const live = <T extends { archived?: boolean | undefined }>(xs: readonly T[]): readonly T[] =>
    xs.filter(x => x.archived !== true);
  const userOpts: FilterOption[] = input.users.map(u => {
    // O5: a nameless profile degrades to its id so the facet option is
    // never blank.
    const name = u.name ?? u.id;
    return {
      value: u.id,
      label: u.archived ? `${name} (archived)` : name,
    };
  });
  return {
    project: live(input.projects).map(p => ({ value: p.id, label: p.name })),
    status: (input.workflow?.statuses ?? []).map(s => ({ value: s.key, label: s.label })),
    priority: (input.workflow?.priorities ?? []).map(p => ({ value: p.key, label: p.label })),
    type: (input.workflow?.task_types ?? []).map(t => ({ value: t.key, label: t.label })),
    // Assignee and reporter share one option set built from the known
    // users — archived ones included (greyed) so historical filters
    // still work. Because the options come from the users list and not
    // from task values, a dangling ULID (a deleted user, PRU-25) is
    // never offered on either facet.
    assignee: userOpts,
    reporter: userOpts,
    labels: live(input.labels).map(l => ({ value: l.id, label: l.name })),
    milestone: live(input.milestones).map(m => ({ value: m.id, label: m.name })),
    sprint: live(input.sprints).map(s => ({ value: s.id, label: s.name })),
  };
}

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
          <input
            type="radio"
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
