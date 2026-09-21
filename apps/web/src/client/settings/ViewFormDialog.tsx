import type { ArchivedScope, ComparisonOp, Filter, SavedQuery } from "@loctt/contracts";
import { useMemo, useState } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useCreateView } from "../api/hooks/useCreateView.ts";
import { useEditView } from "../api/hooks/useEditView.ts";
import { useValidateQuery } from "../api/hooks/useValidateQuery.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { buildFacetOptions } from "../list/facetOptions.ts";
import { FilterDropdown } from "../list/FilterDropdown.tsx";
import { ArchivedScopeControl } from "../ui/ArchivedScopeControl.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { TextField } from "../ui/TextField.tsx";
import {
  buildViewFilterFields,
  findField,
  OP_LABEL,
  opsForField,
  VALUELESS_OPS,
  type ViewFilterField,
} from "./viewFilterFields.ts";

/**
 * The create / edit dialog for saved views, rebuilt for K102.
 *
 * ## What it replaced, and why
 *
 * The previous dialog was an AST builder — AND/OR/Group/Condition nodes
 * over a `BuilderTree` — with a live "Query …" DSL preview underneath.
 * Both are gone. Ken: *"there's this fucking obsession with the QUERY.
 * QUERY IS ADVANCED SHIT... average people dont need to see the fucking
 * DSL QUERY"*, and *"new views created should start with the
 * human-readable filter selection... something that matches the filter
 * bar"*.
 *
 * So the dialog IS the filter bar, in a form: an ordered list of rows,
 * each a field dropdown, an operator dropdown, and a value picker built
 * from the SAME `buildFacetOptions` the top bar uses.
 *
 * ## The kind is stored, never inferred
 *
 * A view stores an ORDERED `Filter[]`, a discriminated union of
 * `{kind:"simple"}` and `{kind:"advanced"}`. A simple filter ALWAYS
 * renders as a dropdown row and an advanced one ALWAYS as query text —
 * decided by the stored `kind` alone. Nothing here parses a query string
 * to guess how to render it, and nothing merges the list into one DSL.
 * There is no single query string for a view any more, so no preview of
 * one exists to render.
 *
 * ## Order is preserved exactly
 *
 * Rows render in array order and carry a stable local `uid`, so editing
 * row N rewrites row N in place and never moves it; removing row N
 * removes exactly that row. Ken: *"i dont want things to swap positions
 * or whatever."*
 *
 * ## Advanced is opt-in and subordinate
 *
 * "+ Add filter" is the primary way to add a row. "+ Add advanced query"
 * sits beside it as a quieter, ghost-weight action — present for the
 * people who want the DSL, never the thing the eye lands on first.
 *
 * ## Archived scope is a property, not a row
 *
 * It maps to the view's `archivedScope` field through the shared
 * `ArchivedScopeControl`, so it can never be deleted as if it were a
 * filter (K107 + K102).
 *
 * ## Editing a BROKEN view is a replacement, and says so
 *
 * A hand-edited `queries.yaml` entry whose `filters` do not validate is
 * degraded by the tolerant loader into a `BrokenSavedQuery`, whose
 * `rawText` holds the entry's FULL original YAML. That text is re-emitted
 * verbatim by every unrelated write — the P-11 / K28 / Phase-Z-C2
 * preservation guarantee — so it is the only surviving record of what the
 * user meant.
 *
 * Opening this dialog on such an entry used to seed an EMPTY filter list
 * and then let Save fire a normal `editView`, which overwrote the
 * preserved YAML with `filters: []`. The one control meant to repair the
 * entry was the only thing in the product that could destroy it.
 *
 * So `broken` is now a first-class prop, and when it is present:
 *  - the parser/validation error and the on-disk `rawText` are shown, so
 *    the user is repairing against what they actually wrote rather than
 *    against a blank picker that implies the view had no filters;
 *  - Save is INERT until the user ticks an explicit confirmation that the
 *    original text will be replaced by what the picker holds. Discarding
 *    recoverable text is therefore always a deliberate act, never the
 *    accidental result of Edit → Save.
 *
 * Repair-in-place (a raw-YAML editor here) is deliberately NOT offered:
 * the write path is `PUT /api/views/:id` with a typed `EditViewRequest`,
 * which cannot carry arbitrary YAML, and inventing a raw-text write route
 * would put a second, unvalidated author of `queries.yaml` in the web
 * app. The honest options are "fix the file by hand" (the text is shown
 * for exactly that, and is safe because nothing here writes it) or
 * "replace it deliberately" (this flow).
 */

// ── Draft rows ───────────────────────────────────────────────────────

/**
 * A filter plus a stable local identity.
 *
 * The `uid` exists ONLY so React keys survive an edit. Filters have no
 * id of their own and the array index changes when a row above is
 * removed — keying by index would let React reuse the wrong row's DOM
 * (an open dropdown or a half-typed query jumping to a neighbour), which
 * is the visible form of the reordering Ken ruled out.
 */
interface DraftRow {
  readonly uid: number;
  readonly filter: Filter;
}

let uidSeq = 0;
function nextUid(): number {
  uidSeq += 1;
  return uidSeq;
}

function row(filter: Filter): DraftRow {
  return { uid: nextUid(), filter };
}

/** A fresh, empty simple row: no field chosen yet. */
function emptySimpleRow(): DraftRow {
  return row({ kind: "simple", field: "", op: "in", values: [] });
}

/**
 * The view being edited, or `undefined` to create.
 *
 * Narrowed to what the dialog reads. `filters` is what seeds the rows —
 * read straight off the stored view, not re-derived from anything.
 */
export type ViewFormTarget = Pick<SavedQuery, "id" | "name" | "filters"> & {
  readonly archivedScope?: SavedQuery["archivedScope"];
  readonly icon?: SavedQuery["icon"];
};

/**
 * The degraded entry behind a broken view, narrowed to what the dialog
 * shows. Mirrors `BrokenSavedQuery`'s diagnostic fields; `rawText` is the
 * entry's full original YAML as it still sits on disk.
 */
export interface BrokenViewContext {
  readonly error: string;
  readonly rawText: string;
  readonly position?: number;
}

export function ViewFormDialog({
  existing,
  broken,
  onClose,
}: {
  readonly existing?: ViewFormTarget;
  /**
   * Present only when `existing` names an entry the loader could not
   * read. Turns Save into an explicit, confirmed replacement of
   * `rawText` — see the "Editing a BROKEN view" note above.
   */
  readonly broken?: BrokenViewContext;
  readonly onClose: () => void;
}) {
  const isEdit = existing !== undefined;
  const isBroken = broken !== undefined;
  /**
   * The user's explicit "yes, replace the text on disk". Unticked, Save
   * is disabled, so the data-loss path simply does not exist until they
   * opt into it.
   */
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  // K104 will build the real icon picker; the field is carried so an
  // edit never silently drops a view's stored icon.
  const [icon] = useState<string | undefined>(existing?.icon);
  const [scope, setScope] = useState<ArchivedScope>(existing?.archivedScope ?? "active");

  // Seed ONCE from the stored filters, each row keeping its own kind. A
  // create starts with one empty simple row so the dialog opens on the
  // human-readable picker rather than on nothing.
  const [rows, setRows] = useState<readonly DraftRow[]>(() => {
    const seed = existing?.filters ?? [];
    return seed.length > 0 ? seed.map(f => row(f)) : [emptySimpleRow()];
  });

  const create = useCreateView();
  const edit = useEditView();
  const pending = create.isPending || edit.isPending;
  const failure = create.error ?? edit.error;

  // Value sources — the same hooks FilterBar feeds buildFacetOptions, so
  // the dialog cannot offer a value the bar would not show.
  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const workflow = useWorkflow();

  const catalog = useMemo(
    () =>
      buildViewFilterFields(
        buildFacetOptions({
          projects: projects.data?.items ?? [],
          users: users.data?.items ?? [],
          labels: labels.data?.items ?? [],
          milestones: milestones.data?.items ?? [],
          sprints: sprints.data?.items ?? [],
          workflow: workflow.data,
        }),
        workflow.data,
      ),
    [projects.data, users.data, labels.data, milestones.data, sprints.data, workflow.data],
  );

  /** Replace row `uid` IN PLACE. Index is untouched, so order holds. */
  const replaceRow = (uid: number, filter: Filter): void => {
    setRows(prev => prev.map(r => (r.uid === uid ? { uid, filter } : r)));
  };

  /** Remove exactly row `uid` — every other row keeps its position. */
  const removeRow = (uid: number): void => {
    setRows(prev => prev.filter(r => r.uid !== uid));
  };

  const addSimple = (): void => { setRows(prev => [...prev, emptySimpleRow()]); };
  const addAdvanced = (): void => {
    setRows(prev => [...prev, row({ kind: "advanced", query: "" })]);
  };

  /**
   * The filters to save: the rows as authored, in order, minus rows the
   * user added but never filled.
   *
   * An unfilled row is DROPPED rather than blocking Save — a stray "+ Add
   * filter" click should not hold the dialog hostage. A row that is
   * PARTLY filled (a field chosen but no value, under an operator that
   * needs one) is incomplete and does block, because saving it would
   * silently discard a choice the user made.
   */
  const filters: Filter[] = rows.flatMap(r => (isBlank(r.filter) ? [] : [r.filter]));
  const incomplete = rows.some(r => !isBlank(r.filter) && !isComplete(r.filter));

  const nameEmpty = name.trim().length === 0;
  // A broken entry's preserved YAML is only replaceable once the user has
  // said so. This is the guard that closes the data-loss path: with the
  // box unticked there is no code path from this dialog to `editView`.
  const needsConfirm = isBroken && !confirmReplace;
  const disabled = nameEmpty || pending || incomplete || needsConfirm;
  const saveTitle = nameEmpty
    ? "Name this view before saving."
    : incomplete
      ? "Finish every filter before saving."
      : needsConfirm
        ? "Confirm that the original text will be replaced."
        : undefined;

  const submit = (): void => {
    if (disabled) return;
    const common = {
      name: name.trim(),
      filters,
      archivedScope: scope,
      ...(icon !== undefined ? { icon } : {}),
    };
    if (isEdit) {
      edit.mutate({ id: existing.id, body: common }, { onSuccess: onClose });
    } else {
      create.mutate(common, { onSuccess: onClose });
    }
  };

  return (
    <ResponsiveDialog
      title={isBroken ? "Replace broken view" : isEdit ? "Edit saved view" : "New saved view"}
      onClose={onClose}
      testId={isEdit ? "view-edit-dialog" : "view-create-dialog"}
      actions={
        // Cancel and Save on the SAME level, and the label is "Save"
        // (Ken: "why is it on a different level from 'Cancel'? And the
        // text should be 'Save'").
        <DialogActions>
          <Button variant="ghost" testId="view-form-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="view-form-save"
            disabled={disabled}
            {...(saveTitle !== undefined ? { title: saveTitle } : {})}
            onClick={submit}
          >
            {pending ? "Saving…" : isBroken ? "Replace view" : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        {broken !== undefined && (
          // What is actually wrong, and the bytes still on disk. Shown
          // BEFORE the picker so the user is not staring at an empty
          // filter list that implies the view had no filters — it had
          // filters; they did not load.
          <div className="flex flex-col gap-2" data-testid="view-form-broken">
            <Callout tone="danger" role="alert" testId="view-form-broken-error">
              <span>
                LocTT could not read this view&rsquo;s filters:{" "}
                <strong>{broken.error}</strong>
                {broken.position !== undefined
                  ? ` (at position ${String(broken.position)})`
                  : ""}
              </span>
            </Callout>
            <div className="flex flex-col gap-1">
              <span className="text-[0.8571rem] text-text-secondary">
                What is in{" "}
                <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
                  .loctt/config/queries.yaml
                </code>{" "}
                right now
              </span>
              {/* Read-only on purpose: this dialog writes through the
                  typed view API, which cannot carry raw YAML. The text is
                  here so the user can copy it out or fix the file by hand
                  — the one repair that keeps what they wrote. */}
              <TextArea
                readOnly
                rows={4}
                spellCheck={false}
                data-testid="view-form-broken-raw"
                aria-label="Original YAML for this view, as stored on disk"
                value={broken.rawText}
                className="font-mono text-[0.8571rem]"
              />
              <p className="m-0 text-[0.8571rem] text-text-tertiary">
                Editing that file by hand keeps this text. Saving here does
                not.
              </p>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            data-testid="view-form-name"
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); }}
            placeholder="e.g. My open bugs"
          />
        </label>

        <div className="flex flex-col gap-2" data-testid="view-filter-rows">
          <span className="text-[0.9286rem] font-medium text-text-secondary">
            Filters
          </span>
          <p className="m-0 text-[0.8571rem] text-text-tertiary">
            A task must match every filter below.
          </p>

          {rows.length === 0 ? (
            <p data-testid="view-no-filters" className="m-0 text-[0.8571rem] text-text-tertiary">
              No filters — this view will show every task in its scope.
            </p>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.uid}
                data-testid="view-filter-row"
                data-row-index={i}
                data-row-kind={r.filter.kind}
                className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-canvas px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  {r.filter.kind === "simple" ? (
                    <SimpleRow
                      index={i}
                      filter={r.filter}
                      catalog={catalog}
                      onChange={next => { replaceRow(r.uid, next); }}
                    />
                  ) : (
                    <AdvancedRow
                      index={i}
                      query={r.filter.query}
                      onChange={next => { replaceRow(r.uid, { kind: "advanced", query: next }); }}
                    />
                  )}
                </div>
                <IconButton
                  aria-label={`Remove filter ${String(i + 1)}`}
                  testId={`view-filter-remove-${String(i)}`}
                  size="sm"
                  onClick={() => { removeRow(r.uid); }}
                >
                  <Icon name="close" size={12} />
                </IconButton>
              </div>
            ))
          )}

          {/*
            The two add actions. "+ Add filter" is the one that matters —
            the dropdown picker is the default way to build a view. The
            advanced action sits beside it at ghost weight: available to
            anyone who wants the DSL, subordinate to the picker for
            everyone who does not (K102).
          */}
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" testId="view-add-filter" onClick={addSimple}>
              + Add filter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              testId="view-add-advanced"
              title="Write a filter in the query language"
              onClick={addAdvanced}
            >
              + Add advanced query
            </Button>
          </div>
        </div>

        {/* Archived is a SCOPE of the view, not a filter row — so it
            cannot be deleted by accident along with a filter (K107). */}
        <ArchivedScopeControl
          testId="view-form-archived-scope"
          label="Include"
          value={scope}
          onChange={setScope}
        />

        {isBroken && (
          // The deliberate choice. Until this is ticked, Save is disabled
          // and the preserved YAML above cannot be overwritten from here.
          <label className="flex items-start gap-2 text-[0.8571rem] text-text-secondary">
            <Checkbox
              data-testid="view-form-confirm-replace"
              checked={confirmReplace}
              onChange={e => { setConfirmReplace(e.target.checked); }}
            />
            <span>
              Replace the original text above with the filters I have built
              here. The text on disk will be discarded and cannot be
              recovered by LocTT.
            </span>
          </label>
        )}

        {failure !== undefined && failure !== null && (
          <Callout tone="danger" role="alert" testId="view-form-error">
            <span>
              {failure instanceof Error ? failure.message : "The view could not be saved."}
              {" "}Your saved views on disk were not changed.
            </span>
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// ── Completeness ─────────────────────────────────────────────────────

/** A row the user added but never touched — dropped silently on save. */
function isBlank(f: Filter): boolean {
  return f.kind === "advanced"
    ? f.query.trim().length === 0
    : f.field.trim().length === 0 && f.values.length === 0;
}

/** A row that carries enough to be stored. */
function isComplete(f: Filter): boolean {
  if (f.kind === "advanced") return f.query.trim().length > 0;
  if (f.field.trim().length === 0) return false;
  return VALUELESS_OPS.has(f.op) || f.values.length > 0;
}

// ── Simple row ───────────────────────────────────────────────────────

/**
 * One `{kind:"simple"}` filter as three controls: field, operator, value.
 *
 * The value control is the SAME `FilterDropdown` the top filter bar
 * renders, fed the same options — Ken's *"the dumb filters will go back
 * to rendering with the dumb filters in the UI"*. A field with no closed
 * value set (title, free text) falls back to a text input, since there
 * is nothing to pick from.
 */
function SimpleRow({
  index,
  filter,
  catalog,
  onChange,
}: {
  readonly index: number;
  readonly filter: Extract<Filter, { kind: "simple" }>;
  readonly catalog: readonly ViewFilterField[];
  readonly onChange: (next: Filter) => void;
}) {
  const def = findField(catalog, filter.field);
  const ops = opsForField(def);
  const needsValue = !VALUELESS_OPS.has(filter.op);
  const valueLabel = def?.label ?? (filter.field || "Value");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SelectCombobox
        size="sm"
        testId={`view-filter-field-${String(index)}`}
        aria-label={`Filter ${String(index + 1)} field`}
        value={filter.field}
        placeholder="Choose a field…"
        options={[
          { value: "", label: "Choose a field…" },
          // A stored field the catalog does not know (a removed custom
          // field) is still offered as its raw token, so the row renders
          // what the file says instead of silently resetting to blank.
          ...(def === undefined && filter.field !== ""
            ? [{ value: filter.field, label: filter.field }]
            : []),
          ...catalog.map(f => ({ value: f.field, label: f.label })),
        ]}
        onChange={field => {
          const nextDef = findField(catalog, field);
          const nextOps = opsForField(nextDef);
          // Changing the field CLEARS the values: a status key is not a
          // milestone id, and carrying them over would leave the row
          // holding values its new field can never match. The operator is
          // kept when the new field still allows it, so switching between
          // two enum fields does not silently reset "is none of".
          const op: ComparisonOp = nextOps.includes(filter.op) ? filter.op : (nextOps[0] ?? "in");
          onChange({ kind: "simple", field, op, values: [] });
        }}
      />

      <SelectCombobox
        size="sm"
        testId={`view-filter-op-${String(index)}`}
        aria-label={`Filter ${String(index + 1)} operator`}
        value={filter.op}
        options={[
          // A stored op outside this field's offered set is kept as an
          // option rather than snapping to the first — reopening a view
          // must not rewrite what it says.
          ...(!ops.includes(filter.op)
            ? [{ value: filter.op, label: OP_LABEL[filter.op] ?? filter.op }]
            : []),
          ...ops.map(op => ({ value: op, label: OP_LABEL[op] ?? op })),
        ]}
        onChange={v => {
          const op = v as ComparisonOp;
          // A valueless operator drops the values it can no longer use,
          // so the stored filter never carries dead data.
          onChange({
            kind: "simple",
            field: filter.field,
            op,
            values: VALUELESS_OPS.has(op) ? [] : filter.values,
          });
        }}
      />

      {needsValue && (
        def?.options !== undefined ? (
          <FilterDropdown
            label={valueLabel}
            options={def.options}
            selected={filter.values}
            onChange={values => {
              onChange({ kind: "simple", field: filter.field, op: filter.op, values });
            }}
          />
        ) : (
          <TextField
            size="sm"
            fullWidth={false}
            data-testid={`view-filter-value-${String(index)}`}
            aria-label={`Filter ${String(index + 1)} value`}
            placeholder="Value"
            value={filter.values[0] ?? ""}
            onChange={e => {
              const v = e.target.value;
              onChange({
                kind: "simple",
                field: filter.field,
                op: filter.op,
                values: v === "" ? [] : [v],
              });
            }}
          />
        )
      )}
    </div>
  );
}

// ── Advanced row ─────────────────────────────────────────────────────

/**
 * One `{kind:"advanced"}` filter: the DSL, as text.
 *
 * Deliberately NOT the `AdvancedQueryEditor`. That component is a
 * singleton surface — fixed `data-testid`s (`dsl-input`, `dsl-error`), a
 * "Query (DSL)" heading, a Run action and a syntax popover — built for
 * the ONE inline top-bar editor. A view may hold several advanced
 * filters, and mounting it N times would put duplicate ids and N Run
 * buttons in one dialog. So the row is the shared `TextArea` plus the
 * SAME `/api/query/validate` hook the editor uses, which keeps the
 * validation authoritative without the surrounding chrome.
 *
 * The text is stored verbatim; the server normalizes spacing only.
 */
function AdvancedRow({
  index,
  query,
  onChange,
}: {
  readonly index: number;
  readonly query: string;
  readonly onChange: (next: string) => void;
}) {
  const { result, settled } = useValidateQuery(query);
  const invalid = result !== null && !result.valid && settled;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.8571rem] text-text-tertiary">Advanced query</span>
      <TextArea
        rows={2}
        spellCheck={false}
        invalid={invalid}
        data-testid={`view-filter-query-${String(index)}`}
        aria-label={`Advanced filter ${String(index + 1)} query`}
        placeholder="status = in_progress AND assignee = currentUser()"
        value={query}
        onChange={e => { onChange(e.target.value); }}
        className="font-mono text-[0.8571rem]"
      />
      <div
        data-testid={`view-filter-query-error-${String(index)}`}
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem]"
      >
        {invalid && (
          <p className="m-0 flex items-center gap-1 text-[0.8571rem] text-danger-fg">
            <Icon name="alert" size={12} />
            {result.message ?? "This query is not valid."}
          </p>
        )}
      </div>
    </div>
  );
}
