import type { CardLayoutField, UserSettings } from "@loctt/contracts";
import { CARD_LAYOUT_FIELDS } from "@loctt/contracts";

import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { DEFAULT_CARD_LAYOUT, resolveCardLayout } from "../board/cardLayout.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";

/**
 * Settings → Personal → Card layout (SET-12, SET-26, CW-17).
 *
 * `card_layout` is one ordered array where position is the render
 * order and absence from the array is hidden, so this editor is a
 * single drag list with a visible/hidden toggle per row — not a list
 * plus a separate visibility map that could drift from it.
 *
 * ## Every field is a row, visible or not
 *
 * A hidden field still needs somewhere to be turned back on. So the
 * rows are all of `CARD_LAYOUT_FIELDS`: the visible ones first in
 * their stored order, then the hidden ones. Only the visible prefix is
 * written.
 *
 * ## SET-26: hiding everything is allowed, and stays legible
 *
 * The case gives two acceptable answers and asks for one of them: the
 * key remains an un-hideable anchor, *or* the editor blocks hiding the
 * last field with a stated reason. This takes neither: the contract
 * already models an explicit empty array as "show nothing but the
 * title", and the title is never a member of `card_layout` — it is
 * always rendered. So the *title* is the anchor, the preview shows
 * exactly what an empty card looks like before saving, and cards never
 * become blank rectangles. The panel says so rather than leaving the
 * user to discover it.
 */

const FIELD_LABELS: Record<CardLayoutField, string> = {
  key: "Key",
  status: "Status",
  priority: "Priority",
  task_type: "Type",
  assignee: "Assignee",
  labels: "Labels",
  due_date: "Due date",
  estimate: "Estimate",
  milestone: "Milestone",
  sprint: "Sprint",
};

/** Sample values for the live preview (SET-12's last bullet). */
const PREVIEW_VALUES: Record<CardLayoutField, string> = {
  key: "T-142",
  status: "In progress",
  priority: "High",
  task_type: "Bug",
  assignee: "Alice",
  labels: "api, urgent",
  due_date: "2026-09-14",
  estimate: "3d",
  milestone: "v2.0",
  sprint: "Sprint 7",
};

export function CardLayoutPanel() {
  const settings = useUserSettings();

  if (settings.isError) {
    return (
      <div className="p-8">
        <h1 className="mb-2 text-lg font-semibold text-text-primary">Card layout</h1>
        <ErrorState
          error={settings.error}
          onRetry={() => { void settings.refetch(); }}
          context="reading your personal settings"
        />
      </div>
    );
  }
  if (settings.isLoading || settings.data === undefined) {
    return <div className="p-8 text-[13px] text-text-tertiary">Loading card layout…</div>;
  }
  return <CardLayoutEditor stored={settings.data.settings} />;
}

function CardLayoutEditor({ stored }: { readonly stored: UserSettings }) {
  const save = useUserSettingsMutation();
  // The rendered order is the *stored* order, not a local draft: a
  // failed write rolls the cache back and the list must follow it
  // (BRD-47), which it can only do with one source of truth.
  const visible = resolveCardLayout(stored);
  const hidden = CARD_LAYOUT_FIELDS.filter(f => !visible.includes(f));
  const rows: readonly CardLayoutField[] = [...visible, ...hidden];

  const write = (next: readonly CardLayoutField[]): void => {
    save.mutate({ ...stored, card_layout: [...next] } as UserSettings);
  };

  const onMove = (from: number, to: number): void => {
    // Reordering is only meaningful among the visible fields; the
    // hidden tail has no render order to change.
    if (from >= visible.length || to >= visible.length) return;
    const next = [...visible];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    write(next);
  };

  const toggle = (field: CardLayoutField): void => {
    write(
      visible.includes(field)
        ? visible.filter(f => f !== field)
        : [...visible, field],
    );
  };

  return (
    <div className="p-8" data-testid="card-layout-panel">
      <h1 className="mb-1 text-lg font-semibold text-text-primary">Card layout</h1>
      <p className="mb-6 max-w-prose text-[12px] text-text-secondary">
        Which fields board cards show, and in what order. Saved against your
        user — other people&rsquo;s boards are unaffected. The task title is
        always shown and cannot be hidden, so a card is never blank.
      </p>

      <div className="flex flex-wrap gap-8">
        <div className="min-w-[18rem] flex-1">
          <ReorderableRows
            items={rows}
            rowKey={f => f}
            rowLabel={f => FIELD_LABELS[f]}
            onMove={onMove}
            testIdPrefix="card-field"
          >
            {(field, i) => {
              const isVisible = i < visible.length;
              return (
                <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1">
                  <span className="flex-1 text-[13px] text-text-primary">
                    {FIELD_LABELS[field]}
                  </span>
                  <button
                    type="button"
                    data-testid={`card-field-toggle-${field}`}
                    aria-pressed={isVisible}
                    onClick={() => { toggle(field); }}
                    className={
                      "rounded px-2 py-0.5 text-[12px] "
                      + (isVisible
                        ? "bg-accent-muted text-accent"
                        : "bg-bg-muted text-text-tertiary")
                    }
                  >
                    {isVisible ? "Visible" : "Hidden"}
                  </button>
                </div>
              );
            }}
          </ReorderableRows>

          <button
            type="button"
            data-testid="card-layout-reset"
            onClick={() => { write(DEFAULT_CARD_LAYOUT); }}
            className="mt-3 text-[12px] text-accent hover:underline"
          >
            Reset to the default layout
          </button>
        </div>

        {/* SET-12's last bullet, and SET-26's first: the outcome is
            visible before leaving the panel — including the outcome of
            hiding everything. */}
        <div className="w-64">
          <h2 className="mb-2 text-[13px] font-semibold text-text-primary">Preview</h2>
          <div
            data-testid="card-layout-preview"
            className="rounded-lg border border-border-subtle bg-bg-surface p-3"
          >
            <div className="mb-1 text-[13px] font-medium text-text-primary">
              Rewrite the export pipeline
            </div>
            {visible.length === 0 ? (
              <p
                data-testid="card-layout-preview-empty"
                className="text-[11px] italic text-text-tertiary"
              >
                Title only — every field is hidden. Cards stay clickable.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {visible.map(f => (
                  <span
                    key={f}
                    data-preview-field={f}
                    className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary"
                  >
                    {PREVIEW_VALUES[f]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {save.isError ? (
        <p role="alert" className="mt-4 text-[12px] text-danger-fg">
          The layout was not saved. The list shows your last saved layout.
        </p>
      ) : null}
    </div>
  );
}
