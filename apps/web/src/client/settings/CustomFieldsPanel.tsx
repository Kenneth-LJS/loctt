import type { CustomFieldDef, CustomFieldValueDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { enumSortBasis } from "./workflowEdits.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Workflow → Custom fields (SET-7, SET-8, SET-16, SET-19).
 *
 * Two invariants shape this panel:
 *
 *  - **`type` and `multi` are locked once the field exists** (SET-16).
 *    Task frontmatter already holds values under the declared type, so
 *    changing it would leave data the loaders reject. The control is
 *    `disabled` and states the reason — and the server refuses the
 *    change too (`assertCustomFieldTypeChangesAreSafe`), which is what
 *    makes SET-16's devtools bullet hold rather than the disabled
 *    attribute being the whole enforcement.
 *  - **Deleting an enum value that tasks hold demands remap-or-clear**
 *    (SET-19), through the same dialog statuses use and the same
 *    `remap.custom_fields` table the server validates.
 *
 * `label` and `searchable` stay editable in the same form so the lock
 * reads as targeted rather than as a frozen row.
 */

const TYPES = ["string", "number", "date", "boolean", "enum"] as const;

export function CustomFieldsPanel() {
  return (
    <WorkflowPanelFrame
      title="Custom fields"
      description="Extra fields on every task. A field's type is fixed once it exists, because task files already store values under it."
    >
      {({ workflow, usage }) => (
        <FieldsEditor
          workflow={workflow}
          valueCounts={usage?.custom_field_values ?? {}}
        />
      )}
    </WorkflowPanelFrame>
  );
}

function FieldsEditor({
  workflow,
  valueCounts,
}: {
  readonly workflow: WorkflowConfig;
  readonly valueCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
}) {
  const save = useSaveWorkflowCollection<"custom_fields">();
  const [deleting, setDeleting] = useState<
    { readonly field: CustomFieldDef; readonly value: CustomFieldValueDef } | null
  >(null);

  const fields = workflow.custom_fields;

  const commitFields = (
    next: readonly CustomFieldDef[],
    remap?: Record<string, Record<string, string | null>>,
  ): void => {
    // SET-28: against the freshly-read document.
    const orderedKeys = next.map(f => f.key);
    const byKey = new Map(next.map(f => [f.key, f]));
    const known = new Set(fields.map(f => f.key));
    save.mutate(
      {
        collection: "custom_fields",
        apply: fresh => [
          ...orderedKeys.flatMap(k => {
            const f = byKey.get(k);
            return f === undefined ? [] : [f];
          }),
          ...fresh.custom_fields.filter(f => !known.has(f.key) && !byKey.has(f.key)),
        ],
        ...(remap !== undefined ? { remap: { custom_fields: remap } } : {}),
      },
      { onSuccess: () => { setDeleting(null); } },
    );
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  if (fields.length === 0) {
    return (
      <p data-testid="custom-fields-empty" className="text-[13px] text-text-secondary">
        This tracker declares no custom fields. Add them under{" "}
        <code className="font-mono">custom_fields</code> in workflow.yaml.
      </p>
    );
  }

  return (
    <div>
      {save.isError && (
        <div role="alert" data-testid="workflow-save-error" className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[13px]">
          <p className="font-medium text-danger-fg">
            The change was not saved to .loctt/config/workflow.yaml.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
        </div>
      )}

      <div data-testid="custom-fields-list" className="space-y-3">
        {fields.map(field => (
          <FieldRow
            key={field.key}
            field={field}
            counts={valueCounts[field.key] ?? {}}
            disabled={save.isPending}
            onChange={next => {
              commitFields(fields.map(f => (f.key === field.key ? next : f)));
            }}
            onDeleteValue={value => { setDeleting({ field, value }); }}
          />
        ))}
      </div>

      {deleting !== null && (
        <RemapDeleteDialog
          noun="value"
          itemLabel={deleting.value.label}
          itemKey={deleting.value.key}
          count={valueCounts[deleting.field.key]?.[deleting.value.key] ?? 0}
          alternatives={(deleting.field.values ?? [])
            .filter(v => v.key !== deleting.value.key)
            .map(v => ({ key: v.key, label: v.label }))}
          pending={save.isPending}
          error={saveError}
          onConfirm={choice => {
            const nextField: CustomFieldDef = {
              ...deleting.field,
              values: (deleting.field.values ?? []).filter(v => v.key !== deleting.value.key),
            };
            commitFields(
              fields.map(f => (f.key === deleting.field.key ? nextField : f)),
              {
                [deleting.field.key]: {
                  [deleting.value.key]: choice.kind === "remap" ? choice.to : null,
                },
              },
            );
          }}
          onClose={() => { setDeleting(null); save.reset(); }}
        />
      )}
    </div>
  );
}

function FieldRow({
  field,
  counts,
  disabled,
  onChange,
  onDeleteValue,
}: {
  readonly field: CustomFieldDef;
  readonly counts: Readonly<Record<string, number>>;
  readonly disabled: boolean;
  readonly onChange: (next: CustomFieldDef) => void;
  readonly onDeleteValue: (value: CustomFieldValueDef) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const basis = enumSortBasis(field);

  return (
    <div
      data-testid={`custom-field-${field.key}`}
      data-field-type={field.type}
      data-field-multi={field.multi ? "true" : "false"}
      className="rounded-md border border-border-subtle bg-bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <input
          data-testid={`custom-field-label-${field.key}`}
          value={label}
          disabled={disabled}
          onChange={e => { setLabel(e.target.value); }}
          onBlur={() => {
            const t = label.trim();
            if (t.length === 0) { setLabel(field.label); return; }
            if (t !== field.label) onChange({ ...field, label: t });
          }}
          aria-label={`Label for ${field.key}`}
          className="h-7 w-40 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
        />
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] text-text-secondary">
          {field.key}
        </code>

        {/* SET-16: disabled, not validated-on-submit, and it says why. */}
        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          type
          <select
            data-testid={`custom-field-type-${field.key}`}
            value={field.type}
            disabled
            aria-label={`Type for ${field.key}`}
            aria-describedby={`custom-field-type-lock-${field.key}`}
            className="h-7 rounded-md border border-border-default bg-bg-muted px-1 text-[12px]"
          >
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            data-testid={`custom-field-multi-${field.key}`}
            checked={field.multi}
            disabled
            aria-describedby={`custom-field-type-lock-${field.key}`}
          />
          multi
        </label>

        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            data-testid={`custom-field-searchable-${field.key}`}
            checked={field.searchable}
            disabled={disabled}
            onChange={e => { onChange({ ...field, searchable: e.target.checked }); }}
          />
          searchable
        </label>
      </div>

      <p
        id={`custom-field-type-lock-${field.key}`}
        data-testid={`custom-field-type-lock-${field.key}`}
        className="mt-1 text-[11px] text-text-tertiary"
      >
        Type and multi are fixed: existing task values were stored under
        this type. To change it, add a new field and migrate the values
        across — there is no in-place conversion, and the server rejects
        one even if this control is re-enabled.
      </p>

      {field.type === "enum" && (
        <div className="mt-2">
          <table
            data-testid={`custom-field-values-${field.key}`}
            data-sort-basis={basis}
            className="w-full border-collapse text-left text-[12px]"
          >
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-tertiary">
                <th className="py-1 pr-3 font-medium">Value</th>
                <th className="py-1 pr-3 font-medium">Key</th>
                <th className="py-1 pr-3 font-medium">Weight</th>
                <th className="py-1 pr-3 font-medium">Tasks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(field.values ?? []).map(v => (
                <tr key={v.key} data-testid={`custom-field-value-${field.key}-${v.key}`}>
                  <td className="py-0.5 pr-3">{v.label}</td>
                  <td className="py-0.5 pr-3 font-mono text-text-secondary">{v.key}</td>
                  <td className="py-0.5 pr-3">
                    {/* SET-8: the optional numeric weight, editable. */}
                    <input
                      type="number"
                      data-testid={`custom-field-weight-${field.key}-${v.key}`}
                      defaultValue={v.value ?? ""}
                      disabled={disabled}
                      aria-label={`Weight for ${v.key}`}
                      onBlur={e => {
                        const raw = e.target.value.trim();
                        const nextValues = (field.values ?? []).map(x => {
                          if (x.key !== v.key) return x;
                          if (raw === "") {
                            const { value: _value, ...rest } = x;
                            return rest;
                          }
                          return { ...x, value: Number(raw) };
                        });
                        onChange({ ...field, values: nextValues });
                      }}
                      className="h-6 w-16 rounded border border-border-default bg-bg-surface px-1 text-[12px]"
                    />
                  </td>
                  <td
                    data-testid={`custom-field-value-refcount-${field.key}-${v.key}`}
                    className="py-0.5 pr-3 text-text-tertiary"
                  >
                    {String(counts[v.key] ?? 0)}
                  </td>
                  <td className="py-0.5">
                    <button
                      type="button"
                      data-testid={`custom-field-value-delete-${field.key}-${v.key}`}
                      disabled={disabled || (field.values ?? []).length <= 1}
                      onClick={() => { onDeleteValue(v); }}
                      title={
                        (field.values ?? []).length <= 1
                          ? "An enum field must keep at least one value."
                          : undefined
                      }
                      className="h-6 rounded border border-border-default px-1.5 text-[11px] text-danger-fg disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* SET-8: the panel says which fallback applies. */}
          <p
            data-testid={`custom-field-sort-note-${field.key}`}
            className="mt-1 text-[11px] text-text-tertiary"
          >
            {basis === "weight"
              ? "Sorting this field uses the weights above; values with no weight sort last."
              : "No weights are set, so sorting this field falls back to the declared order of the values above."}
          </p>
        </div>
      )}
    </div>
  );
}
