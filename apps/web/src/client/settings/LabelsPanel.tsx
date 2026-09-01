import type { LabelDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import {
  useArchiveLabel,
  useCountedLabels,
  useDeleteLabel,
  useUpdateLabel,
} from "../api/hooks/useDataMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";

/**
 * Settings → Data → Labels (MSL-8..MSL-12, MSL-31, MSL-32, MSL-34,
 * MSL-37).
 *
 * Two things here are load-bearing and were broken underneath before
 * this panel existed:
 *
 *  - **Delete means delete.** `DELETE /api/labels/:id` omitted core's
 *    `hard` flag, so it archived while answering 200, and it rejected
 *    `remap_to` outright because the archive path throws on it. Both
 *    are fixed in the route; this panel is the first caller that
 *    depends on either.
 *  - **Archive is a separate action from delete** (MSL-10), over the
 *    `/archive` and `/unarchive` routes added alongside. Core's
 *    `editLabel` cannot set `archived` at all, so a PUT could never
 *    have done it.
 *
 * Reference counts come from `?counts=true`, the same scan the delete
 * guard uses, so the number in the row and the number in the confirm
 * cannot disagree (MSL-11).
 */

/** MSL-37: the format the editor accepts, stated to the user. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidColor(value: string): boolean {
  return value === "" || HEX_RE.test(value);
}

function LabelRow({ label, count, allLabels }: {
  readonly label: LabelDef & { readonly taskCount?: number };
  readonly count: number;
  readonly allLabels: readonly LabelDef[];
}) {
  const update = useUpdateLabel();
  const archive = useArchiveLabel();
  const del = useDeleteLabel();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archived = label.archived === true;
  const colorOk = isValidColor(color);
  const nameOk = name.trim().length > 0;

  return (
    <li
      data-testid={`label-row-${label.id}`}
      data-label-archived={archived ? "true" : "false"}
      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
    >
      <span
        aria-hidden="true"
        data-testid="label-swatch"
        data-label-color={label.color ?? ""}
        className="h-4 w-4 shrink-0 rounded-full border border-border-subtle"
        style={{ backgroundColor: label.color ?? "transparent" }}
      />

      {editing
        ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex gap-2">
                <input
                  aria-label="Label name"
                  data-testid="label-name-input"
                  value={name}
                  onChange={e => { setName(e.target.value); }}
                  className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]"
                />
                <input
                  aria-label="Label colour"
                  data-testid="label-color-input"
                  value={color}
                  placeholder="#aabbcc"
                  onChange={e => { setColor(e.target.value); }}
                  className="w-28 rounded border border-border-subtle bg-bg-surface px-2 py-1 font-mono text-[13px]"
                />
              </div>
              {/*
                MSL-37: rejected at the input, naming the expected
                format, with Save blocked — nothing partially-written
                reaches labels.yaml.
              */}
              {!colorOk && (
                <p role="alert" data-testid="label-color-invalid" className="text-[12px] text-status-danger">
                  Colour must be a 6-digit hex value like{" "}
                  <code className="font-mono">#aabbcc</code>. Leave it empty for no colour.
                </p>
              )}
              {update.isError && (
                <p role="alert" className="text-[12px] text-status-danger">
                  {update.error instanceof ApiError ? update.error.message : "Could not save."}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="label-save"
                  disabled={!colorOk || !nameOk || update.isPending}
                  onClick={() => {
                    update.mutate(
                      { id: label.id, name: name.trim(), color: color === "" ? null : color },
                      { onSuccess: () => { setEditing(false); } },
                    );
                  }}
                  className="rounded border border-border-subtle px-2 py-1 text-[12px] disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setName(label.name);
                    setColor(label.color ?? "");
                    setEditing(false);
                  }}
                  className="rounded border border-border-subtle px-2 py-1 text-[12px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        : (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                {label.name}
                {/*
                  MSL-10: an archived label is still shown wherever it is
                  referenced, marked rather than hidden.
                */}
                {archived && (
                  <span data-testid="label-archived-marker" className="ml-2 text-text-tertiary">
                    (archived)
                  </span>
                )}
              </span>

              {/*
                MSL-11: zero is rendered as 0, never as a blank — a blank
                cell reads as "unknown", which is a different claim.
              */}
              <span
                data-testid="label-refcount"
                data-label-refcount={String(count)}
                className="w-24 shrink-0 text-right text-[12px] text-text-secondary"
              >
                {String(count)} task{count === 1 ? "" : "s"}
              </span>

              <button
                type="button"
                data-testid="label-edit"
                onClick={() => { setEditing(true); }}
                className="rounded border border-border-subtle px-2 py-1 text-[12px]"
              >
                Edit
              </button>
              <button
                type="button"
                data-testid="label-archive-toggle"
                disabled={archive.isPending}
                onClick={() => { archive.mutate({ id: label.id, archived: !archived }); }}
                className="rounded border border-border-subtle px-2 py-1 text-[12px] disabled:opacity-50"
              >
                {archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                data-testid="label-delete"
                onClick={() => { setConfirmingDelete(true); }}
                className="rounded border border-border-subtle px-2 py-1 text-[12px]"
              >
                Delete
              </button>
            </>
          )}

      {confirmingDelete && (
        /*
          MSL-12/MSL-13/MSL-32: a referenced label cannot be confirmed
          without a remap choice, and an unreferenced one gets the
          lighter confirm. Both come from the shared dialog, which owns
          the "no default-focused destructive button" rule.
        */
        <RemapDeleteDialog
          noun="label"
          itemLabel={label.name}
          itemKey={label.name}
          count={count}
          alternatives={allLabels
            .filter(l => l.id !== label.id && l.archived !== true)
            .map(l => ({ key: l.id, label: l.name }))}
          pending={del.isPending}
          error={del.isError
            ? (del.error instanceof ApiError ? del.error.message : "Delete failed.")
            : undefined}
          onClose={() => { setConfirmingDelete(false); }}
          onConfirm={(choice) => {
            del.mutate(
              {
                id: label.id,
                ...(choice.kind === "remap" ? { remapTo: choice.to } : {}),
              },
              { onSuccess: () => { setConfirmingDelete(false); } },
            );
          }}
        />
      )}
    </li>
  );
}

function CreateLabelForm({ existing }: { readonly existing: readonly LabelDef[] }) {
  const create = useCreateLabel();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);

  const trimmed = name.trim();
  const colorOk = isValidColor(color);
  /**
   * MSL-34: names are not unique, so a duplicate is a caution shown
   * *before* confirming — never an error, and never a block. The
   * wording must not claim the name is invalid, because it is not.
   */
  const duplicate = trimmed !== ""
    && existing.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
  const needsAck = duplicate && !acknowledgedDuplicate;

  return (
    <form
      data-testid="label-create-form"
      className="mb-4 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsAck) { setAcknowledgedDuplicate(true); return; }
        create.mutate(
          { name: trimmed, ...(color !== "" ? { color } : {}) },
          {
            onSuccess: () => {
              setName("");
              setColor("");
              setAcknowledgedDuplicate(false);
            },
          },
        );
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="New label name"
          data-testid="label-create-name"
          value={name}
          placeholder="New label"
          onChange={(e) => { setName(e.target.value); setAcknowledgedDuplicate(false); }}
          className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px]"
        />
        <input
          aria-label="New label colour"
          data-testid="label-create-color"
          value={color}
          placeholder="#aabbcc"
          onChange={e => { setColor(e.target.value); }}
          className="w-28 rounded border border-border-subtle bg-bg-surface px-2 py-1 font-mono text-[13px]"
        />
        <button
          type="submit"
          data-testid="label-create-submit"
          disabled={trimmed === "" || !colorOk || create.isPending}
          className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1 text-[13px] disabled:opacity-50"
        >
          {needsAck ? "Create anyway" : "Create"}
        </button>
      </div>

      {!colorOk && (
        <p role="alert" data-testid="label-create-color-invalid" className="text-[12px] text-status-danger">
          Colour must be a 6-digit hex value like <code className="font-mono">#aabbcc</code>.
        </p>
      )}

      {duplicate && (
        <p
          data-testid="label-duplicate-warning"
          data-label-duplicate="warning"
          className="text-[12px] text-status-warn"
        >
          A label with this name already exists. Label names do not have to be
          unique — you can create it anyway, and both will be shown with their
          colours to tell them apart.
        </p>
      )}

      {create.isError && (
        <p role="alert" className="text-[12px] text-status-danger">
          {create.error instanceof ApiError ? create.error.message : "Could not create the label."}
        </p>
      )}
    </form>
  );
}

export function LabelsPanel() {
  const labels = useCountedLabels();

  if (labels.isError) {
    /*
      MSL-31: a labels.yaml that will not parse is NOT an empty list.
      The error names the file and carries the loader's own violation
      text (e.g. `duplicate label id: <id>`), and the panel is visibly a
      failure state rather than a tracker with no labels.
    */
    const envelope = labels.error instanceof ApiError ? labels.error.envelope : undefined;
    return (
      <div className="p-8" data-testid="labels-panel">
        <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
          Labels
        </h1>
        <div data-testid="labels-load-error" data-labels-state="load-failed">
          <ErrorState
            error={labels.error}
            onRetry={() => { void labels.refetch(); }}
            context="reading .loctt/config/labels.yaml"
          />
          <p className="mt-2 text-[13px] text-text-secondary">
            This is a failure to read the file, not an empty label list. Fix{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
              .loctt/config/labels.yaml
            </code>{" "}
            and reload.
            {envelope?.code !== undefined && (
              <span className="ml-1 text-text-tertiary">({envelope.code})</span>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (labels.isLoading || labels.data === undefined) {
    return <div className="p-8 text-[13px] text-text-tertiary">Loading labels…</div>;
  }

  const items = labels.data.items;

  return (
    <div className="p-8" data-testid="labels-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Labels
      </h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Stored in{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
          .loctt/config/labels.yaml
        </code>. Task counts exclude archived tasks.
      </p>

      <CreateLabelForm existing={items} />

      {items.length === 0
        ? (
            // Distinct from the load failure above: this one really is
            // an empty file (MSL-31's "visually distinct").
            <p data-testid="labels-empty" data-labels-state="empty" className="text-[13px] text-text-tertiary">
              No labels yet. Create one above.
            </p>
          )
        : (
            <ul className="m-0 list-none p-0" data-testid="labels-list">
              {items.map(label => (
                <LabelRow
                  key={label.id}
                  label={label}
                  count={label.taskCount ?? 0}
                  allLabels={items}
                />
              ))}
            </ul>
          )}
    </div>
  );
}
