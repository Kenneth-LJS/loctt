import type { EntityColor, RelationshipDef } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { isValidEntityColor } from "../ui/entityColor.ts";
import { IconColorFields } from "../ui/IconColorFields.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";
import { isSymmetric } from "./workflowEdits.ts";
import {
  hasNoProblems,
  keyFromLabel,
  type RelationshipDraft,
  validateNewRelationship,
} from "./workflowForms.ts";

/**
 * The Create / Edit dialog for a relationship type (SET-48, and the
 * SET-28/SET-51 edit-model).
 *
 * Collects key + label + symmetric + inverse/inverse_label + graph +
 * ranked (the `RelationshipDef` fields, minus the presentational
 * icon/color). Ticking symmetric hides the inverse fields — the schema
 * rejects a symmetric rel whose `inverse` differs from its `key`. On a
 * failed save the dialog stays open with the error anchored (SET-51);
 * Cancel discards.
 *
 * The key is a `TextField` on create and read-only `code` on edit (a key
 * is permanent).
 */

const GRAPHS = ["none", "acyclic", "tree"] as const;

/**
 * Human labels for the stored graph-constraint keys. Display-only — the
 * value written to `relationship.graph` is still the raw key. The tokens
 * `none`/`acyclic`/`tree` leaked verbatim to the user before. See
 * decisions.md §8.
 */
const GRAPH_LABEL: Record<(typeof GRAPHS)[number], string> = {
  none: "No constraint",
  acyclic: "No cycles allowed",
  tree: "Strict hierarchy (one parent)",
};

export interface RelationshipDialogResult {
  readonly draft: RelationshipDraft;
}

export function RelationshipEditDialog({
  mode,
  existingKeys,
  initial,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly existingKeys: readonly string[];
  readonly initial?: RelationshipDef | undefined;
  readonly pending: boolean;
  readonly error?: string | undefined;
  readonly onSubmit: (result: RelationshipDialogResult) => void;
  readonly onClose: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const [symmetric, setSymmetric] = useState(initial !== undefined ? isSymmetric(initial) : false);
  const [inverse, setInverse] = useState(initial?.inverse ?? "");
  const [inverseLabel, setInverseLabel] = useState(initial?.inverse_label ?? "");
  const [graph, setGraph] = useState<RelationshipDef["graph"]>(initial?.graph ?? "none");
  const [ranked, setRanked] = useState(initial?.ranked === true);
  // Presentational fields — seeded from the row on edit, editable on both
  // create and edit. Previously these were carried straight from `initial`
  // (survived a round-trip) but had no control; now they are set here.
  const [icon, setIcon] = useState<string | undefined>(initial?.icon);
  // K103: the stored `EntityColor` itself; `undefined` is "no colour".
  const [color, setColor] = useState<EntityColor | undefined>(initial?.color);

  const effectiveKey = mode === "create" && !keyTouched ? keyFromLabel(label) : key;

  const draft: RelationshipDraft = {
    key: effectiveKey,
    label,
    symmetric,
    inverse,
    inverse_label: inverseLabel,
    graph,
    ranked,
    icon: icon !== undefined && icon.trim().length > 0 ? icon.trim() : undefined,
    color,
  };

  const problems =
    mode === "create"
      ? validateNewRelationship(draft, existingKeys)
      : {
          ...(label.trim().length === 0 ? { label: "A label is required." } : {}),
          ...(!symmetric && inverse.trim().length === 0
            ? { inverse: "A directional relationship needs an inverse key." }
            : {}),
          ...(!symmetric && inverseLabel.trim().length === 0
            ? { inverse_label: "A directional relationship needs an inverse label." }
            : {}),
        };

  const canSubmit = hasNoProblems(problems)
    && problems.inverse === undefined
    && problems.inverse_label === undefined
    && isValidEntityColor(color)
    && !pending;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({ draft });
  };

  return (
    <ResponsiveDialog
      title={mode === "create" ? "New relationship" : "Edit relationship"}
      onClose={onClose}
      testId="relationships-entry-dialog"
      actions={
        <DialogActions>
          <Button variant="ghost" onClick={onClose} testId="relationships-entry-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={pending}
            aria-label={mode === "create" ? "Add relationship" : "Save"}
            onClick={submit}
            testId="relationships-entry-save"
          >
            {mode === "create" ? "Add relationship" : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-3 text-[0.9286rem]">
        <label className="block">
          <span className="mb-1 block text-text-secondary">Label</span>
          <TextField
            size="sm"
            data-testid="relationships-entry-label"
            value={label}
            invalid={problems.label !== undefined}
            onChange={e => { setLabel(e.target.value); }}
            aria-label="Label for the new relationship"
          />
          {problems.label !== undefined && (
            <span data-testid="relationships-entry-label-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
              {problems.label}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-text-secondary">Key</span>
          {mode === "create" ? (
            <>
              <TextField
                size="sm"
                data-testid="relationships-entry-key"
                value={effectiveKey}
                invalid={problems.key !== undefined}
                onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
                aria-label="Key for the new relationship"
              />
              <span className="mt-1 block text-[0.8571rem] text-text-tertiary">
                A key is permanent — task links store it, so it cannot be renamed later.
              </span>
              {problems.key !== undefined && (
                <span data-testid="relationships-entry-key-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
                  {problems.key}
                </span>
              )}
            </>
          ) : (
            <code
              data-testid="relationships-entry-key-readonly"
              className="inline-block rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary"
            >
              {initial?.key}
            </code>
          )}
        </label>

        <label className="flex items-center gap-2 text-text-secondary">
          <Checkbox
            data-testid="relationships-entry-symmetric"
            checked={symmetric}
            onChange={e => { setSymmetric(e.target.checked); }}
          />
          Symmetric — reads the same from both sides (e.g. relates to).
        </label>

        {!symmetric && (
          <>
            <label className="block">
              <span className="mb-1 block text-text-secondary">Inverse key</span>
              <TextField
                size="sm"
                data-testid="relationships-entry-inverse"
                value={inverse}
                invalid={problems.inverse !== undefined}
                onChange={e => { setInverse(e.target.value); }}
                aria-label="Inverse key"
              />
              {problems.inverse !== undefined && (
                <span data-testid="relationships-entry-inverse-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
                  {problems.inverse}
                </span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-text-secondary">Inverse label</span>
              <TextField
                size="sm"
                data-testid="relationships-entry-inverse-label"
                value={inverseLabel}
                invalid={problems.inverse_label !== undefined}
                onChange={e => { setInverseLabel(e.target.value); }}
                aria-label="Inverse label"
              />
              {problems.inverse_label !== undefined && (
                <span data-testid="relationships-entry-inverse-label-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
                  {problems.inverse_label}
                </span>
              )}
            </label>
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-text-secondary">Graph constraint</span>
          <SelectCombobox
            size="sm"
            testId="relationships-entry-graph"
            value={graph ?? "none"}
            onChange={v => { setGraph(v as RelationshipDef["graph"]); }}
            aria-label="Graph constraint"
            options={GRAPHS.map(g => ({ value: g, label: GRAPH_LABEL[g] }))}
          />
        </label>

        <label className="flex items-center gap-2 text-text-secondary">
          <Checkbox
            data-testid="relationships-entry-ranked"
            checked={ranked}
            onChange={e => { setRanked(e.target.checked); }}
          />
          Ranked — links of this type keep an explicit order.
        </label>

        {/* K104 — see EntryEditDialog. */}
        <IconColorFields
          icon={icon}
          onIconChange={setIcon}
          color={color}
          onColorChange={setColor}
          iconTestId="relationships-entry-icon"
          iconListTestId="relationships-entry-icon-list"
          iconSearchTestId="relationships-entry-icon-search"
          iconClearTestId="relationships-entry-icon-clear"
          colorTestId="relationships-entry-color-picker"
          colorAliasTestId="relationships-entry-color"
          noun="relationship"
        />

        {error !== undefined && (
          <Callout tone="danger" role="alert" testId="relationships-entry-error">
            {error}
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}
