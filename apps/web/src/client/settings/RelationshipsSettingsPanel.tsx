import type { RelationshipDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { isSymmetric, reorder, setRelationshipSymmetric } from "./workflowEdits.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Workflow → Relationships (SET-4, SET-5).
 *
 * The one thing this panel must get right is the symmetric
 * discriminator. It is `kind: "symmetric"` — not an inferred
 * same-key inverse, and not a separate `symmetric` boolean, which
 * `RelationshipDefSchema` has no field for and would reject under
 * `.strict()`. The checkbox writes `kind`; ticking it drops `inverse`
 * and `inverse_label` in the same interaction, and unticking restores
 * the values the row had rather than blanks (SET-5's third bullet).
 *
 * `graph` and `ranked` are rendered as labelled controls, not icons
 * (SET-4). `graph` replaced the former `structural` boolean.
 */

const GRAPHS = ["none", "acyclic", "tree"] as const;

export function RelationshipsSettingsPanel() {
  return (
    <WorkflowPanelFrame
      title="Relationships"
      description="How tasks link to one another. A symmetric relationship reads the same from both sides and folds to a single row."
    >
      {({ workflow, usage }) => (
        <RelationshipsEditor
          workflow={workflow}
          counts={usage?.relationships ?? {}}
        />
      )}
    </WorkflowPanelFrame>
  );
}

function RelationshipsEditor({
  workflow,
  counts,
}: {
  readonly workflow: WorkflowConfig;
  readonly counts: Readonly<Record<string, number>>;
}) {
  const save = useSaveWorkflowCollection<"relationships">();
  const [deleting, setDeleting] = useState<RelationshipDef | null>(null);
  const [inFlight, setInFlight] = useState<readonly RelationshipDef[] | null>(null);
  /**
   * The inverse fields a row had before its symmetric box was ticked,
   * so unticking restores them (SET-5). Keyed by relationship key and
   * held only for this session — the file no longer carries them, so
   * there is nowhere else they could come from.
   */
  const [restore, setRestore] = useState<
    Record<string, { inverse?: string; inverse_label?: string }>
  >({});

  const rows = inFlight ?? workflow.relationships;

  const commit = (
    next: readonly RelationshipDef[],
    remap?: Record<string, string | null>,
  ): void => {
    setInFlight(next);
    // SET-28: expressed against the freshly-read document — see the
    // note on `useSaveWorkflowCollection`.
    const orderedKeys = next.map(r => r.key);
    const byKey = new Map(next.map(r => [r.key, r]));
    const known = new Set(workflow.relationships.map(r => r.key));
    save.mutate(
      {
        collection: "relationships",
        apply: fresh => [
          ...orderedKeys.flatMap(k => {
            const row = byKey.get(k);
            return row === undefined ? [] : [row];
          }),
          ...fresh.relationships.filter(r => !known.has(r.key) && !byKey.has(r.key)),
        ],
        ...(remap !== undefined ? { remap: { relationships: remap } } : {}),
      },
      {
        onSettled: () => { setInFlight(null); },
        onSuccess: () => { setDeleting(null); },
      },
    );
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  return (
    <div>
      {save.isError && (
        <div
          role="alert"
          data-testid="workflow-save-error"
          className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[13px]"
        >
          <p className="font-medium text-danger-fg">
            The change was not saved to .loctt/config/workflow.yaml.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
        </div>
      )}

      <div data-testid="relationships-list" data-row-count={String(rows.length)}>
        <ReorderableRows
          items={rows}
          rowKey={r => r.key}
          rowLabel={r => r.label}
          onMove={(from, to) => { commit(reorder(rows, from, to)); }}
          enabled={!save.isPending}
          testIdPrefix="relationships"
        >
          {rel => (
            <RelationshipRow
              rel={rel}
              count={counts[rel.key] ?? 0}
              disabled={save.isPending}
              restore={restore[rel.key]}
              onToggleSymmetric={symmetric => {
                if (symmetric) {
                  setRestore(prev => ({
                    ...prev,
                    [rel.key]: {
                      ...(rel.inverse !== undefined ? { inverse: rel.inverse } : {}),
                      ...(rel.inverse_label !== undefined
                        ? { inverse_label: rel.inverse_label }
                        : {}),
                    },
                  }));
                }
                const next = setRelationshipSymmetric(rel, symmetric, restore[rel.key]);
                commit(rows.map(r => (r.key === rel.key ? next : r)));
              }}
              onChange={next => { commit(rows.map(r => (r.key === rel.key ? next : r))); }}
              onDelete={() => { setDeleting(rel); }}
            />
          )}
        </ReorderableRows>
      </div>

      {deleting !== null && (
        <RemapDeleteDialog
          noun="relationship"
          itemLabel={deleting.label}
          itemKey={deleting.key}
          count={counts[deleting.key] ?? 0}
          alternatives={rows
            .filter(r => r.key !== deleting.key)
            .map(r => ({ key: r.key, label: r.label }))}
          pending={save.isPending}
          error={saveError}
          onConfirm={choice => {
            commit(
              rows.filter(r => r.key !== deleting.key),
              { [deleting.key]: choice.kind === "remap" ? choice.to : null },
            );
          }}
          onClose={() => { setDeleting(null); save.reset(); }}
        />
      )}
    </div>
  );
}

function RelationshipRow({
  rel,
  count,
  disabled,
  restore,
  onToggleSymmetric,
  onChange,
  onDelete,
}: {
  readonly rel: RelationshipDef;
  readonly count: number;
  readonly disabled: boolean;
  readonly restore: { inverse?: string; inverse_label?: string } | undefined;
  readonly onToggleSymmetric: (symmetric: boolean) => void;
  readonly onChange: (next: RelationshipDef) => void;
  readonly onDelete: () => void;
}) {
  const symmetric = isSymmetric(rel);

  return (
    <div
      className="grid gap-1 text-[13px]"
      // SET-5: a test (and a screen reader) can tell a folded symmetric
      // row from a directional one without reading a Tailwind class.
      data-relationship-kind={symmetric ? "symmetric" : "directional"}
      data-testid={`relationship-${rel.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{rel.label}</span>
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] text-text-secondary">
          {rel.key}
        </code>

        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            data-testid={`relationship-symmetric-${rel.key}`}
            checked={symmetric}
            disabled={disabled}
            onChange={e => { onToggleSymmetric(e.target.checked); }}
          />
          symmetric
        </label>

        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          graph
          <select
            data-testid={`relationship-graph-${rel.key}`}
            value={rel.graph ?? "none"}
            disabled={disabled}
            onChange={e => {
              onChange({ ...rel, graph: e.target.value as RelationshipDef["graph"] });
            }}
            aria-label={`Graph constraint for ${rel.key}`}
            className="h-7 rounded-md border border-border-default bg-bg-surface px-1 text-[12px]"
          >
            {GRAPHS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            data-testid={`relationship-ranked-${rel.key}`}
            checked={rel.ranked === true}
            disabled={disabled}
            onChange={e => { onChange({ ...rel, ranked: e.target.checked }); }}
          />
          ranked
        </label>

        <span
          data-testid={`relationships-refcount-${rel.key}`}
          className="ml-auto text-[12px] text-text-tertiary"
        >
          {String(count)} task{count === 1 ? "" : "s"}
        </span>

        <button
          type="button"
          data-testid={`relationships-delete-${rel.key}`}
          disabled={disabled}
          onClick={onDelete}
          className="h-7 rounded-md border border-border-default px-2 text-[12px] text-danger-fg disabled:opacity-40"
        >
          Delete
        </button>
      </div>

      {/* SET-5: hidden when symmetric, and replaced by an explicit
          "same as forward" rather than left as blank inputs that would
          read as a misconfigured row. */}
      {symmetric
        ? (
          <p data-testid={`relationship-inverse-note-${rel.key}`} className="text-[12px] text-text-tertiary">
            Inverse: same as forward — a symmetric relationship reads
            identically from both sides.
            {restore !== undefined && restore.inverse !== undefined && (
              <span> Unticking restores <code className="font-mono">{restore.inverse}</code>.</span>
            )}
          </p>
        )
        : (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
            <label className="flex items-center gap-1">
              inverse
              <input
                data-testid={`relationship-inverse-${rel.key}`}
                defaultValue={rel.inverse ?? ""}
                disabled={disabled}
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v.length > 0 && v !== rel.inverse) onChange({ ...rel, inverse: v });
                }}
                aria-label={`Inverse key for ${rel.key}`}
                className="h-7 w-32 rounded-md border border-border-default bg-bg-surface px-2 font-mono text-[12px]"
              />
            </label>
            <label className="flex items-center gap-1">
              inverse label
              <input
                data-testid={`relationship-inverse-label-${rel.key}`}
                defaultValue={rel.inverse_label ?? ""}
                disabled={disabled}
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v.length > 0 && v !== rel.inverse_label) {
                    onChange({ ...rel, inverse_label: v });
                  }
                }}
                aria-label={`Inverse label for ${rel.key}`}
                className="h-7 w-40 rounded-md border border-border-default bg-bg-surface px-2 text-[12px]"
              />
            </label>
          </div>
        )}
    </div>
  );
}
