import type { SavedQuery, UserSettings } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useViews } from "../api/hooks/sidebarData.ts";
import { useDeleteView } from "../api/hooks/useDeleteView.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { DeleteViewDialog } from "./DeleteViewDialog.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { readSidebarPins, sweepSidebarPins } from "./sidebarPins.ts";

/**
 * Settings → Personal → Sidebar pins (SET-13, SET-27).
 *
 * ## The sweep explains itself
 *
 * SET-13's third bullet says a pin whose view was deleted is "dropped
 * **silently**". That text is superseded. The README's P7 amendment
 * (`docs/dev/ui-test-cases/README.md:191-198`) resolves the
 * SHL-32 / SET-13 / SET-27 / XS-28 disagreement *in favour of the
 * explaining cases*: "a pinned view deleted from `queries.yaml` tells
 * the user it was removed rather than disappearing. Silently pruning a
 * preference is still drift the user cannot account for."
 *
 * So SET-27 governs, and this panel names what it removed. SET-13's
 * other three bullets — the drag list, the persisted order, and *not*
 * sweeping a view that merely matches zero tasks — hold as written.
 *
 * ## The sweep writes, so it does not re-run every load
 *
 * SET-27's third bullet: `settings.yaml` is rewritten to drop the dead
 * references. The write is fired once per set of dead ids, guarded by
 * a ref — the settings query invalidates on success, so an unguarded
 * effect would sweep, re-read, and sweep again.
 *
 * The removed ids stay on screen after the write, because the message
 * is the point: rewriting the file and *then* rendering nothing is the
 * silent emptying SET-27 forbids.
 */

export function SidebarPinsPanel() {
  const settings = useUserSettings();
  const views = useViews();

  if (settings.isError || views.isError) {
    return (
      <div>
        <h1 className="mb-2 text-lg font-semibold text-text-primary">Pinned views</h1>
        <ErrorState
          error={settings.error ?? views.error}
          onRetry={() => {
            void settings.refetch();
            void views.refetch();
          }}
          context="reading your pinned views"
        />
      </div>
    );
  }
  // Both are needed before anything can be called stale: a view list
  // that has not arrived is not an empty one, and sweeping against it
  // would delete every pin the user has.
  if (settings.data === undefined || !views.isSuccess) {
    return <LoadingState>Loading pins…</LoadingState>;
  }
  return <PinsEditor stored={settings.data.settings} views={views.data.queries} />;
}

function PinsEditor({
  stored,
  views,
}: {
  readonly stored: UserSettings;
  readonly views: readonly SavedQuery[];
}) {
  const save = useUserSettingsMutation();
  const pins = readSidebarPins(stored);
  const sweep = sweepSidebarPins(pins, views.map(v => v.id));

  // What the sweep took, kept on screen across the rewrite that
  // follows it. Derived state would vanish the moment the write
  // landed — which is exactly the silent emptying SET-27 forbids.
  const [explained, setExplained] = useState<readonly string[]>([]);
  const sweptFor = useRef<string | null>(null);

  useEffect(() => {
    if (!sweep.changed) return;
    const signature = sweep.removed.join(",");
    if (sweptFor.current === signature) return;
    sweptFor.current = signature;
    setExplained(prev => [...prev, ...sweep.removed.filter(id => !prev.includes(id))]);
    save.mutate({ ...stored, sidebar_pins: sweep.kept } as UserSettings);
  }, [sweep.changed, sweep.removed, sweep.kept, stored, save]);

  // VUE-38: deleting a view from the panel that manages its pin. The
  // pin is dropped in the same write path — `queries.yaml` loses the
  // view, and the sweep above removes the now-dangling pin on the
  // refetch the invalidation triggers.
  const [deleting, setDeleting] = useState<SavedQuery | null>(null);
  const deleteView = useDeleteView();

  const byId = new Map(views.map(v => [v.id, v]));
  const pinned = sweep.kept;
  const unpinned = views.filter(v => !pinned.includes(v.id));

  const write = (next: readonly string[]): void => {
    save.mutate({ ...stored, sidebar_pins: [...next] } as UserSettings);
  };

  const onMove = (from: number, to: number): void => {
    const next = [...pinned];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    write(next);
  };

  return (
    <div data-testid="sidebar-pins-panel">
      <h1 className="mb-1 text-lg font-semibold text-text-primary">Pinned views</h1>
      <p className="mb-2 max-w-prose text-[0.8571rem] text-text-secondary">
        Pin your own saved views to the top of the sidebar's Saved filters
        group, in the order they appear there. Saved against your user.
      </p>
      {/* A244: cross-link to the sibling section. See the matching note in
          SidebarGroupsPanel — this points at the *groups* editor for the
          user who wants to reorder or hide the built-in sections instead. */}
      <p className="mb-6 max-w-prose text-[0.8571rem] text-text-tertiary">
        Looking to reorder or hide the sidebar's built-in sections?{" "}
        <Link
          to="/settings/$section"
          params={{ section: "sidebar-groups" }}
          data-testid="sidebar-pins-see-groups"
          className="text-accent hover:underline"
        >
          See Sidebar groups
        </Link>
        .
      </p>

      {explained.length > 0 ? (
        /* SET-27's second bullet. `role="status"`, not `alert`: a view
           the user deleted themselves is not an error, and P4 keeps
           toasts for things that interrupt. */
        <div
          role="status"
          data-testid="pins-swept-notice"
          className="mb-4 rounded-md border border-border-subtle bg-warn-bg px-3 py-2 text-[0.8571rem] text-warn-fg"
        >
          {explained.length === 1
            ? "A pinned view was removed because it no longer exists in your saved views:"
            : "Pinned views were removed because they no longer exist in your saved views:"}
          <ul className="mt-1 mb-0 list-disc pl-5">
            {explained.map(id => (
              <li key={id} data-swept-pin={id}>{id}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">Pinned</h2>
      {pinned.length === 0 ? (
        <p data-testid="pins-empty" className="mb-6 text-[0.8571rem] italic text-text-tertiary">
          Nothing pinned. Pin a saved view below to give it a fixed place in
          the sidebar.
        </p>
      ) : (
        <div className="mb-6">
          <ReorderableRows
            items={pinned}
            rowKey={id => id}
            rowLabel={id => byId.get(id)?.name ?? id}
            onMove={onMove}
            testIdPrefix="pin"
          >
            {id => (
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1">
                <span className="flex-1 text-[0.9286rem] text-text-primary">
                  {byId.get(id)?.name ?? id}
                </span>
                <button
                  type="button"
                  data-testid={`pin-remove-${id}`}
                  onClick={() => { write(pinned.filter(p => p !== id)); }}
                  className="text-[0.8571rem] text-text-tertiary hover:text-text-primary"
                >
                  Unpin
                </button>
                <button
                  type="button"
                  data-testid={`view-delete-${id}`}
                  onClick={() => {
                    const v = byId.get(id);
                    if (v !== undefined) setDeleting(v);
                  }}
                  className="text-[0.8571rem] text-text-tertiary hover:text-danger-fg"
                >
                  Delete view
                </button>
              </div>
            )}
          </ReorderableRows>
        </div>
      )}

      <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">
        Available saved views
      </h2>
      {unpinned.length === 0 ? (
        <p className="text-[0.8571rem] italic text-text-tertiary">
          Every saved view is pinned.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0">
          {unpinned.map(v => (
            <li
              key={v.id}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1"
            >
              <span className="flex-1 text-[0.9286rem] text-text-primary">{v.name}</span>
              <button
                type="button"
                data-testid={`pin-add-${v.id}`}
                onClick={() => { write([...pinned, v.id]); }}
                className="text-[0.8571rem] text-accent hover:underline"
              >
                Pin
              </button>
              <button
                type="button"
                data-testid={`view-delete-${v.id}`}
                onClick={() => { setDeleting(v); }}
                className="text-[0.8571rem] text-text-tertiary hover:text-danger-fg"
              >
                Delete view
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleting !== null ? (
        <DeleteViewDialog
          name={deleting.name}
          pinned={pinned.includes(deleting.id)}
          onCancel={() => { setDeleting(null); }}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            // The pin goes with the view, in this write rather than on
            // the next sweep: leaving it to the sweep would show the
            // user a "removed because it no longer exists" notice for a
            // deletion they just performed and were already told about.
            if (pinned.includes(id)) {
              sweptFor.current = [...sweep.removed, id].join(",");
              save.mutate({
                ...stored,
                sidebar_pins: pinned.filter(p => p !== id),
              } as UserSettings);
            }
            deleteView.mutate({ id });
          }}
        />
      ) : null}

      {deleteView.isError ? (
        <p role="alert" className="mt-4 text-[0.8571rem] text-danger-fg">
          The view was not deleted. It is still among your saved views.
        </p>
      ) : null}

      {save.isError ? (
        <p role="alert" className="mt-4 text-[0.8571rem] text-danger-fg">
          Your pins were not saved. The list shows your last saved order.
        </p>
      ) : null}
    </div>
  );
}
