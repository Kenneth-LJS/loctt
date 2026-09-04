import { useMemo, useState } from "react";

import {
  type ApplyReconcileResponse,
  type ReconcileConflict,
  type ReconcileDecision,
  type ReconcilePlan,
  type ReconcileSentinel,
  useAbandonReconcile,
  useApplyReconcile,
  useReconcileSession,
  useSaveReconcileDecisions,
} from "../api/hooks/useGit.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

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
  const [applyResult, setApplyResult] = useState<ApplyReconcileResponse | undefined>(undefined);

  if (session.isLoading) return null;

  // Reconciliation finished: the session is gone but we just applied it.
  if (reconcile === null) {
    if (applyResult?.reconciled === true) {
      return (
        <p data-testid="git-reconcile-applied" className="mb-3 text-[13px] text-text-secondary">
          Resolved {applyResult.results.length} task(s); the operation completed.
        </p>
      );
    }
    return null;
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
  const undecided = plan.conflicts.filter(c => !decisions.has(keyOf(c))).length;

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
      <h2 className="mb-1 text-[14px] font-semibold text-text-primary">
        Reconcile conflicts
      </h2>
      {/* GIT-15/GIT-18: the panel says which operation opened it and completes after Apply. */}
      <p className="mb-3 text-[13px] text-text-secondary" data-testid="git-reconcile-intro">
        A <strong data-testid="git-reconcile-op">{sentinel.mode}</strong> found changes made on
        both sides since the last sync. Resolve each field, then the {sentinel.mode} completes.
        Started {new Date(sentinel.started_at).toLocaleString()} · base{" "}
        <code className="font-mono text-[12px]">{sentinel.base_commit.slice(0, 8)}</code> → remote{" "}
        <code className="font-mono text-[12px]">{sentinel.remote_commit.slice(0, 8)}</code>.
      </p>

      {/* GIT-5/GIT-17: auto-merged/converged fields are reported, not asked. */}
      {plan.autoMerged.length > 0 && (
        <p data-testid="git-reconcile-automerged" className="mb-3 text-[12px] text-text-tertiary">
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
          className="mb-3 rounded-md border border-danger-fg p-2 text-[13px] text-danger-fg"
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
      {plan.conflicts.length > 0 && applyResult?.reconciled !== true && (
        <>
          <div className="mb-3 flex items-center gap-2 text-[13px]">
            <button
              type="button"
              data-testid="git-reconcile-keep-all-local"
              onClick={() => { bulk("local"); }}
              className="rounded border border-border-subtle px-2 py-1"
            >
              Keep all local
            </button>
            <button
              type="button"
              data-testid="git-reconcile-keep-all-remote"
              onClick={() => { bulk("remote"); }}
              className="rounded border border-border-subtle px-2 py-1"
            >
              Keep all remote
            </button>
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

          {apply.isError && (
            <div className="mt-3" data-testid="git-reconcile-apply-error">
              <ErrorState error={apply.error} onRetry={onApply} context="applying the reconciliation" />
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              data-testid="git-reconcile-apply"
              disabled={undecided > 0 || apply.isPending}
              onClick={onApply}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </button>
            {confirmingAbandon
              ? (
                  <span data-testid="git-reconcile-abandon-confirm" className="flex items-center gap-2 text-[13px]">
                    Abandon this reconciliation? Local files are left exactly as they are — this is
                    not a revert.
                    <button
                      type="button"
                      data-testid="git-reconcile-abandon-confirm-button"
                      onClick={() => { abandon.mutate(); }}
                      className="rounded border border-danger-fg px-2 py-1 text-danger-fg"
                    >
                      Abandon
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirmingAbandon(false); }}
                      className="rounded border border-border-subtle px-2 py-1"
                    >
                      Cancel
                    </button>
                  </span>
                )
              : (
                  <button
                    type="button"
                    data-testid="git-reconcile-abandon"
                    onClick={() => { setConfirmingAbandon(true); }}
                    className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px]"
                  >
                    Abandon
                  </button>
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
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-text-primary"
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <code className="font-mono text-[12px]">{group.taskKey}</code>
        <span className="truncate text-text-secondary">{group.taskTitle}</span>
        <span className="ml-auto text-[12px] text-text-tertiary">
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

function ConflictRow({ conflict, decision, onChoose }: {
  readonly conflict: ReconcileConflict;
  readonly decision: { choice: Choice; value?: unknown } | undefined;
  readonly onChoose: (choice: Choice, value?: unknown) => void;
}) {
  const [pickValue, setPickValue] = useState<string>(
    decision?.choice === "value" && typeof decision.value === "string" ? decision.value : "",
  );
  const chosen = decision?.choice;
  const isEnumLike = conflict.kind === "enum" || conflict.kind === "relationship_parent";

  return (
    <div data-testid="git-reconcile-row" data-field={conflict.field} className="px-3 py-2 text-[13px]">
      <div className="mb-1 font-medium text-text-primary">{conflict.fieldLabel}</div>
      <div className="grid grid-cols-2 gap-2">
        <SideButton
          testId="git-reconcile-keep-local"
          label="Local"
          value={conflict.local.display}
          drift={conflict.local.drift?.reason}
          selected={chosen === "local"}
          onClick={() => { onChoose("local"); }}
        />
        <SideButton
          testId="git-reconcile-keep-remote"
          label="Remote"
          value={conflict.remote.display}
          drift={conflict.remote.drift?.reason}
          selected={chosen === "remote"}
          onClick={() => { onChoose("remote"); }}
        />
      </div>

      {/* GIT-14: keep-remote on a drift value warns it will render with a marker + appear in Diagnostics. */}
      {chosen === "remote" && conflict.remote.drift !== undefined && (
        <p role="alert" data-testid="git-reconcile-drift-warning" className="mt-1 text-[12px] text-warn-fg">
          This value is not in the local workflow.yaml. Keeping it leaves the task with a drift
          marker, and it will appear in Diagnostics until the referenced value is re-added.
        </p>
      )}

      {/* pick-value: enum/parent offer a picker (GIT-11/13); scalar offers free text (GIT-6). */}
      <div className="mt-2 flex items-center gap-2">
        {isEnumLike
          ? (
              <select
                data-testid="git-reconcile-pick-value"
                value={chosen === "value" ? pickValue : ""}
                onChange={(e) => {
                  setPickValue(e.target.value);
                  onChoose("value", e.target.value);
                }}
                className="rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]"
              >
                <option value="">Pick a value…</option>
                {conflict.options?.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            )
          : (
              <input
                type="text"
                data-testid="git-reconcile-pick-value"
                placeholder="Type a third value…"
                value={chosen === "value" ? pickValue : ""}
                onChange={(e) => {
                  setPickValue(e.target.value);
                  onChoose("value", e.target.value);
                }}
                className="rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]"
              />
            )}
        {chosen !== undefined && (
          <span data-testid="git-reconcile-row-decided" className="text-[12px] text-text-tertiary">
            {chosen === "value" ? "custom value" : `keeping ${chosen}`}
          </span>
        )}
      </div>
    </div>
  );
}

function SideButton({ testId, label, value, drift, selected, onClick }: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly drift: string | undefined;
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
      <div className="text-[11px] uppercase text-text-tertiary">{label}</div>
      <div className="text-text-primary" data-testid={`${testId}-value`}>
        {value}
        {drift !== undefined && (
          <span data-testid="git-reconcile-drift-marker" className="ml-1 text-warn-fg" title={drift}>
            ⚠ drift
          </span>
        )}
      </div>
    </button>
  );
}
