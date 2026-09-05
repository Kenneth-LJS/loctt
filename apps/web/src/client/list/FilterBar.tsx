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
import { AdvancedQueryEditor } from "./AdvancedQueryEditor.tsx";
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
type FacetKey =
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

  const setFilter = (key: string, next: string[]): void => {
    void navigate({
      search: prev => ({ ...prev, [key]: next.length > 0 ? next : undefined, page: undefined }),
    });
  };

  const facetOf = (key: FacetKey): readonly string[] =>
    (search[key] as readonly string[] | undefined) ?? [];

  const customFilters = readCustomFilters(search);

  const activeChips = buildChips(search, options, customFields)
    // A chip for a hidden facet would carry a ✕ that removes the very
    // scope the route is defined by.
    .filter(chip => !hiddenFacets.includes(chip.key as FacetKey));

  const clearAll = (): void => { void navigate({ search: clearedSearch }); };

  const hasActive = activeChips.length > 0;

  if (advanced) {
    return (
      <AdvancedQueryEditor
        value={draft}
        onChange={setDraft}
        onRun={() => {
          void navigate({
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              q: draft.trim().length > 0 ? draft : undefined,
            }),
          });
        }}
        onSwitchToBasic={(next: Record<string, unknown>) => {
          setAdvanced(false);
          void navigate({ search: () => next });
        }}
        onClose={() => { setAdvanced(false); }}
        dirty={draft !== query}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="advanced-query-toggle"
          onClick={() => { setDraft(query); setAdvanced(true); }}
          className="rounded border border-border-subtle px-2 py-1 text-[12px] text-text-secondary hover:bg-bg-muted"
        >
          Advanced
        </button>
        {FACET_KEYS.filter(key => !hiddenFacets.includes(key)).map(key => (
          <FilterDropdown
            key={key}
            label={FACET_LABELS[key]}
            options={options[key]}
            unavailable={failedFacets.has(key)}
            selected={facetOf(key)}
            onChange={next => setFilter(key, next)}
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

        <div className="flex-1" />

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
          <input
            type="checkbox"
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
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default bg-bg-surface px-2.5 text-[13px] text-text-secondary hover:bg-bg-muted"
          >
            ⭑ Save as view
          </button>
        )}
      </div>

      {hasActive ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map(chip => (
            <span
              key={`${chip.key}:${chip.value}`}
              className="inline-flex items-center gap-1 rounded bg-accent-muted px-2 py-0.5 text-[12px] text-accent"
            >
              <span className="text-accent/70">{chip.facetLabel}:</span>
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.facetLabel} ${chip.label}`}
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
                className="ml-0.5 text-accent/70 hover:text-accent"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="rounded px-1.5 py-0.5 text-[12px] text-text-tertiary hover:bg-bg-muted hover:text-text-primary"
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

interface FacetOptions {
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
}

function buildChips(
  search: Partial<ListSearch>,
  options: FacetOptions,
  customFields: WorkflowConfig["custom_fields"],
): Chip[] {
  const chips: Chip[] = [];
  const labelOf = (opts: readonly FilterOption[], value: string): string =>
    opts.find(o => o.value === value)?.label ?? value;

  for (const key of FACET_KEYS) {
    for (const value of search[key] ?? []) {
      chips.push({ key, facetLabel: FACET_LABELS[key], value, label: labelOf(options[key], value) });
    }
  }
  const custom = readCustomFilters(search);
  for (const cf of customFields) {
    for (const value of custom[cf.key] ?? []) {
      const label = cf.values?.find(v => v.key === value)?.label ?? value;
      chips.push({ key: `field.${cf.key}`, facetLabel: cf.label, value, label });
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
