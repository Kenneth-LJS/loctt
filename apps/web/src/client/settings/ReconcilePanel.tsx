import { useId, useMemo, useState } from "react";

import {
  type ApplyReconcileResponse,
  type ConfirmRekeyResponse,
  DELETE_VS_EDIT_FIELD,
  type ReconcileConflict,
  type ReconcileDecision,
  type ReconcileDeleteVsEdit,
  type ReconcilePlan,
  type ReconcileSentinel,
  type RekeyPlan,
  useAbandonReconcile,
  useApplyReconcile,
  useConfirmRekey,
  useReconcileSession,
  useSaveReconcileDecisions,
} from "../api/hooks/useGit.ts";
import { Button } from "../ui/Button.tsx";
import { Combobox, ComboboxButton, type ComboboxOption } from "../ui/Combobox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ICON } from "../ui/icons.ts";
import { TextField } from "../ui/TextField.tsx";

/**
 * The per-field reconciliation UI (GIT-6, GIT-7, GIT-11..14, GIT-18,
 * GIT-26, GIT-31, GIT-32, GIT-37).
 *
 * Rendered whenever `local/reconcile.yaml` is present — the server
 * recomputes the plan from the two commits, so this state survives a
 * reload and a browser restart (GIT-26). It is reachable from Settings →
 * Sync without re-triggering the sync (GIT-26): its presence is driven by
 * the session query, not by a mutation result.
 *
 * A decision is per field. Rows are grouped by task with a per-task
 * collapse (GIT-12); Apply is disabled until every row has a choice and
 * the undecided count is shown live (GIT-6). Nothing is written until
 * Apply (GIT-31). Apply reports the true split and, on a partial failure,
 * keeps the sentinel and re-offers only the unwritten rows (GIT-32/37).
 */

type Choice = ReconcileDecision["choice"];

/** A decision plus the picked value, keyed by `${taskId}\0${field}`. */
type DecisionMap = Map<string, { choice: Choice; value?: unknown }>;

function keyOf(c: { taskId: string; field: string }): string {
  return `${c.taskId}\0${c.field}`;
}

/** The DecisionMap key for a delete-vs-edit row (GIT-16). */
function dveKeyOf(d: { taskId: string }): string {
  return `${d.taskId}\0${DELETE_VS_EDIT_FIELD}`;
}

function toDecisions(map: DecisionMap): ReconcileDecision[] {
  const out: ReconcileDecision[] = [];
  for (const [k, v] of map) {
    const [taskId, field] = k.split("\0");
    out.push({
      taskId: taskId ?? "", field: field ?? "", choice: v.choice,
      ...(v.choice === "value" ? { value: v.value ?? null } : {}),
    });
  }
  return out;
}

function initialDecisions(sentinel: ReconcileSentinel | undefined): DecisionMap {
  const map: DecisionMap = new Map();
  for (const d of sentinel?.decisions ?? []) {
    map.set(keyOf(d), { choice: d.choice, ...(d.value !== undefined ? { value: d.value } : {}) });
  }
  return map;
}

export function ReconcilePanel() {
  const session = useReconcileSession();
  const reconcile = session.data?.reconcile ?? null;
  // Apply lives here — the always-mounted parent — not in ReconcileEditor,
  // which unmounts the moment the session goes null on success. Keeping
  // the result here lets the "resolved · the sync completed" confirmation
  // survive the panel closing.
  const apply = useApplyReconcile();
  const confirmRekey = useConfirmRekey();
  const [applyResult, setApplyResult] = useState<ApplyReconcileResponse | undefined>(undefined);
  const [rekeyResult, setRekeyResult] = useState<ConfirmRekeyResponse | undefined>(undefined);

  if (session.isLoading) return null;

  // Reconciliation finished: the session is gone but we just applied it.
  if (reconcile === null) {
    // A confirmed rekey completed the sync — report which tasks were
    // renumbered (GIT-9), surviving the panel closing like the field
    // reconciliation confirmation below.
    if (rekeyResult?.reconciled === true) {
      const rekeys = rekeyResult.syncOutcome.rekeys ?? [];
      return (
        <div data-testid="git-rekey-applied" className="mb-3 text-[0.9286rem] text-text-secondary">
          <p>Renumbered {rekeys.length} task(s) to resolve key collisions; the sync completed.</p>
          {rekeys.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {rekeys.map(r => (
                <li key={r.taskId}>{r.oldKey} → {r.newKey}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    if (applyResult?.reconciled === true) {
      return (
        <p data-testid="git-reconcile-applied" className="mb-3 text-[0.9286rem] text-text-secondary">
          Resolved {applyResult.results.length} task(s); the operation completed.
        </p>
      );
    }
    return null;
  }

  // GIT-8/K92: the field conflicts are settled and a rekey is pending. Show
  // the preview and wait for a confirm before anything is renumbered —
  // whether this reconciliation had field conflicts (the rekey is the
  // second phase of the same panel) or none (the panel opens straight into
  // the rekey preview).
  if (reconcile.rekeyPlan !== undefined && reconcile.rekeyPlan.losers.length > 0) {
    return (
      <RekeyPreview
        plan={reconcile.rekeyPlan}
        confirm={confirmRekey}
        onConfirmed={setRekeyResult}
      />
    );
  }

  return (
    <ReconcileEditor
      key={reconcile.state.started_at}
      plan={reconcile.plan}
      sentinel={reconcile.state}
      apply={apply}
      applyResult={applyResult}
      setApplyResult={setApplyResult}
    />
  );
}

/**
 * The rekey confirm gate (GIT-8, GIT-9, K92). Shows, per collision: which
 * key collided, which task keeps it and which is renumbered, both
 * `created_at` values and both ULIDs, the tiebreak rule that decided the
 * keeper, and the planned new key — then waits for an explicit confirm.
 * Nothing is renumbered until the user clicks Confirm rekey.
 */
/** Exported for unit tests (GIT-8/GIT-9); rendered only by `ReconcilePanel`. */
export function RekeyPreview({ plan, confirm, onConfirmed }: {
  readonly plan: RekeyPlan;
  readonly confirm: ReturnType<typeof useConfirmRekey>;
  readonly onConfirmed: (r: ConfirmRekeyResponse) => void;
}) {
  const onConfirm = (): void => {
    confirm.mutate(undefined, { onSuccess: r => { onConfirmed(r); } });
  };
  const fmt = (v: string | null): string => (v === null ? "unknown" : v);
  return (
    <section data-testid="git-rekey-preview" aria-label="Rekey preview" className="mb-3">
      <h3 className="mb-1 text-[0.9286rem] font-semibold text-text-primary">
        Confirm key renumbering
      </h3>
      <p className="mb-2 text-[0.8571rem] text-text-secondary">
        The merge left {plan.losers.length === 1 ? "a task" : `${plan.losers.length} tasks`} sharing a
        key with another. The earlier-created task keeps the key; the later one is renumbered.
        Nothing is renumbered until you confirm.
      </p>
      <ul className="flex flex-col gap-2">
        {plan.losers.map(l => (
          <li
            key={l.loserId}
            data-testid="git-rekey-row"
            className="rounded border border-border-default p-2 text-[0.8571rem]"
          >
            <div className="font-medium text-text-primary">
              <span data-testid="git-rekey-collided-key">{l.key}</span> collided —
              {" "}renumbering to <span data-testid="git-rekey-new-key">{l.newKey ?? "(unavailable)"}</span>
            </div>
            {/* The internal task ids (ULIDs) are not in the prose — they
                identify nothing to a person, and the human key is already
                in the header line above while the created dates are what
                let a user recognise which task is which. (Ken's report.)
                They ARE still reachable, in the collapsed disclosure
                below, because GIT-9 turns on being able to check the
                decision: when the timestamps tie, the ULIDs are the only
                two values that explain the outcome, and a rule the user
                cannot check against the inputs is not a reason. */}
            <div className="mt-1 text-text-secondary">
              The task created {fmt(l.keeperCreatedAt)} keeps the key.
            </div>
            <div className="text-text-secondary">
              The task created {fmt(l.loserCreatedAt)} is renumbered.
            </div>
            <div data-testid="git-rekey-tiebreak" className="mt-1 text-text-tertiary">
              {l.tiebreak === "created_at"
                ? "The earlier task keeps the key."
                : /* GIT-9: "the tie was broken automatically" said only
                     that something decided — not what, and not that the
                     answer is the same on every machine. Naming the rule
                     is the point of the case: the ULIDs are sortable and
                     already fixed on disk, so the lower one winning is
                     what makes a second clone reconciling the same two
                     tasks reach the same keeper. */
                  "Both were created at the same instant, so the tie was broken on the "
                  + "tasks’ internal IDs (ULIDs): the lower ULID keeps the key. The IDs "
                  + "are already fixed, so every clone reconciling these two tasks picks "
                  + "the same keeper."}
            </div>
            {l.tiebreak === "ulid" && (
              /* Collapsed by default: the values matter only to someone
                 checking the decision, and an always-on pair of 26-char
                 ULIDs is the clutter Ken's report removed. Native
                 `<details>` — keyboard-operable for free, same pattern as
                 the sync log in GitSyncPanel. */
              <details data-testid="git-rekey-ulids" className="mt-1 text-text-tertiary">
                <summary className="cursor-pointer select-none">
                  Show the IDs that decided it
                </summary>
                <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2">
                  <dt>Keeps the key</dt>
                  <dd data-testid="git-rekey-keeper-id" className="font-mono break-all">
                    {l.keeperId}
                  </dd>
                  <dt>Renumbered</dt>
                  <dd data-testid="git-rekey-loser-id" className="font-mono break-all">
                    {l.loserId}
                  </dd>
                </dl>
              </details>
            )}
          </li>
        ))}
      </ul>
      {plan.skipped.length > 0 && (
        <p data-testid="git-rekey-skipped" role="alert" className="mt-2 text-[0.8571rem] text-warn-fg">
          {plan.skipped.length} collision(s) cannot be renumbered automatically and will remain until
          resolved; see Diagnostics.
        </p>
      )}
      {confirm.isError && (
        <p role="alert" className="mt-2 text-[0.8571rem] text-danger-fg">
          {confirm.error.message}
        </p>
      )}
      <div className="mt-3">
        <Button
          type="button"
          data-testid="git-rekey-confirm"
          onClick={onConfirm}
          disabled={confirm.isPending}
        >
          {confirm.isPending ? "Renumbering…" : "Confirm rekey"}
        </Button>
      </div>
    </section>
  );
}

function ReconcileEditor({ plan, sentinel, apply, applyResult, setApplyResult }: {
  readonly plan: ReconcilePlan;
  readonly sentinel: ReconcileSentinel;
  readonly apply: ReturnType<typeof useApplyReconcile>;
  readonly applyResult: ApplyReconcileResponse | undefined;
  readonly setApplyResult: (r: ApplyReconcileResponse) => void;
}) {
  const save = useSaveReconcileDecisions();
  const abandon = useAbandonReconcile();

  const [decisions, setDecisions] = useState<DecisionMap>(() => initialDecisions(sentinel));
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(() => groupByTask(plan.conflicts), [plan.conflicts]);
  const dve = plan.deleteVsEdit;
  const undecided = plan.conflicts.filter(c => !decisions.has(keyOf(c))).length
    + dve.filter(d => !decisions.has(dveKeyOf(d))).length;

  const setChoice = (c: ReconcileConflict, choice: Choice, value?: unknown) => {
    setDecisions(prev => {
      const next = new Map(prev);
      next.set(keyOf(c), { choice, ...(choice === "value" ? { value } : {}) });
      return next;
    });
  };

  // GIT-26: persist the choices as they change, so a reload restores them.
  const persist = (next: DecisionMap) => { save.mutate(toDecisions(next)); };

  const bulk = (choice: "local" | "remote") => {
    setDecisions(prev => {
      const next = new Map(prev);
      // GIT-12: a bulk action fills every row but leaves each individually
      // re-overridable afterwards — it does not lock anything.
      for (const c of plan.conflicts) next.set(keyOf(c), { choice });
      // GIT-16: a delete-vs-edit row's choice is a side too — keep-all-local
      // keeps local's outcome (its edit or its deletion), and vice versa.
      for (const d of dve) next.set(dveKeyOf(d), { choice });
      persist(next);
      return next;
    });
  };

  const onApply = () => {
    apply.mutate(toDecisions(decisions), {
      onSuccess: (data) => { setApplyResult(data); },
    });
  };

  const toggleCollapse = (taskId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  return (
    <section
      data-testid="git-reconcile-panel"
      data-reconcile-mode={sentinel.mode}
      className="mb-5 rounded-md border border-warn-fg/40 bg-bg-surface p-4"
    >
      <h2 className="mb-1 text-[1rem] font-semibold text-text-primary">
        Reconcile conflicts
      </h2>
      {/* GIT-15/GIT-18: the panel says which operation opened it and completes after Apply. */}
      <p className="mb-3 text-[0.9286rem] text-text-secondary" data-testid="git-reconcile-intro">
        A <strong data-testid="git-reconcile-op">{sentinel.mode}</strong> found changes made on
        both sides since the last sync. Resolve each field, then the {sentinel.mode} completes.
        Started {new Date(sentinel.started_at).toLocaleString()} · base{" "}
        <code className="text-[0.8571rem]">{sentinel.base_commit.slice(0, 8)}</code> → remote{" "}
        <code className="text-[0.8571rem]">{sentinel.remote_commit.slice(0, 8)}</code>.
      </p>

      {/* GIT-5/GIT-17: auto-merged/converged fields are reported, not asked. */}
      {plan.autoMerged.length > 0 && (
        <p data-testid="git-reconcile-automerged" className="mb-3 text-[0.8571rem] text-text-tertiary">
          Auto-merged:{" "}
          {plan.autoMerged.map((a, i) => (
            <span key={`${a.taskKey}-${a.kind}`}>
              {i > 0 ? "; " : ""}
              {a.taskKey} {a.kind === "converged" ? "converged" : "merged"} {a.fields.join(", ")}
            </span>
          ))}
          .
        </p>
      )}

      {applyResult !== undefined && !applyResult.reconciled && (
        <div
          role="alert"
          data-testid="git-reconcile-partial"
          className="mb-3 rounded-md border border-danger-fg p-2 text-[0.9286rem] text-danger-fg"
        >
          Applied {applyResult.results.filter(r => r.ok).length} of {applyResult.results.length}{" "}
          task(s). These failed and are still pending — the reconciliation is incomplete and
          resumable:
          <ul className="ml-4 list-disc">
            {applyResult.results.filter(r => !r.ok).map(r => (
              <li key={r.taskId} data-testid="git-reconcile-failed-row">
                {r.taskKey}: {r.error ?? "write failed"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The success confirmation lives in the parent ReconcilePanel — it
          survives this editor unmounting when the session goes null. */}

      {/* Bulk actions + live undecided count (GIT-12, GIT-6). */}
      {(plan.conflicts.length > 0 || dve.length > 0) && applyResult?.reconciled !== true && (
        <>
          <div className="mb-3 flex items-center gap-2 text-[0.9286rem]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              testId="git-reconcile-keep-all-local"
              onClick={() => { bulk("local"); }}
            >
              Keep all local
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              testId="git-reconcile-keep-all-remote"
              onClick={() => { bulk("remote"); }}
            >
              Keep all remote
            </Button>
            <span data-testid="git-reconcile-undecided" data-undecided={String(undecided)} className="ml-auto text-text-secondary">
              {undecided === 0 ? "All rows decided" : `${String(undecided)} undecided`}
            </span>
          </div>

          <div className="space-y-3">
            {groups.map(group => (
              <TaskGroup
                key={group.taskId}
                group={group}
                decisions={decisions}
                collapsed={collapsed.has(group.taskId)}
                onToggle={() => { toggleCollapse(group.taskId); }}
                onChoose={(c, choice, value) => {
                  setChoice(c, choice, value);
                  const next = new Map(decisions);
                  next.set(keyOf(c), { choice, ...(choice === "value" ? { value } : {}) });
                  persist(next);
                }}
              />
            ))}
          </div>

          {/* GIT-16: delete-vs-edit rows — a whole-task keep-deletion /
              keep-task choice, distinct from the per-field rows above. */}
          {dve.length > 0 && (
            <div className="mt-3 space-y-2" data-testid="git-reconcile-dve-section">
              {dve.map(d => (
                <DeleteVsEditRow
                  key={d.taskId}
                  row={d}
                  choice={decisions.get(dveKeyOf(d))?.choice}
                  onChoose={(choice) => {
                    setDecisions(prev => {
                      const next = new Map(prev);
                      next.set(dveKeyOf(d), { choice });
                      persist(next);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}

          {apply.isError && (
            <div className="mt-3" data-testid="git-reconcile-apply-error">
              <ErrorState error={apply.error} onRetry={onApply} context="applying the reconciliation" />
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              testId="git-reconcile-apply"
              disabled={undecided > 0 || apply.isPending}
              onClick={onApply}
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </Button>
            {confirmingAbandon
              ? (
                  <span data-testid="git-reconcile-abandon-confirm" className="flex items-center gap-2 text-[0.9286rem]">
                    Abandon this reconciliation? Local files are left exactly as they are — this is
                    not a revert.
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      testId="git-reconcile-abandon-confirm-button"
                      onClick={() => { abandon.mutate(); }}
                    >
                      Abandon
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => { setConfirmingAbandon(false); }}
                    >
                      Cancel
                    </Button>
                  </span>
                )
              : (
                  <Button
                    type="button"
                    variant="secondary"
                    testId="git-reconcile-abandon"
                    onClick={() => { setConfirmingAbandon(true); }}
                  >
                    Abandon
                  </Button>
                )}
          </div>
        </>
      )}
    </section>
  );
}

interface TaskGroupData {
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly rows: readonly ReconcileConflict[];
}

function groupByTask(conflicts: readonly ReconcileConflict[]): TaskGroupData[] {
  const byId = new Map<string, TaskGroupData>();
  for (const c of conflicts) {
    const existing = byId.get(c.taskId);
    if (existing === undefined) {
      byId.set(c.taskId, { taskId: c.taskId, taskKey: c.taskKey, taskTitle: c.taskTitle, rows: [c] });
    } else {
      (existing.rows as ReconcileConflict[]).push(c);
    }
  }
  return [...byId.values()];
}

function TaskGroup({ group, decisions, collapsed, onToggle, onChoose }: {
  readonly group: TaskGroupData;
  readonly decisions: DecisionMap;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onChoose: (c: ReconcileConflict, choice: Choice, value?: unknown) => void;
}) {
  const groupUndecided = group.rows.filter(c => !decisions.has(keyOf(c))).length;
  return (
    <div data-testid="git-reconcile-task-group" data-task-key={group.taskKey} className="rounded border border-border-subtle">
      <button
        type="button"
        data-testid="git-reconcile-task-toggle"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.9286rem] font-medium text-text-primary"
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={14} />
        <code className="text-[0.8571rem]">{group.taskKey}</code>
        <span className="truncate text-text-secondary">{group.taskTitle}</span>
        <span className="ml-auto text-[0.8571rem] text-text-tertiary">
          {group.rows.length} field{group.rows.length === 1 ? "" : "s"}
          {groupUndecided > 0 ? ` · ${String(groupUndecided)} undecided` : ""}
        </span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {group.rows.map(c => (
            <ConflictRow
              key={c.field}
              conflict={c}
              decision={decisions.get(keyOf(c))}
              onChoose={(choice, value) => { onChoose(c, choice, value); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Exported for the a11y unit test (Batch-2): the pick-value control's
// accessible name comes from the field-name element via
// aria-labelledby, which is checkable only by rendering the row.
export function ConflictRow({ conflict, decision, onChoose }: {
  readonly conflict: ReconcileConflict;
  readonly decision: { choice: Choice; value?: unknown } | undefined;
  readonly onChoose: (choice: Choice, value?: unknown) => void;
}) {
  const [pickValue, setPickValue] = useState<string>(
    decision?.choice === "value" && typeof decision.value === "string" ? decision.value : "",
  );
  const chosen = decision?.choice;
  const isEnumLike = conflict.kind === "enum" || conflict.kind === "relationship_parent";
  // a11y: the field name is the accessible label for the pick-value
  // control. It is a plain heading `<div>`, not a `<label>`, so give it
  // an id and point the control at it with aria-labelledby — otherwise
  // the select/input announces as an unlabelled control (Batch-2 a11y).
  const fieldLabelId = useId();

  return (
    <div data-testid="git-reconcile-row" data-field={conflict.field} className="px-3 py-2 text-[0.9286rem]">
      <div id={fieldLabelId} className="mb-1 font-medium text-text-primary">{conflict.fieldLabel}</div>
      <div className="grid grid-cols-2 gap-2">
        <SideButton
          testId="git-reconcile-keep-local"
          label="Local"
          value={conflict.local.display}
          drift={conflict.local.drift?.reason}
          corrupt={conflict.local.corrupt}
          selected={chosen === "local"}
          onClick={() => { onChoose("local"); }}
        />
        <SideButton
          testId="git-reconcile-keep-remote"
          label="Remote"
          value={conflict.remote.display}
          drift={conflict.remote.drift?.reason}
          corrupt={conflict.remote.corrupt}
          selected={chosen === "remote"}
          onClick={() => { onChoose("remote"); }}
        />
      </div>

      {/* GIT-14: keep-remote on a drift value warns it will render with a marker + appear in Diagnostics. */}
      {chosen === "remote" && conflict.remote.drift !== undefined && (
        <p role="alert" data-testid="git-reconcile-drift-warning" className="mt-1 text-[0.8571rem] text-warn-fg">
          This value is not in your local workflow configuration. Keeping it leaves the task with a drift
          marker, and it will appear in Diagnostics until the referenced value is re-added.
        </p>
      )}

      {/* pick-value: enum/parent offer a picker (GIT-11/13); scalar offers free text (GIT-6). */}
      <div className="mt-2 flex items-center gap-2">
        {isEnumLike
          ? (
              // A211/A242: the enum/parent value set grows with the
              // workflow (statuses, priorities, tasks) — a searchable
              // Combobox rather than a native <select>. Its accessible
              // name comes from the field heading via `aria-labelledby`
              // (the heading is a plain <div>, not a <label>), which the
              // ComboboxButton forwards to the trigger — so the control
              // still announces the field it belongs to (Batch-2 a11y).
              <Combobox
                label={conflict.fieldLabel}
                options={(conflict.options ?? []).map((o): ComboboxOption => ({
                  key: o.key,
                  label: o.label,
                }))}
                value={chosen === "value" && pickValue !== "" ? pickValue : undefined}
                onSelect={(key) => {
                  setPickValue(key);
                  onChoose("value", key);
                }}
                listTestId="git-reconcile-pick-value-list"
                optionTestId={o => `git-reconcile-pick-value-option-${o.key}`}
                searchTestId="git-reconcile-pick-value-search"
                trigger={p => (
                  <ComboboxButton
                    {...p}
                    size="sm"
                    testId="git-reconcile-pick-value"
                    dataValue={chosen === "value" ? pickValue : ""}
                    aria-labelledby={fieldLabelId}
                    placeholder="Pick a value…"
                  >
                    {chosen === "value" && pickValue !== ""
                      ? conflict.options?.find(o => o.key === pickValue)?.label ?? pickValue
                      : ""}
                  </ComboboxButton>
                )}
              />
            )
          : (
              <TextField
                type="text"
                size="sm"
                data-testid="git-reconcile-pick-value"
                aria-labelledby={fieldLabelId}
                placeholder="Type a third value…"
                value={chosen === "value" ? pickValue : ""}
                onChange={(e) => {
                  setPickValue(e.target.value);
                  onChoose("value", e.target.value);
                }}
              />
            )}
        {chosen !== undefined && (
          <span data-testid="git-reconcile-row-decided" className="text-[0.8571rem] text-text-tertiary">
            {chosen === "value" ? "custom value" : `keeping ${chosen}`}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A delete-vs-edit row (GIT-16). States plainly which side deleted the task
 * and which edited it, and offers keep-the-deletion / keep-the-task. The
 * chosen side is recorded as the winning side: keep-deletion selects the
 * deleting side, keep-task selects the editing side. Keeping the task does
 * not resurrect a colliding key silently — the completing sync routes a
 * collision through the rekey confirm (GIT-16 bullet 4 / K92).
 */
export function DeleteVsEditRow({ row, choice, onChoose }: {
  readonly row: ReconcileDeleteVsEdit;
  readonly choice: Choice | undefined;
  readonly onChoose: (choice: "local" | "remote") => void;
}) {
  const keepDeletionSide = row.deletedSide; // choosing the deleting side keeps the deletion
  const keepTaskSide = row.editedSide; // choosing the editing side keeps the task
  const decided = choice === "local" || choice === "remote";
  const keepingTask = choice === keepTaskSide;
  return (
    <div
      data-testid="git-reconcile-dve-row"
      data-task-key={row.taskKey}
      className="rounded border border-warn-fg/40 p-3 text-[0.9286rem]"
    >
      <div className="mb-1 font-medium text-text-primary">
        <code className="text-[0.8571rem]">{row.taskKey}</code>{" "}
        <span className="text-text-secondary">{row.taskTitle}</span>
      </div>
      <p data-testid="git-reconcile-dve-desc" className="mb-2 text-[0.8571rem] text-text-secondary">
        This task was <strong>deleted on the {row.deletedSide} side</strong> and{" "}
        <strong>edited on the {row.editedSide} side</strong>. Keep the deletion, or keep the task.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="git-reconcile-dve-keep-deletion"
          data-selected={String(choice === keepDeletionSide)}
          onClick={() => { onChoose(keepDeletionSide); }}
          className={`rounded border px-2 py-1 text-left ${
            choice === keepDeletionSide ? "border-accent bg-accent/10" : "border-border-subtle"
          }`}
        >
          <div className="text-[0.7857rem] uppercase text-text-tertiary">Keep the deletion</div>
          <div className="text-text-primary">Remove {row.taskKey}</div>
        </button>
        <button
          type="button"
          data-testid="git-reconcile-dve-keep-task"
          data-selected={String(choice === keepTaskSide)}
          onClick={() => { onChoose(keepTaskSide); }}
          className={`rounded border px-2 py-1 text-left ${
            choice === keepTaskSide ? "border-accent bg-accent/10" : "border-border-subtle"
          }`}
        >
          <div className="text-[0.7857rem] uppercase text-text-tertiary">Keep the task</div>
          <div className="text-text-primary">Keep {row.taskKey}</div>
        </button>
      </div>
      {decided && (
        <span data-testid="git-reconcile-dve-decided" className="mt-1 block text-[0.8571rem] text-text-tertiary">
          {keepingTask
            ? "keeping the task — if its key now collides, you will confirm a renumber next"
            : "keeping the deletion"}
        </span>
      )}
    </div>
  );
}

function SideButton({ testId, label, value, drift, corrupt, selected, onClick }: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly drift: string | undefined;
  readonly corrupt: { readonly rawText: string; readonly error: string } | undefined;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-selected={String(selected)}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-left ${
        selected ? "border-accent bg-accent/10" : "border-border-subtle"
      }`}
    >
      <div className="text-[0.7857rem] uppercase text-text-tertiary">{label}</div>
      <div className="text-text-primary" data-testid={`${testId}-value`}>
        {/* Phase-7B: a corrupt side shows the stored (corrupt) bytes, not
            the degraded "(none)" — and a ⚠ so it is never mistaken for an
            empty value the user might safely merge over. */}
        {corrupt !== undefined ? corrupt.rawText : value}
        {corrupt !== undefined && (
          <span data-testid="git-reconcile-corrupt-marker" className="ml-1 text-danger-fg" title={corrupt.error}>
            {ICON.warning} corrupt
          </span>
        )}
        {drift !== undefined && (
          <span data-testid="git-reconcile-drift-marker" className="ml-1 text-warn-fg" title={drift}>
            {ICON.warning} drift
          </span>
        )}
      </div>
    </button>
  );
}
