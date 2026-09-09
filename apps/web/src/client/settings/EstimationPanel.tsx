import type { EstimationConfig, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import { validateEstimation } from "./workflowEdits.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Workflow → Estimation (SET-9, SET-35).
 *
 * The save is blocked client-side with the error attached to the field
 * that is missing, not delivered as a generic toast (SET-35). That
 * duplicates rules the server also enforces — `EstimationConfigSchema`
 * has the same two `superRefine` issues — and the duplication is the
 * point: a 400's envelope carries one field path, and SET-9 wants the
 * panel to say *which* field is missing while the user is still in it.
 *
 * Nothing is written while blocked: the mutation is never called, so
 * SET-35's "nothing is written" is a fact about the request, not about
 * the server having rejected it.
 */

const UNITS = ["points", "hours", "days", "custom_numeric", "custom_enum"] as const;

const DEFAULT: EstimationConfig = { enabled: false, unit: "points" };

export function EstimationPanel() {
  return (
    <WorkflowPanelFrame
      title="Estimation"
      description="How a task's estimate is expressed. Numeric units aggregate as a sum; custom_enum aggregates as counts per category."
    >
      {({ workflow }) => <EstimationEditor workflow={workflow} />}
    </WorkflowPanelFrame>
  );
}

function EstimationEditor({ workflow }: { readonly workflow: WorkflowConfig }) {
  const save = useSaveWorkflowCollection<"estimation">();
  const stored = workflow.estimation ?? DEFAULT;
  const [draft, setDraft] = useState<EstimationConfig>(stored);

  const problems = validateEstimation(draft);
  const blocked = problems.unit_label !== undefined || problems.preset_values !== undefined;

  const patch = (next: Partial<EstimationConfig>): void => {
    setDraft(prev => ({ ...prev, ...next }));
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  const presetText = (draft.preset_values ?? []).join(", ");

  return (
    <div className="grid max-w-lg gap-3 text-[13px]" data-testid="estimation-panel">
      <label className="flex items-center gap-2">
        <Checkbox
          data-testid="estimation-enabled"
          checked={draft.enabled}
          onChange={e => { patch({ enabled: e.target.checked }); }}
        />
        <span>
          Enabled
          <span className="ml-1 text-text-tertiary">
            — when off, no Estimate field appears on task detail, in the
            create modal, or as a list column.
          </span>
        </span>
      </label>

      <label className="grid gap-1">
        <span className="text-text-secondary">Unit</span>
        <Select
          data-testid="estimation-unit"
          value={draft.unit}
          onChange={e => { patch({ unit: e.target.value as EstimationConfig["unit"] }); }}
          className="w-56"
        >
          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </Select>
      </label>

      <label className="grid gap-1">
        <span className="text-text-secondary">
          Unit label
          {(draft.unit === "custom_numeric" || draft.unit === "custom_enum") && (
            <span className="ml-1 text-danger-fg">required</span>
          )}
        </span>
        <TextField
          data-testid="estimation-unit-label"
          value={draft.unit_label ?? ""}
          invalid={problems.unit_label !== undefined}
          aria-describedby={problems.unit_label !== undefined ? "estimation-unit-label-problem" : undefined}
          onChange={e => {
            const v = e.target.value;
            setDraft(prev => {
              if (v === "") {
                const { unit_label: _unitLabel, ...rest } = prev;
                return rest;
              }
              return { ...prev, unit_label: v };
            });
          }}
          className="w-56"
        />
        {problems.unit_label !== undefined && (
          <p
            id="estimation-unit-label-problem"
            role="alert"
            data-testid="estimation-unit-label-problem"
            className="text-[11px] text-danger-fg"
          >
            {problems.unit_label}
          </p>
        )}
      </label>

      {draft.unit === "custom_enum" && (
        <label className="grid gap-1">
          <span className="text-text-secondary">
            Preset values <span className="text-text-tertiary">— comma separated</span>
          </span>
          <TextField
            data-testid="estimation-preset-values"
            defaultValue={presetText}
            invalid={problems.preset_values !== undefined}
            aria-describedby={
              problems.preset_values !== undefined ? "estimation-preset-values-problem" : undefined
            }
            onChange={e => {
              const parts = e.target.value
                .split(",")
                .map(s => s.trim())
                .filter(s => s.length > 0);
              setDraft(prev => {
                if (parts.length === 0) {
                  const { preset_values: _presetValues, ...rest } = prev;
                  return rest;
                }
                return { ...prev, preset_values: parts };
              });
            }}
          />
          {problems.preset_values !== undefined && (
            <p
              id="estimation-preset-values-problem"
              role="alert"
              data-testid="estimation-preset-values-problem"
              className="text-[11px] text-danger-fg"
            >
              {problems.preset_values}
            </p>
          )}
        </label>
      )}

      <p data-testid="estimation-aggregate-note" className="text-[12px] text-text-tertiary">
        {draft.unit === "custom_enum"
          ? "In this mode the Estimate control is a select over the preset values, and sprint and milestone aggregates render as counts per category."
          : "In this mode Estimate is a number input suffixed with the unit label, and sprint and milestone aggregates show a sum."}
      </p>

      {save.isError && (
        <p role="alert" data-testid="workflow-save-error" className="text-[12px] text-danger-fg">
          Not saved to .loctt/config/workflow.yaml: {saveError}
        </p>
      )}
      {save.isSuccess && !save.isPending && (
        <p data-testid="estimation-saved" className="text-[12px] text-text-tertiary">
          Saved.
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="primary"
          testId="estimation-save"
          disabled={blocked || save.isPending}
          onClick={() => {
            if (blocked) return;
            // SET-28: estimation is a single block, so the fresh
            // document is adopted wholesale and only this block replaced.
            save.mutate({ collection: "estimation", apply: () => draft });
          }}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
