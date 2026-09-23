import type { TimelineConfig, TimelineGrouping, TimelineZoom, WorkflowConfig } from "@loctt/contracts";
import { TimelineGroupingSchema } from "@loctt/contracts";
import { useMemo, useState } from "react";

/**
 * The stored `default_grouping` is typed `string` (zod widens the
 * builtin-enum ∪ `field.<key>` union to `string`), but the picker's
 * `value` is a `TimelineGrouping`. This re-validates the stored value
 * against the same schema — a well-formed value (including a dangling
 * `field.<deleted>`, which the picker deliberately keeps selectable) is
 * kept; only a genuinely malformed value falls back to "none".
 */
function asGrouping(value: string | undefined): TimelineGrouping {
  return TimelineGroupingSchema.safeParse(value).success
    ? (value as TimelineGrouping)
    : "none";
}

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { buildGroupingCatalog } from "../grouping/catalog.ts";
import { GroupByPicker } from "../grouping/GroupByPicker.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
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
      <div className="grid gap-1">
        <span className="text-text-secondary">Default zoom</span>
        <SelectCombobox
          testId="timeline-default-zoom"
          value={draft.default_zoom ?? "week"}
          onChange={v => { patch({ default_zoom: v as TimelineZoom }); }}
          className="w-56"
          aria-label="Default zoom"
          options={ZOOMS.map(z => ({ value: z.value, label: z.label }))}
        />
      </div>

      <label className="grid gap-1">
        <span className="text-text-secondary">Default grouping</span>
        <GroupByPicker
          catalog={groupingCatalog}
          value={asGrouping(draft.default_grouping)}
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

      <div id="field-dependency_relationship" className="grid gap-1">
        <span className="text-text-secondary">
          Dependency relationship
          <span className="ml-1 text-text-tertiary">— which link drives the arrows</span>
        </span>
        <SelectCombobox
          testId="timeline-dependency-relationship"
          value={dep}
          onChange={v => {
            setDraft(prev => {
              if (v === "") {
                const { dependency_relationship: _drop, ...rest } = prev;
                return rest;
              }
              return { ...prev, dependency_relationship: v };
            });
          }}
          className="w-56"
          aria-label="Dependency relationship"
          options={[
            { value: "", label: "(none)" },
            ...relationships.map(r => ({ value: r.key, label: r.label })),
            // Keep the dangling key selectable so it is visible and not
            // silently dropped when the form is saved.
            ...(depDangling ? [{ value: dep, label: `${dep} — no longer defined` }] : []),
          ]}
        />
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
      </div>

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
          loading={save.isPending}
          aria-label="Save"
          onClick={() => {
            // Timeline is a single block: adopt the fresh document and
            // replace only this block (mirrors EstimationPanel / SET-28).
            save.mutate({ collection: "timeline", apply: () => draft });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
