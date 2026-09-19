import type { TimelineConfig, TimelineZoom, WorkflowConfig } from "@loctt/contracts";
import { useMemo, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { buildGroupingCatalog } from "../grouping/catalog.ts";
import { GroupByPicker } from "../grouping/GroupByPicker.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Select } from "../ui/Select.tsx";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Tracker → Timeline defaults (TML-14).
 *
 * Authors the persisted DEFAULTS the Timeline view falls back to when a
 * saved view and the URL say nothing (see timeline/settings.ts precedence:
 * url → view → these workflow defaults → built-in). The live toolbar on the
 * Timeline writes only to URL params, so this panel is the only place the
 * defaults themselves are edited.
 *
 * All four fields live in `TimelineConfigSchema` already and save through
 * the generic whole-document workflow write, so this is a UI-only panel
 * (no new core/contract/API). Built-ins when a field is unset: week / none
 * / arrows on.
 *
 * `dependency_relationship` names a relationship key by which the timeline
 * draws dependency arrows. A31/TML-34: a stored key that no longer exists
 * in `relationships` is DELIBERATELY preserved on write (not auto-cleared),
 * so the panel surfaces the dangle as a warning and keeps it selectable —
 * rather than blocking save or silently dropping it — mirroring how the
 * Calendar panel treats an unresolvable timezone.
 */

const ZOOMS: readonly { value: TimelineZoom; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function TimelinePanel() {
  return (
    <WorkflowPanelFrame
      title="Timeline defaults"
      description="How the Timeline view first opens. A saved view or the on-screen toolbar can override any of these; they are the fallback when neither says otherwise."
    >
      {({ workflow }) => <TimelineEditor workflow={workflow} />}
    </WorkflowPanelFrame>
  );
}

function TimelineEditor({ workflow }: { readonly workflow: WorkflowConfig }) {
  const save = useSaveWorkflowCollection<"timeline">();
  const stored = workflow.timeline ?? {};
  const [draft, setDraft] = useState<TimelineConfig>(stored);

  const groupingCatalog = useMemo(() => buildGroupingCatalog(workflow), [workflow]);
  const relationships = workflow.relationships ?? [];
  const dep = draft.dependency_relationship ?? "";
  // A stored dependency key that is not among the current relationships is
  // a dangle — kept, marked, and offered so the user can see and fix it.
  const depDangling = dep !== "" && !relationships.some(r => r.key === dep);

  const patch = (next: Partial<TimelineConfig>): void => {
    setDraft(prev => ({ ...prev, ...next }));
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  return (
    <div className="grid max-w-lg gap-3 text-[0.9286rem]" data-testid="timeline-panel">
      <label className="grid gap-1">
        <span className="text-text-secondary">Default zoom</span>
        <Select
          data-testid="timeline-default-zoom"
          value={draft.default_zoom ?? "week"}
          onChange={e => { patch({ default_zoom: e.target.value as TimelineZoom }); }}
          className="w-56"
        >
          {ZOOMS.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
        </Select>
      </label>

      <label className="grid gap-1">
        <span className="text-text-secondary">Default grouping</span>
        <GroupByPicker
          catalog={groupingCatalog}
          value={draft.default_grouping ?? "none"}
          onChange={g => {
            setDraft(prev => {
              if (g === "none") {
                const { default_grouping: _drop, ...rest } = prev;
                return rest;
              }
              return { ...prev, default_grouping: g };
            });
          }}
          size="md"
          testIdBase="timeline-default-grouping"
          aria-label="Default grouping"
        />
      </label>

      <label className="flex items-center gap-2">
        <Checkbox
          data-testid="timeline-show-arrows"
          checked={draft.show_arrows ?? true}
          onChange={e => { patch({ show_arrows: e.target.checked }); }}
        />
        <span>
          Show dependency arrows
          <span className="ml-1 text-text-tertiary">
            — draw lines between tasks linked by the relationship below.
          </span>
        </span>
      </label>

      <label className="grid gap-1">
        <span className="text-text-secondary">
          Dependency relationship
          <span className="ml-1 text-text-tertiary">— which link drives the arrows</span>
        </span>
        <Select
          data-testid="timeline-dependency-relationship"
          value={dep}
          onChange={e => {
            const v = e.target.value;
            setDraft(prev => {
              if (v === "") {
                const { dependency_relationship: _drop, ...rest } = prev;
                return rest;
              }
              return { ...prev, dependency_relationship: v };
            });
          }}
          className="w-56"
        >
          <option value="">(none)</option>
          {relationships.map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
          {/* Keep the dangling key selectable so it is visible and not
              silently dropped when the form is saved. */}
          {depDangling && <option value={dep}>{dep} — no longer defined</option>}
        </Select>
        {depDangling && (
          <p
            data-testid="timeline-dependency-unresolvable"
            role="alert"
            className="text-[0.7857rem] text-warn-fg"
          >
            “{dep}” is not one of the current relationships. Arrows will not
            draw until you pick an existing relationship (or clear this).
          </p>
        )}
      </label>

      {save.isError && (
        <p role="alert" data-testid="workflow-save-error" className="text-[0.8571rem] text-danger-fg">
          Your change wasn’t saved: {saveError}
        </p>
      )}
      {save.isSuccess && !save.isPending && (
        <p data-testid="timeline-saved" className="text-[0.8571rem] text-text-tertiary">
          Saved.
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="primary"
          testId="timeline-save"
          disabled={save.isPending}
          onClick={() => {
            // Timeline is a single block: adopt the fresh document and
            // replace only this block (mirrors EstimationPanel / SET-28).
            save.mutate({ collection: "timeline", apply: () => draft });
          }}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
