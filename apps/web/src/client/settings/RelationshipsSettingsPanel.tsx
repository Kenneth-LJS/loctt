import type { RelationshipDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  ConcurrentWorkflowEditError,
  useSaveWorkflowCollection,
} from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { type RelationshipDialogResult,RelationshipEditDialog } from "./RelationshipEditDialog.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { RowActions } from "./RowActions.tsx";
import { isSymmetric, reorder } from "./workflowEdits.ts";
import { buildRelationship, collectionKeys, entryChangedOnDisk } from "./workflowForms.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Workflow → Relationships (SET-4, SET-5, SET-48, SET-28,
 * SET-51).
 *
 * The one thing this panel must get right is the symmetric
 * discriminator. It is `kind: "symmetric"` — not an inferred
 * same-key inverse, and not a separate `symmetric` boolean, which
 * `RelationshipDefSchema` has no field for and would reject under
 * `.strict()`. The Create/Edit dialog writes `kind`; ticking symmetric
 * drops `inverse` and `inverse_label`.
 *
 * **Edit model (B2):** value edits (label, symmetric, inverse, graph,
 * ranked) live behind an **Edit** dialog — view-by-default. Creating a
 * relationship goes through the same dialog in create mode (SET-48).
 * REORDER stays inline (open decision #3).
 */

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
  const [dialog, setDialog] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly row: RelationshipDef }
    | null
  >(null);
  const [inFlight, setInFlight] = useState<readonly RelationshipDef[] | null>(null);

  const stored = workflow.relationships;
  const rows = inFlight ?? stored;

  const commit = (
    next: readonly RelationshipDef[],
    opts?: {
      remap?: Record<string, string | null>;
      staleBaseline?: RelationshipDef;
      onDone?: () => void;
    },
  ): void => {
    setInFlight(next);
    // SET-28: expressed against the freshly-read document — see the
    // note on `useSaveWorkflowCollection`.
    const orderedKeys = next.map(r => r.key);
    const byKey = new Map(next.map(r => [r.key, r]));
    const known = new Set(stored.map(r => r.key));
    save.mutate(
      {
        collection: "relationships",
        apply: fresh => {
          if (
            opts?.staleBaseline !== undefined
            && entryChangedOnDisk(opts.staleBaseline, fresh.relationships)
          ) {
            throw new ConcurrentWorkflowEditError(
              `These settings changed outside the app while this dialog was `
              + `open — the relationship "${opts.staleBaseline.key}" is not what it `
              + `was. Reload the panel, then re-apply your `
              + `change. Your edit was not saved.`,
            );
          }
          return [
            ...orderedKeys.flatMap(k => {
              const row = byKey.get(k);
              return row === undefined ? [] : [row];
            }),
            ...fresh.relationships.filter(r => !known.has(r.key) && !byKey.has(r.key)),
          ];
        },
        ...(opts?.remap !== undefined ? { remap: { relationships: opts.remap } } : {}),
      },
      {
        onSettled: () => { setInFlight(null); },
        onSuccess: () => {
          setDeleting(null);
          opts?.onDone?.();
        },
      },
    );
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  const dialogError = dialog !== null && save.isError ? saveError : undefined;
  const inlineError = dialog === null && save.isError;

  const applyDialog = (result: RelationshipDialogResult): void => {
    if (dialog === null) return;
    const built = buildRelationship(result.draft);
    if (dialog.mode === "create") {
      commit([...rows, built], { onDone: () => { setDialog(null); } });
      return;
    }
    const target = dialog.row;
    // The key never changes on edit, so `built.key` equals `target.key`.
    commit(
      rows.map(r => (r.key === target.key ? built : r)),
      { staleBaseline: target, onDone: () => { setDialog(null); } },
    );
  };

  return (
    <div>
      {inlineError && (
        <div
          role="alert"
          data-testid="workflow-save-error"
          className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[0.9286rem]"
        >
          <p className="font-medium text-danger-fg">
            Your change wasn’t saved.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          data-testid="relationships-create"
          disabled={save.isPending}
          onClick={() => { save.reset(); setDialog({ mode: "create" }); }}
        >
          + Add relationship
        </Button>
      </div>

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
              onEdit={() => { save.reset(); setDialog({ mode: "edit", row: rel }); }}
              onDelete={() => { save.reset(); setDeleting(rel); }}
            />
          )}
        </ReorderableRows>
      </div>

      {dialog !== null && (
        <RelationshipEditDialog
          mode={dialog.mode}
          existingKeys={collectionKeys(workflow, "relationships")}
          initial={dialog.mode === "edit" ? dialog.row : undefined}
          pending={save.isPending}
          error={dialogError}
          onSubmit={applyDialog}
          onClose={() => { setDialog(null); save.reset(); }}
        />
      )}

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
              { remap: { [deleting.key]: choice.kind === "remap" ? choice.to : null } },
            );
          }}
          onClose={() => { setDeleting(null); save.reset(); }}
        />
      )}
    </div>
  );
}

/**
 * A view-by-default relationship row: label, key, symmetric/graph/ranked
 * read out, the inverse note, refcount, and Edit / Delete controls.
 */
function RelationshipRow({
  rel,
  count,
  disabled,
  onEdit,
  onDelete,
}: {
  readonly rel: RelationshipDef;
  readonly count: number;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const symmetric = isSymmetric(rel);

  return (
    <div
      className="grid gap-1 text-[0.9286rem]"
      // SET-5: a test (and a screen reader) can tell a folded symmetric
      // row from a directional one without reading a Tailwind class.
      data-relationship-kind={symmetric ? "symmetric" : "directional"}
      data-testid={`relationship-${rel.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{rel.label}</span>
        <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary">
          {rel.key}
        </code>

        <span
          data-testid={`relationship-symmetric-${rel.key}`}
          data-symmetric={symmetric ? "true" : "false"}
          className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.8571rem] text-text-secondary"
        >
          {symmetric ? "symmetric" : "directional"}
        </span>

        <span
          data-testid={`relationship-graph-${rel.key}`}
          className="text-[0.8571rem] text-text-tertiary"
        >
          graph: {rel.graph ?? "none"}
        </span>

        {rel.ranked === true && (
          <span
            data-testid={`relationship-ranked-${rel.key}`}
            className="text-[0.8571rem] text-text-tertiary"
          >
            ranked
          </span>
        )}

        <span
          data-testid={`relationships-refcount-${rel.key}`}
          className="ml-auto text-[0.8571rem] text-text-tertiary"
        >
          {String(count)} task{count === 1 ? "" : "s"}
        </span>

        <RowActions
          label={`Actions for relationship ${rel.label}`}
          actions={[
            { label: "Edit", testId: `relationships-edit-${rel.key}`, disabled, onSelect: onEdit },
            { label: "Delete", testId: `relationships-delete-${rel.key}`, danger: true, disabled, onSelect: onDelete },
          ]}
        />
      </div>

      {/* SET-5: the inverse read-out — "same as forward" when symmetric,
          the forward/inverse pair otherwise. */}
      {symmetric ? (
        <p data-testid={`relationship-inverse-note-${rel.key}`} className="text-[0.8571rem] text-text-tertiary">
          Inverse: same as forward — a symmetric relationship reads
          identically from both sides.
        </p>
      ) : (
        <p data-testid={`relationship-inverse-note-${rel.key}`} className="text-[0.8571rem] text-text-tertiary">
          Inverse:{" "}
          <code>{rel.inverse ?? "—"}</code>
          {rel.inverse_label !== undefined && <> ({rel.inverse_label})</>}
        </p>
      )}
    </div>
  );
}
