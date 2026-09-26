import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useLabels, useMilestones, useProjectsScoped, useSprints, useUsersScoped } from "../api/hooks/sidebarData.ts";
import {
  ARCHIVED_KINDS,
  type ArchivedAction,
  type ArchivedItem,
  type ArchivedKind,
  type ArchivedList,
  type BatchOutcome,
  KIND_NOUN,
  useArchivedBatch,
  useArchivedLists,
} from "../api/hooks/useArchived.ts";
import { useDeleteLabel, useDeleteMilestone, useDeleteSprint } from "../api/hooks/useDataMutations.ts";
import { useDeleteProject } from "../api/hooks/useProjectMutations.ts";
import { useDeleteUser } from "../api/hooks/useUserMutations.ts";
import { deleteConfirmWord, LARGE_DELETE_THRESHOLD } from "../list/DeleteConfirmDialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { TypedConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { InlineFailureNotice } from "../ui/InlineFailureNotice.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { DeleteProjectDialog } from "./DeleteProjectDialog.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";
import { UserDeleteDialog } from "./UserDeleteDialog.tsx";

/**
 * Settings → Archived (K121 #1; SET-52, SET-53, SET-54).
 *
 * Ken: *"not allow viewing archived stuff. thats the point of archiving"*
 * … *"archived section in settings, can select entity to view … then you
 * can restore one by one, or mass-select and restore selected, or restore
 * all. or delete all, or select some to delete, or delete one at a
 * time"*. This is the ONLY web surface that lists archived items. It is
 * deliberately plain: a type picker with counts, and a list. No search,
 * no filters, no sort control, no saved views over it.
 *
 * Restore is reversible, so it runs on click. Delete is not:
 *  - one row's Delete opens that entity's own delete dialog (the
 *    remap-or-clear flow of `RemapDeleteDialog` / `DeleteProjectDialog` /
 *    `UserDeleteDialog`), so a referenced item offers the same choices it
 *    does from its own panel;
 *  - a multi-item delete (selected or all), and a task or saved-view row,
 *    is a typed confirmation naming what goes and how many. A batch has no
 *    single remap target, so it clears references, and says so (A331).
 *
 * Every write reports per item (`runArchivedBatch`): the failed ones stay
 * in the list and are named, and an unknown outcome says so (ERR-4).
 */

/** How many names a delete confirmation lists before "and N more". */
const NAMES_SHOWN = 10;

function countOf(kind: ArchivedKind, n: number): string {
  return `${String(n)} ${n === 1 ? KIND_NOUN[kind].one : KIND_NOUN[kind].many}`;
}

/**
 * The one-line result of a restore/delete (messaging.md §2: what
 * happened, and what to do next). Per-item reasons are listed under it.
 */
export function batchHeadline(outcome: BatchOutcome): string {
  const { kind, action } = outcome;
  const s = outcome.succeeded.length;
  const f = outcome.failed.length;
  const verbed = action === "restore" ? "restored" : "deleted";
  const Verbed = action === "restore" ? "Restored" : "Deleted";
  if (f === 0) return `${Verbed} ${countOf(kind, s)}.`;
  const lead = s > 0 ? `${Verbed} ${String(s)} of ${countOf(kind, s + f)}. ` : "";
  const unknown = outcome.failed.filter(x => x.dataState === "unknown").length;
  if (unknown === f) {
    return `${lead}Couldn't confirm ${countOf(kind, f)} ${f === 1 ? "was" : "were"} ${verbed}. Reload to check.`;
  }
  return `${lead}${countOf(kind, f)} ${f === 1 ? "wasn't" : "weren't"} ${verbed}.`;
}

/** The label a row carries: a task's key and title, else the name. */
function itemLabel(item: ArchivedItem): string {
  return item.key !== undefined ? `${item.key} ${item.name}` : item.name;
}

/**
 * What a multi-item delete does to tasks that still reference the items,
 * in the words of each entity's own "clear" choice. `undefined` when
 * nothing references them.
 */
export function referenceConsequence(kind: ArchivedKind, items: readonly ArchivedItem[]): string | undefined {
  if (kind === "tasks") return "Their comments, history and attachments are deleted too.";
  if (kind === "views") return undefined;
  if (kind === "users") {
    return "Tasks assigned to or reported by them lose that assignee or reporter.";
  }
  const refs = items.reduce((n, i) => n + (i.refCount ?? 0), 0);
  if (refs === 0) return undefined;
  const tasks = `${String(refs)} task${refs === 1 ? "" : "s"}`;
  const them = items.length === 1 ? "it" : "them";
  return kind === "projects"
    ? `${tasks} still use ${them}. Those tasks will have no project.`
    : `${tasks} still use ${them}. Deleting removes ${them} from those tasks.`;
}

/** SET-54: a typed confirmation naming what is deleted and how many. */
function BatchDeleteDialog({
  kind,
  items,
  onConfirm,
  onCancel,
}: {
  readonly kind: ArchivedKind;
  readonly items: readonly ArchivedItem[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const word = deleteConfirmWord(items.length);
  const shown = items.slice(0, NAMES_SHOWN);
  const more = items.length - shown.length;
  const consequence = referenceConsequence(kind, items);
  return (
    <TypedConfirmDialog
      title={`Permanently delete ${countOf(kind, items.length)}?`}
      requiredWord={word}
      confirmLabel={`Delete ${countOf(kind, items.length)}`}
      testId="archived-delete-dialog"
      confirmTestId="archived-delete-confirm"
      typeHint={items.length > LARGE_DELETE_THRESHOLD ? "(the count)" : undefined}
      onConfirm={onConfirm}
      onCancel={onCancel}
      body={(
        <>
          <ul data-testid="archived-delete-names" className="m-0 list-disc pl-5">
            {shown.map(i => <li key={i.id}>{itemLabel(i)}</li>)}
          </ul>
          {more > 0 && <p className="mt-1">and {String(more)} more.</p>}
          <p className="mt-2">Deleting is permanent.</p>
          {consequence !== undefined && (
            <p data-testid="archived-delete-consequence" className="mt-2">{consequence}</p>
          )}
        </>
      )}
    />
  );
}

/** One label / milestone / sprint, deleted through `RemapDeleteDialog`. */
function RemapDelete({
  kind,
  item,
  onClose,
}: {
  readonly kind: "labels" | "milestones" | "sprints";
  readonly item: ArchivedItem;
  readonly onClose: () => void;
}) {
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const delLabel = useDeleteLabel();
  const delMilestone = useDeleteMilestone();
  const delSprint = useDeleteSprint();
  const source: readonly { readonly id: string; readonly name: string; readonly archived?: boolean | undefined }[] | undefined =
    kind === "labels" ? labels.data?.items : kind === "milestones" ? milestones.data?.items : sprints.data?.items;
  const del = kind === "labels" ? delLabel : kind === "milestones" ? delMilestone : delSprint;
  // Remap targets are live entities only: never move tasks onto
  // something archived.
  const alternatives = (source ?? [])
    .filter(e => e.id !== item.id && e.archived !== true)
    .map(e => ({ key: e.id, label: e.name }));
  return (
    <RemapDeleteDialog
      noun={KIND_NOUN[kind].one}
      itemLabel={item.name}
      itemKey={item.name}
      count={item.refCount ?? 0}
      alternatives={alternatives}
      pending={del.isPending}
      error={del.isError
        ? (del.error instanceof ApiError ? del.error.message : "Delete failed.")
        : undefined}
      onClose={onClose}
      onConfirm={choice => {
        del.mutate(
          { id: item.id, ...(choice.kind === "remap" ? { remapTo: choice.to } : {}) },
          { onSuccess: onClose },
        );
      }}
    />
  );
}

function ProjectDelete({ item, onClose }: { readonly item: ArchivedItem; readonly onClose: () => void }) {
  const active = useProjectsScoped();
  const mutation = useDeleteProject();
  if (item.project === undefined) return null;
  return (
    <DeleteProjectDialog
      project={item.project}
      taskCount={item.refCount ?? 0}
      others={active.data?.items ?? []}
      mutation={mutation}
      onClose={() => { mutation.reset(); onClose(); }}
    />
  );
}

function UserDelete({ item, onClose }: { readonly item: ArchivedItem; readonly onClose: () => void }) {
  const active = useUsersScoped();
  const mutation = useDeleteUser();
  if (item.user === undefined) return null;
  return (
    <UserDeleteDialog
      user={item.user}
      others={active.data?.items ?? []}
      mutation={mutation}
      onClose={onClose}
    />
  );
}

/** The outcome of the last write: a status line, or a failure notice. */
function OutcomeNotice({
  outcome,
  onRetry,
}: {
  readonly outcome: BatchOutcome;
  readonly onRetry: () => void;
}) {
  const headline = batchHeadline(outcome);
  if (outcome.failed.length === 0) {
    return (
      <p role="status" data-testid="archived-outcome" className="mb-2 text-[0.8571rem] text-text-secondary">
        {headline}
      </p>
    );
  }
  const anyUnknown = outcome.failed.some(f => f.dataState === "unknown");
  return (
    <div className="mb-2">
      <InlineFailureNotice
        testId="archived-failure"
        message={headline}
        dataState={anyUnknown ? "unknown" : "not_saved"}
        // Retrying an item whose outcome is unknown could act twice;
        // the headline says to reload and check instead.
        onRetry={anyUnknown ? undefined : onRetry}
      />
      <ul data-testid="archived-failure-items" className="m-0 mt-1 list-none p-0 text-[0.7857rem] text-danger-fg">
        {outcome.failed.map(f => (
          <li key={f.item.id} data-testid={`archived-failure-item-${f.item.id}`}>
            {itemLabel(f.item)}: {f.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

type PendingDelete =
  | { readonly mode: "batch"; readonly items: readonly ArchivedItem[] }
  | { readonly mode: "entity"; readonly item: ArchivedItem };

/** One type's archived items: the list, selection and every action. */
function KindList({ kind, list }: { readonly kind: ArchivedKind; readonly list: ArchivedList }) {
  const batch = useArchivedBatch();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<BatchOutcome | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | undefined>(undefined);
  const noun = KIND_NOUN[kind];

  if (list.isError) {
    return (
      <div data-testid="archived-load-error">
        <ErrorState error={list.error} onRetry={list.refetch} context={`the archived ${noun.many}`} />
      </div>
    );
  }
  if (list.isLoading) {
    return <LoadingState>Loading archived {noun.many}…</LoadingState>;
  }

  const items = list.items;
  // Only ids still in the list count: a restored or deleted row drops
  // out of the selection with it.
  const selectedItems = items.filter(i => selected.has(i.id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const busy = batch.isPending;

  const run = (action: ArchivedAction, targets: readonly ArchivedItem[]): void => {
    if (targets.length === 0) return;
    setOutcome(undefined);
    batch.mutate(
      { kind, action, items: targets },
      {
        onSuccess: result => {
          setOutcome(result);
          // Keep the failed ones selected so "try again" or a second
          // pass acts on exactly what is left.
          setSelected(new Set(result.failed.map(f => f.item.id)));
        },
      },
    );
  };

  /** Row Delete: the entity's own dialog where it has one (SET-54). */
  const deleteRow = (item: ArchivedItem): void => {
    if (kind === "tasks" || kind === "views") {
      setPendingDelete({ mode: "batch", items: [item] });
    } else {
      setPendingDelete({ mode: "entity", item });
    }
  };

  const toggle = (id: string): void => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div data-testid={`archived-list-${kind}`}>
      {outcome !== undefined && (
        <OutcomeNotice
          outcome={outcome}
          onRetry={() => { run(outcome.action, outcome.failed.map(f => f.item)); }}
        />
      )}

      {items.length === 0
        ? (
            <p data-testid="archived-empty" className="text-[0.9286rem] text-text-tertiary">
              No archived {noun.many}.
            </p>
          )
        : (
            <>
              <div data-testid="archived-toolbar" className="mb-2 flex flex-wrap items-center gap-2">
                <label className="mr-auto flex items-center gap-2 text-[0.8571rem] text-text-secondary">
                  <span className="inline-flex h-4 w-4">
                    <Checkbox
                      data-testid="archived-select-all"
                      aria-label={`Select all archived ${noun.many}`}
                      checked={allSelected}
                      indeterminate={selectedItems.length > 0 && !allSelected}
                      onChange={() => {
                        setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
                      }}
                    />
                  </span>
                  {selectedItems.length > 0 ? `${String(selectedItems.length)} selected` : "Select all"}
                </label>
                {selectedItems.length > 0
                  ? (
                      <>
                        <Button
                          size="sm"
                          testId="archived-restore-selected"
                          disabled={busy}
                          onClick={() => { run("restore", selectedItems); }}
                        >
                          Restore selected
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          testId="archived-delete-selected"
                          disabled={busy}
                          onClick={() => { setPendingDelete({ mode: "batch", items: selectedItems }); }}
                        >
                          Delete selected
                        </Button>
                      </>
                    )
                  : (
                      <>
                        <Button
                          size="sm"
                          testId="archived-restore-all"
                          disabled={busy}
                          onClick={() => { run("restore", items); }}
                        >
                          Restore all
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          testId="archived-delete-all"
                          disabled={busy}
                          onClick={() => { setPendingDelete({ mode: "batch", items }); }}
                        >
                          Delete all
                        </Button>
                      </>
                    )}
              </div>

              <ul className="m-0 list-none p-0" data-testid="archived-items">
                {items.map(item => (
                  <li
                    key={item.id}
                    data-testid={`archived-row-${item.id}`}
                    className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
                  >
                    <span className="inline-flex h-4 w-4 shrink-0">
                      <Checkbox
                        data-testid={`archived-select-${item.id}`}
                        aria-label={`Select ${itemLabel(item)}`}
                        checked={selected.has(item.id)}
                        onChange={() => { toggle(item.id); }}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
                      {item.key !== undefined && (
                        <span className="mr-2 text-text-tertiary">{item.key}</span>
                      )}
                      {item.name}
                    </span>
                    {item.archivedAt !== undefined && (
                      <span
                        data-testid="archived-at"
                        className="shrink-0 whitespace-nowrap text-[0.8571rem] text-text-secondary"
                      >
                        Archived {item.archivedAt.slice(0, 10)}
                      </span>
                    )}
                    <RowActions
                      label={`Actions for archived ${noun.one} ${itemLabel(item)}`}
                      actions={[
                        {
                          label: "Restore",
                          testId: `archived-restore-${item.id}`,
                          disabled: busy,
                          onSelect: () => { run("restore", [item]); },
                        },
                        {
                          label: "Delete",
                          testId: `archived-delete-${item.id}`,
                          danger: true,
                          disabled: busy,
                          onSelect: () => { deleteRow(item); },
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

      {pendingDelete?.mode === "batch" && (
        <BatchDeleteDialog
          kind={kind}
          items={pendingDelete.items}
          onCancel={() => { setPendingDelete(undefined); }}
          onConfirm={() => {
            const targets = pendingDelete.items;
            setPendingDelete(undefined);
            run("delete", targets);
          }}
        />
      )}
      {pendingDelete?.mode === "entity" && (kind === "labels" || kind === "milestones" || kind === "sprints") && (
        <RemapDelete kind={kind} item={pendingDelete.item} onClose={() => { setPendingDelete(undefined); }} />
      )}
      {pendingDelete?.mode === "entity" && kind === "projects" && (
        <ProjectDelete item={pendingDelete.item} onClose={() => { setPendingDelete(undefined); }} />
      )}
      {pendingDelete?.mode === "entity" && kind === "users" && (
        <UserDelete item={pendingDelete.item} onClose={() => { setPendingDelete(undefined); }} />
      )}
    </div>
  );
}

export function ArchivedPanel() {
  const lists = useArchivedLists();
  const [kind, setKind] = useState<ArchivedKind>("tasks");

  return (
    <div data-testid="archived-panel">
      <SettingsPanelHeader title="Archived" />

      {/* SET-52: every archivable type, each with its archived count. A
          plain group of toggle buttons; the pressed one is the list shown. */}
      <div role="group" aria-label="Archived item type" className="mb-4 flex flex-wrap gap-2">
        {ARCHIVED_KINDS.map(k => {
          const l = lists[k];
          const count = l.isLoading || l.isError ? undefined : l.items.length;
          return (
            <Button
              key={k}
              size="sm"
              variant={k === kind ? "primary" : "secondary"}
              testId={`archived-kind-${k}`}
              aria-pressed={k === kind}
              data-count={count === undefined ? "" : String(count)}
              onClick={() => { setKind(k); }}
            >
              {KIND_NOUN[k].title}
              {count !== undefined && ` (${String(count)})`}
            </Button>
          );
        })}
      </div>

      {/* Keyed by type so selection and the last outcome reset on switch. */}
      <KindList key={kind} kind={kind} list={lists[kind]} />
    </div>
  );
}
