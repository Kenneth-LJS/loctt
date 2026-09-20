import type { CustomFieldDef, CustomFieldType } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ColorInput } from "../ui/ColorInput.tsx";
import { Combobox, ComboboxButton, type ComboboxOption } from "../ui/Combobox.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { IconPicker } from "../ui/IconPicker.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import {
  buildCustomField,
  type CustomFieldDraft,
  hasNoProblems,
  keyFromLabel,
  validateNewCustomField,
} from "./workflowForms.ts";

/**
 * The Create / Edit dialog for a custom field (SET-49, SET-16, SET-51).
 *
 * Create collects key + label + type + multi + searchable + enum values
 * with weights. Edit keeps **type and multi locked** (SET-16): the
 * controls are disabled and state why (task files already store values
 * under this type; the server rejects a change too). Label, searchable
 * and — for an enum — the value labels/weights stay editable, so the
 * lock reads as targeted rather than a frozen row.
 *
 * A failed save keeps the dialog open with the error anchored in a
 * `Callout` (SET-51). Cancel discards.
 */

const TYPES = ["string", "number", "date", "boolean", "enum"] as const;

/**
 * Human labels for the stored custom-field type keys. Display-only — the
 * value written to `field.type` is still the raw key, and the type is
 * locked after creation regardless. The tokens
 * `string`/`number`/`date`/`boolean`/`enum` leaked verbatim before. See
 * decisions.md §8.
 */
const TYPE_LABEL: Record<CustomFieldType, string> = {
  string: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / No",
  enum: "Choice list",
};

interface ValueRow {
  readonly key: string;
  readonly label: string;
  readonly value?: number;
  /** Presentational fields the dialog does not edit — carried through. */
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
}

export interface CustomFieldDialogResult {
  readonly field: CustomFieldDef;
}

export function CustomFieldEditDialog({
  mode,
  existingKeys,
  taskTypes = [],
  initial,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  readonly mode: "create" | "edit";
  readonly existingKeys: readonly string[];
  /**
   * K91/TSK-12: the workflow's task types, for the scope allowlist
   * multi-select. Each is `{ key, label }`; the stored scope holds keys.
   * Defaults to none — the scope control then offers no types (still
   * usable to clear a scope back to global on an existing field).
   */
  readonly taskTypes?: readonly { readonly key: string; readonly label: string }[];
  readonly initial?: CustomFieldDef | undefined;
  readonly pending: boolean;
  readonly error?: string | undefined;
  readonly onSubmit: (result: CustomFieldDialogResult) => void;
  readonly onClose: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const [type, setType] = useState<CustomFieldType>(initial?.type ?? "string");
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [searchable, setSearchable] = useState(initial?.searchable ?? false);
  const [values, setValues] = useState<readonly ValueRow[]>(
    (initial?.values ?? []).map(v => ({
      key: v.key,
      label: v.label,
      ...(v.value !== undefined ? { value: v.value } : {}),
      // Seed the presentational fields so a label edit carries them back.
      ...(v.icon !== undefined ? { icon: v.icon } : {}),
      ...(v.color !== undefined ? { color: v.color } : {}),
    })),
  );
  // K91/TSK-12: the scope allowlist. Seeded from the stored field; empty
  // means global (shows for every type). Editable on both create and edit.
  const [scope, setScope] = useState<readonly string[]>(initial?.task_types ?? []);

  const effectiveKey = mode === "create" && !keyTouched ? keyFromLabel(label) : key;

  const draft: CustomFieldDraft = {
    key: effectiveKey,
    label,
    type,
    multi,
    searchable,
    values,
    // Empty selection = global; the builder drops the key so the field is
    // stored without `task_types` (the consumption default is absent ⇒ all).
    task_types: scope.length > 0 ? scope : undefined,
  };

  const problems =
    mode === "create"
      ? validateNewCustomField(draft, existingKeys)
      : {
          ...(label.trim().length === 0 ? { label: "A label is required." } : {}),
          // On edit the type is locked, but enum values stay editable and
          // must still be non-empty and unique.
          ...(type === "enum"
            ? enumValueProblem(values)
            : {}),
        };

  const canSubmit = hasNoProblems(problems) && (problems as { values?: string }).values === undefined && !pending;

  const submit = (): void => {
    if (!canSubmit) return;
    if (mode === "edit" && initial !== undefined) {
      // Type and multi are carried through from the stored field — the
      // dialog cannot change them (SET-16).
      const next: CustomFieldDraft = {
        ...draft,
        type: initial.type,
        multi: initial.multi,
      };
      onSubmit({ field: buildCustomField(next) });
      return;
    }
    onSubmit({ field: buildCustomField(draft) });
  };

  const updateValue = (i: number, patch: Partial<ValueRow>): void => {
    setValues(prev => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };

  /** Sets or clears the numeric weight without ever storing `value: undefined`. */
  const setValueWeight = (i: number, raw: string): void => {
    setValues(prev => prev.map((v, idx) => {
      if (idx !== i) return v;
      if (raw.trim() === "") {
        const { value: _value, ...rest } = v;
        return rest;
      }
      return { ...v, value: Number(raw) };
    }));
  };

  return (
    <ResponsiveDialog
      title={mode === "create" ? "New custom field" : `Edit field "${initial?.label ?? ""}"`}
      onClose={onClose}
      testId="custom-field-dialog"
      actions={
        <DialogActions>
          <Button variant="ghost" onClick={onClose} testId="custom-field-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={submit}
            testId="custom-field-save"
          >
            {pending ? "Saving…" : mode === "create" ? "Add field" : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-3 text-[0.9286rem]">
        <label className="block">
          <span className="mb-1 block text-text-secondary">Label</span>
          <TextField
            size="sm"
            data-testid="custom-field-dialog-label"
            value={label}
            invalid={problems.label !== undefined}
            onChange={e => { setLabel(e.target.value); }}
            aria-label="Field label"
          />
          {problems.label !== undefined && (
            <span data-testid="custom-field-dialog-label-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
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
                data-testid="custom-field-dialog-key"
                value={effectiveKey}
                invalid={problems.key !== undefined}
                onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
                aria-label="Field key"
              />
              <span className="mt-1 block text-[0.8571rem] text-text-tertiary">
                A key is permanent — task files store values under it.
              </span>
              {problems.key !== undefined && (
                <span data-testid="custom-field-dialog-key-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
                  {problems.key}
                </span>
              )}
            </>
          ) : (
            <code
              data-testid="custom-field-dialog-key-readonly"
              className="inline-block rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary"
            >
              {initial?.key}
            </code>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-text-secondary">Type</span>
          <Select
            size="sm"
            data-testid="custom-field-dialog-type"
            value={type}
            // SET-16: disabled on edit, not validated-on-submit.
            disabled={mode === "edit"}
            aria-describedby={mode === "edit" ? "custom-field-dialog-type-lock" : undefined}
            onChange={e => { setType(e.target.value as CustomFieldType); }}
            aria-label="Field type"
          >
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </label>

        <label className="flex items-center gap-2 text-text-secondary">
          <Checkbox
            data-testid="custom-field-dialog-multi"
            checked={multi}
            // SET-16: multi is locked on edit alongside type.
            disabled={mode === "edit"}
            aria-describedby={mode === "edit" ? "custom-field-dialog-type-lock" : undefined}
            onChange={e => { setMulti(e.target.checked); }}
          />
          Multi — a task can hold more than one value.
        </label>

        {mode === "edit" && (
          <p
            id="custom-field-dialog-type-lock"
            data-testid="custom-field-dialog-type-lock"
            className="text-[0.7857rem] text-text-tertiary"
          >
            Type and multi are fixed after creation: existing task values
            were stored under this type. To change it, create a new field
            and migrate the values across — there is no in-place
            conversion, and the server rejects one even if this control is
            re-enabled.
          </p>
        )}

        <label className="flex items-center gap-2 text-text-secondary">
          <Checkbox
            data-testid="custom-field-dialog-searchable"
            checked={searchable}
            onChange={e => { setSearchable(e.target.checked); }}
          />
          Searchable — this field is matched by full-text search.
        </label>

        {/* K91/TSK-12: scope the field to specific task types. Empty =
            shows for every type (the backward-compatible default). The
            consumption side (create modal + detail) already filters on
            this; this is the authoring control it lacked. */}
        <div className="block">
          <span className="mb-1 block text-text-secondary">Task types</span>
          <Combobox
            mode="multi"
            label="Task types this field applies to"
            options={taskTypes.map((t): ComboboxOption => ({ key: t.key, label: t.label }))}
            selected={scope}
            onToggle={(key, on) => {
              setScope(prev => on ? [...prev, key] : prev.filter(k => k !== key));
            }}
            listTestId="custom-field-dialog-scope-list"
            searchTestId="custom-field-dialog-scope-search"
            optionTestId={o => `custom-field-dialog-scope-option-${o.key}`}
            trigger={p => (
              <ComboboxButton
                {...p}
                size="sm"
                testId="custom-field-dialog-scope"
                dataValue={scope.join(",")}
                aria-label="Task types this field applies to"
                placeholder="All task types"
              >
                {scope.length === 0
                  ? ""
                  : scope
                      .map(k => taskTypes.find(t => t.key === k)?.label ?? k)
                      .join(", ")}
              </ComboboxButton>
            )}
          />
          <span
            data-testid="custom-field-dialog-scope-hint"
            className="mt-1 block text-[0.8571rem] text-text-tertiary"
          >
            Leave empty to show this field for every task type.
          </span>
        </div>

        {type === "enum" && (
          <div>
            <span className="mb-1 block text-text-secondary">Values</span>
            <div data-testid="custom-field-dialog-values" className="space-y-2">
              {values.map((v, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1">
                  <TextField
                    size="sm"
                    data-testid={`custom-field-dialog-value-key-${i}`}
                    value={v.key}
                    placeholder="key"
                    // A value's key is permanent once the field exists,
                    // same reason as the field key — task files store it.
                    disabled={mode === "edit" && (initial?.values ?? []).some(x => x.key === v.key)}
                    onChange={e => { updateValue(i, { key: e.target.value }); }}
                    aria-label={`Value key ${i + 1}`}
                    className="w-28"
                  />
                  <TextField
                    size="sm"
                    data-testid={`custom-field-dialog-value-label-${i}`}
                    value={v.label}
                    placeholder="label"
                    onChange={e => { updateValue(i, { label: e.target.value }); }}
                    aria-label={`Value label ${i + 1}`}
                    className="w-32"
                  />
                  <TextField
                    size="sm"
                    type="number"
                    data-testid={`custom-field-dialog-value-weight-${i}`}
                    value={v.value ?? ""}
                    placeholder="weight"
                    onChange={e => { setValueWeight(i, e.target.value); }}
                    aria-label={`Value weight ${i + 1}`}
                    className="w-20"
                  />
                  {/* Per-value icon + colour (schema `icon`/`color` on a
                      CustomFieldValueDef). They round-tripped but had no
                      control — now editable on create and edit. */}
                  <IconPicker
                    value={v.icon}
                    onChange={next => { updateValue(i, { icon: next }); }}
                    testId={`custom-field-dialog-value-icon-${i}`}
                    listTestId={`custom-field-dialog-value-icon-list-${i}`}
                    searchTestId={`custom-field-dialog-value-icon-search-${i}`}
                    clearTestId={`custom-field-dialog-value-icon-clear-${i}`}
                    ariaLabel={`Value icon ${i + 1}`}
                  />
                  <ColorInput
                    value={v.color ?? ""}
                    onChange={next => { updateValue(i, { color: next.trim() === "" ? undefined : next }); }}
                    testId={`custom-field-dialog-value-color-${i}`}
                    ariaLabel={`Value colour ${i + 1}`}
                  />
                  <IconButton
                    variant="secondary"
                    size="sm"
                    testId={`custom-field-dialog-value-remove-${i}`}
                    onClick={() => { setValues(prev => prev.filter((_, idx) => idx !== i)); }}
                    className="text-danger-fg"
                    aria-label={`Remove value ${i + 1}`}
                  >
                    ✕
                  </IconButton>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="custom-field-dialog-value-add"
              onClick={() => { setValues(prev => [...prev, { key: "", label: "" }]); }}
              className="mt-1"
            >
              + Add value
            </Button>
            {(problems as { values?: string }).values !== undefined && (
              <span data-testid="custom-field-dialog-values-error" className="mt-1 block text-[0.8571rem] text-danger-fg">
                {(problems as { values?: string }).values}
              </span>
            )}
          </div>
        )}

        {error !== undefined && (
          <Callout tone="danger" role="alert" testId="custom-field-dialog-error">
            {error}
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}

/** The enum-values problem for the edit path (create uses the fuller check). */
function enumValueProblem(values: readonly ValueRow[]): { values?: string } {
  const present = values.filter(v => v.key.trim().length > 0 || v.label.trim().length > 0);
  if (present.length === 0) return { values: "An enum field needs at least one value." };
  const seen = new Set<string>();
  for (const v of present) {
    const k = v.key.trim();
    if (k.length === 0) return { values: "Each value needs a key." };
    if (seen.has(k)) return { values: `Duplicate value key "${k}".` };
    seen.add(k);
    if (v.label.trim().length === 0) return { values: `The value "${k}" needs a label.` };
  }
  return {};
}
