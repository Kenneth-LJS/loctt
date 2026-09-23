import type { EstimationConfig, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
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

const SCALES = ["free", "linear", "fibonacci"] as const;

/**
 * Human labels for the stored scale keys. The value written to
 * `estimation.scale` is the raw key; only the displayed text changes,
 * matching how `UNIT_LABEL` treats units.
 */
const SCALE_LABEL: Record<(typeof SCALES)[number], string> = {
  free: "Free — any value",
  linear: "Linear — 1, 2, 3, …",
  fibonacci: "Fibonacci — 1, 2, 3, 5, 8, …",
};

/**
 * Human labels for the stored unit keys. Only the *displayed* text
 * changes — the value written to `estimation.unit` is still the raw key,
 * so a workflow.yaml the CLI wrote reads back unchanged. `custom_numeric`
 * and `custom_enum` leaked verbatim before (they read as machine tokens
 * to a user choosing an estimation scale). See decisions.md §8.
 */
const UNIT_LABEL: Record<(typeof UNITS)[number], string> = {
  points: "Points",
  hours: "Hours",
  days: "Days",
  custom_numeric: "Custom number scale",
  custom_enum: "Custom label scale",
};

const DEFAULT: EstimationConfig = { enabled: false, unit: "points" };

export function EstimationPanel() {
  return (
    <WorkflowPanelFrame
      title="Estimation"
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

  /**
   * Set or clear one category's weight. An empty input clears that key;
   * clearing the last one drops the whole `weights` map, because the
   * schema rejects an empty `{}` (a zero-entry map would be a silent flat
   * burndown). A non-numeric input is ignored — the field is `type=number`.
   */
  const setWeight = (key: string, raw: string): void => {
    setDraft(prev => {
      const next = { ...(prev.weights ?? {}) };
      if (raw.trim() === "") {
        delete next[key];
      } else {
        const n = Number(raw);
        if (Number.isNaN(n)) return prev;
        next[key] = n;
      }
      if (Object.keys(next).length === 0) {
        const { weights: _weights, ...rest } = prev;
        return rest;
      }
      return { ...prev, weights: next };
    });
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  const presetText = (draft.preset_values ?? []).join(", ");

  return (
    <div className="grid max-w-lg gap-3 text-[0.9286rem]" data-testid="estimation-panel">
      <label className="flex items-center gap-2">
        <Checkbox
          data-testid="estimation-enabled"
          checked={draft.enabled}
          onChange={e => { patch({ enabled: e.target.checked }); }}
        />
        <span>
          Enabled
        </span>
      </label>

      {/* A <div>, not a <label>: the control is a button, which a wrapping
          <label> does not name — the accessible name comes from the
          explicit aria-label below instead. */}
      <div className="grid gap-1">
        <span className="text-text-secondary">Unit</span>
        <SelectCombobox
          testId="estimation-unit"
          value={draft.unit}
          onChange={v => { patch({ unit: v as EstimationConfig["unit"] }); }}
          className="w-56"
          aria-label="Unit"
          options={UNITS.map(u => ({ value: u, label: UNIT_LABEL[u] }))}
        />
      </div>

      <div className="grid gap-1">
        <span className="text-text-secondary">
          Scale
        </span>
        <SelectCombobox
          testId="estimation-scale"
          value={draft.scale ?? "free"}
          onChange={v => {
            const next = v as (typeof SCALES)[number];
            setDraft(prev => {
              // "free" is the implicit default — drop the key rather than
              // storing it, so a workflow.yaml the CLI wrote round-trips.
              if (next === "free") {
                const { scale: _scale, ...rest } = prev;
                return rest;
              }
              return { ...prev, scale: next };
            });
          }}
          className="w-56"
          aria-label="Scale"
          options={SCALES.map(s => ({ value: s, label: SCALE_LABEL[s] }))}
        />
      </div>

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
            className="text-[0.7857rem] text-danger-fg"
          >
            {problems.unit_label}
          </p>
        )}
      </label>

      {draft.unit === "custom_enum" && (
        <label className="grid gap-1">
          <span className="text-text-secondary">
            Preset values <span className="text-text-tertiary">(comma separated)</span>
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
                  // No presets ⇒ no valid weight keys; drop the map too so
                  // a stale weight cannot fail the server's membership check.
                  const { preset_values: _presetValues, weights: _weights, ...rest } = prev;
                  return rest;
                }
                // Prune weights whose key is no longer a preset value —
                // the schema rejects a weight key not in preset_values.
                const allowed = new Set(parts.map(p => String(p)));
                const prunedEntries = Object.entries(prev.weights ?? {})
                  .filter(([k]) => allowed.has(k));
                if (prunedEntries.length === 0) {
                  const { weights: _weights, ...rest } = prev;
                  return { ...rest, preset_values: parts };
                }
                return { ...prev, preset_values: parts, weights: Object.fromEntries(prunedEntries) };
              });
            }}
          />
          {problems.preset_values !== undefined && (
            <p
              id="estimation-preset-values-problem"
              role="alert"
              data-testid="estimation-preset-values-problem"
              className="text-[0.7857rem] text-danger-fg"
            >
              {problems.preset_values}
            </p>
          )}
        </label>
      )}

      {draft.unit === "custom_enum" && (draft.preset_values ?? []).length > 0 && (
        <div className="grid gap-1" data-testid="estimation-weights">
          <span className="text-text-secondary">
            Weights
          </span>
          <div className="grid gap-1">
            {(draft.preset_values ?? []).map(pv => {
              const key = String(pv);
              const current = draft.weights?.[key];
              return (
                <label key={key} className="flex items-center gap-2 text-[0.8571rem]">
                  <span className="w-24 shrink-0 text-text-secondary">{key}</span>
                  <TextField
                    size="sm"
                    type="number"
                    data-testid={`estimation-weight-${key}`}
                    value={current ?? ""}
                    placeholder="—"
                    aria-label={`Weight for ${key}`}
                    onChange={e => { setWeight(key, e.target.value); }}
                    className="w-24"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      <p data-testid="estimation-aggregate-note" className="text-[0.8571rem] text-text-tertiary">
        {draft.unit === "custom_enum"
          ? "In this mode the Estimate control is a select over the preset values, and sprint and milestone aggregates render as counts per category."
          : "In this mode Estimate is a number input suffixed with the unit label, and sprint and milestone aggregates show a sum."}
      </p>

      {save.isError && (
        <p role="alert" data-testid="workflow-save-error" className="text-[0.8571rem] text-danger-fg">
          Your change wasn’t saved: {saveError}
        </p>
      )}
      {save.isSuccess && !save.isPending && (
        <p data-testid="estimation-saved" className="text-[0.8571rem] text-text-tertiary">
          Saved.
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="primary"
          testId="estimation-save"
          disabled={blocked}
          loading={save.isPending}
          aria-label="Save"
          onClick={() => {
            if (blocked) return;
            // SET-28: estimation is a single block, so the fresh
            // document is adopted wholesale and only this block replaced.
            save.mutate({ collection: "estimation", apply: () => draft });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
