import type { ArchivedScope, BrokenEntry, LabelDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useArchiveLabel,
  useCountedLabels,
  useDeleteLabel,
} from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { useResolvedColor } from "../ui/entityColor.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { ArchivedScopeReveal } from "./ArchivedScopeReveal.tsx";
import { hashDeepLinkPresent } from "./deepLinkHash.ts";
import { LabelEditDialog } from "./LabelEditDialog.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";

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

function LabelRow({ label, count, allLabels }: {
  readonly label: LabelDef & { readonly taskCount?: number };
  readonly count: number;
  readonly allLabels: readonly LabelDef[];
}) {
  const archive = useArchiveLabel();
  const del = useDeleteLabel();
  // K100: editing now runs through the shared LabelEditDialog (which the
  // sidebar also opens), rather than an inline row form. The panel only
  // decides whether the dialog is open.
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archived = label.archived === true;
  // K103: the swatch takes one hex, resolved for the active theme.
  // `data-label-color` reports the SAME resolved value it paints —
  // before this it interpolated the stored value, so a palette or
  // per-mode colour published `[object Object]` to both the attribute
  // and the CSS.
  const swatch = useResolvedColor(label.color);

  return (
    <li
      // K100 deep-link anchor (`/settings/labels#row-<id>`) — see
      // useScrollToHash. Kept alongside the test id.
      id={`row-${label.id}`}
      data-testid={`label-row-${label.id}`}
      data-label-archived={archived ? "true" : "false"}
      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
    >
      <span
        aria-hidden="true"
        data-testid="label-swatch"
        data-label-color={swatch ?? ""}
        className="h-4 w-4 shrink-0 rounded-full border border-border-subtle"
        style={{ backgroundColor: swatch ?? "transparent" }}
      />

      <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
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
        className="w-24 shrink-0 text-right text-[0.8571rem] text-text-secondary"
      >
        {String(count)} task{count === 1 ? "" : "s"}
      </span>

      <RowActions
        label={`Actions for label ${label.name}`}
        actions={[
          { label: "Edit…", testId: "label-edit", onSelect: () => { setEditing(true); } },
          {
            label: archived ? "Unarchive" : "Archive",
            testId: "label-archive-toggle",
            disabled: archive.isPending,
            onSelect: () => { archive.reset(); archive.mutate({ id: label.id, archived: !archived }); },
          },
          { label: "Delete", testId: "label-delete", danger: true, onSelect: () => { setConfirmingDelete(true); } },
        ]}
      />

      {/* An archive/unarchive that fails must say so — the toggle used to
          swallow the error and read as done while nothing changed on disk
          (mirrors MilestonesPanel's bug-3 fix). */}
      {archive.isError && (
        <Callout tone="danger" role="alert" testId="label-archive-error" className="basis-full">
          {archive.error instanceof ApiError ? archive.error.message : "Could not change the archived state."}
        </Callout>
      )}

      {editing && (
        <LabelEditDialog
          mode="edit"
          existing={label}
          onClose={() => { setEditing(false); }}
        />
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

/**
 * DEG-30 / UX-13: a label whose stored fields do not validate (a
 * non-string `name`, an unknown key) is lifted by the tolerant loader
 * into `broken` rather than dropped. It renders here as a disabled,
 * marked error row — "⚠ <id> — couldn't be read (<reason>)" — so it is
 * visible and repairable instead of vanishing from the list with no
 * notice.
 *
 * The affordance is **Repair**, mirroring the workflow broken block
 * (SET-33) and the sprints broken block: LocTT never rewrites a corrupt
 * config entry for you (that would be a silent rewrite — corruption-guide
 * rule 3), so the row names the file and the exact validator error and
 * offers a reload-from-disk once the file is fixed by hand. A Delete
 * affordance is deliberately not offered: core's `deleteLabel` only
 * removes entries present in `config.labels`, and a broken entry may not
 * even carry a readable `id` — a Delete button here would be a dead
 * control. See decisions.md §8 (DEG-30).
 */
function BrokenLabelRow({ entry, onRepair, repairing }: {
  readonly entry: BrokenEntry;
  readonly onRepair: () => void;
  readonly repairing: boolean;
}) {
  // Name the entry by its id when the loader could read one, otherwise by
  // its position in the file (BrokenEntry drops `id` only when the id
  // itself is what failed to validate).
  const name = entry.id ?? `Label entry #${String(entry.index + 1)}`;
  return (
    <li
      // K100 anchor: a deep link to a label lands here even when the
      // entry is broken, so it resolves by the same `row-<id>` id (only
      // when the loader could read an id).
      {...(entry.id !== undefined ? { id: `row-${entry.id}` } : {})}
      data-testid={`label-broken-${entry.id ?? `index-${String(entry.index)}`}`}
      data-broken-label={entry.id ?? `index-${String(entry.index)}`}
      aria-disabled="true"
      className="flex items-start gap-2 border-b border-border-subtle py-2 text-danger-fg last:border-0"
    >
      <span aria-hidden="true" className="shrink-0 pt-0.5">⚠</span>
      <div className="min-w-0 flex-1">
        <span className="text-[0.9286rem] font-medium">{name}</span>
        <span className="text-text-tertiary"> — couldn't be read</span>
        <span className="ml-1 text-[0.8571rem] text-danger-fg/90">
          ({entry.error})
        </span>
        <p className="mt-0.5 text-[0.8571rem] text-text-secondary">
          Fix this entry in{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
            .loctt/config/labels.yaml
          </code>{" "}
          and reload — LocTT will not rewrite it for you.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        testId={`label-broken-repair-${entry.id ?? `index-${String(entry.index)}`}`}
        disabled={repairing}
        onClick={onRepair}
        className="shrink-0"
      >
        Repair
      </Button>
    </li>
  );
}

export function LabelsPanel() {
  const [creating, setCreating] = useState(false);
  // K107: this panel had NO archived control before — archived labels
  // rendered inline with an `(archived)` marker. It now defaults to the
  // `active` scope and reveals archived through the tri-state control. A
  // deep-link hash widens the fetch to `all` so a `#row-<id>` anchor to an
  // archived label still resolves (K100).
  const [scope, setScope] = useState<ArchivedScope>("active");
  const [hashPresent] = useState(hashDeepLinkPresent);
  const effectiveScope: ArchivedScope = hashPresent ? "all" : scope;
  const labels = useCountedLabels(effectiveScope);

  if (labels.isError) {
    /*
      MSL-31: a labels.yaml that will not parse is NOT an empty list.
      The error names the file and carries the loader's own violation
      text (e.g. `duplicate label id: <id>`), and the panel is visibly a
      failure state rather than a tracker with no labels.
    */
    const envelope = labels.error instanceof ApiError ? labels.error.envelope : undefined;
    return (
      <div data-testid="labels-panel">
        <SettingsPanelHeader title="Labels" />
        <div data-testid="labels-load-error" data-labels-state="load-failed">
          <ErrorState
            error={labels.error}
            onRetry={() => { void labels.refetch(); }}
            context="reading .loctt/config/labels.yaml"
          />
          <p className="mt-2 text-[0.9286rem] text-text-secondary">
            This is a failure to read the file, not an empty label list. Fix{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
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
    return <LoadingState>Loading labels…</LoadingState>;
  }

  const items = labels.data.items;
  const broken = labels.data.broken ?? [];

  return (
    <div data-testid="labels-panel">
      <SettingsPanelHeader
        title="Labels"
        actions={(
          <>
            {/* Ken's ruling, 2026-09-22 (decisions.md § 9): demoted behind
                an icon reveal, not a permanently visible segmented
                control — see ArchivedScopeReveal. */}
            <ArchivedScopeReveal
              testId="labels-archived-scope"
              panelLabel="labels"
              value={scope}
              onChange={setScope}
            />
            <Button
              variant="primary"
              testId="label-create-open"
              onClick={() => { setCreating(true); }}
            >
              New label
            </Button>
          </>
        )}
      />
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Task counts exclude archived tasks.
      </p>

      {creating && (
        <LabelEditDialog
          mode="create"
          existingLabels={items}
          onClose={() => { setCreating(false); }}
        />
      )}

      {items.length === 0 && broken.length === 0
        ? (
            // Distinct from the load failure above: this one really is
            // an empty file (MSL-31's "visually distinct"). A lone broken
            // entry is NOT empty (DEG-30 / A138) — the list renders below.
            <p data-testid="labels-empty" data-labels-state="empty" className="text-[0.9286rem] text-text-tertiary">
              {scope === "archived" ? "No archived labels." : "No labels yet. Create one above."}
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
              {/*
                DEG-30: broken entries render as marked error rows after
                the healthy ones, so a corrupt label is shown and
                repairable rather than silently omitted.
              */}
              {broken.map(entry => (
                <BrokenLabelRow
                  key={`broken-${entry.id ?? `index-${String(entry.index)}`}`}
                  entry={entry}
                  repairing={labels.isFetching}
                  onRepair={() => { void labels.refetch(); }}
                />
              ))}
            </ul>
          )}
    </div>
  );
}
