import type { CustomFieldDef, CustomFieldValueDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  ConcurrentWorkflowEditError,
  useSaveWorkflowCollection,
} from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { type CustomFieldDialogResult,CustomFieldEditDialog } from "./CustomFieldEditDialog.tsx";
import { RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { enumSortBasis } from "./workflowEdits.ts";
import { collectionKeys, entryChangedOnDisk } from "./workflowForms.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Workflow → Custom fields (SET-7, SET-8, SET-16, SET-19,
 * SET-49, SET-28, SET-51).
 *
 * Full CRUD in the UI (SET-49): create, edit and delete a field, plus
 * delete an enum value through remap-or-clear. Two invariants shape it:
 *
 *  - **`type` and `multi` are locked once the field exists** (SET-16),
 *    inside the Edit dialog: the controls are disabled and state the
 *    reason — and the server refuses the change too
 *    (`assertCustomFieldTypeChangesAreSafe`), which is what makes
 *    SET-16's devtools bullet hold rather than the disabled attribute
 *    being the whole enforcement.
 *  - **Deleting an enum value that tasks hold demands remap-or-clear**
 *    (SET-19), through the same dialog statuses use.
 *
 * **Edit model (B2):** value edits (label, searchable, value
 * labels/weights) live behind the Edit dialog — the panel body is a
 * read-out. Creating uses the same dialog in create mode.
 */

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
          fieldCounts={usage?.custom_fields ?? {}}
        />
      )}
    </WorkflowPanelFrame>
  );
}

function FieldsEditor({
  workflow,
  valueCounts,
  fieldCounts,
}: {
  readonly workflow: WorkflowConfig;
  readonly valueCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Field key → tasks holding any value for it. This is the whole-field
   * delete blast radius; summing `valueCounts` reports 0 for number and
   * boolean fields, which have no enum values.
   */
  readonly fieldCounts: Readonly<Record<string, number>>;
}) {
  const save = useSaveWorkflowCollection<"custom_fields">();
  const [deleting, setDeleting] = useState<
    { readonly field: CustomFieldDef; readonly value: CustomFieldValueDef } | null
  >(null);
  const [deletingField, setDeletingField] = useState<CustomFieldDef | null>(null);
  const [dialog, setDialog] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly field: CustomFieldDef }
    | null
  >(null);

  const fields = workflow.custom_fields;

  const commitFields = (
    next: readonly CustomFieldDef[],
    opts?: {
      remap?: Record<string, Record<string, string | null>>;
      staleBaseline?: CustomFieldDef;
      onDone?: () => void;
    },
  ): void => {
    // SET-28: against the freshly-read document.
    const orderedKeys = next.map(f => f.key);
    const byKey = new Map(next.map(f => [f.key, f]));
    const known = new Set(fields.map(f => f.key));
    save.mutate(
      {
        collection: "custom_fields",
        apply: fresh => {
          if (
            opts?.staleBaseline !== undefined
            && entryChangedOnDisk(opts.staleBaseline, fresh.custom_fields)
          ) {
            throw new ConcurrentWorkflowEditError(
              `.loctt/config/workflow.yaml changed on disk while this dialog was `
              + `open — the field "${opts.staleBaseline.key}" is not what it was. `
              + `Reload the panel to see the current file, then re-apply your change. `
              + `Your edit was not saved.`,
            );
          }
          return [
            ...orderedKeys.flatMap(k => {
              const f = byKey.get(k);
              return f === undefined ? [] : [f];
            }),
            ...fresh.custom_fields.filter(f => !known.has(f.key) && !byKey.has(f.key)),
          ];
        },
        ...(opts?.remap !== undefined ? { remap: { custom_fields: opts.remap } } : {}),
      },
      {
        onSuccess: () => {
          setDeleting(null);
          setDeletingField(null);
          opts?.onDone?.();
        },
      },
    );
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  const dialogError = dialog !== null && save.isError ? saveError : undefined;
  const inlineError = dialog === null && save.isError;

  const applyDialog = (result: CustomFieldDialogResult): void => {
    if (dialog === null) return;
    if (dialog.mode === "create") {
      commitFields([...fields, result.field], { onDone: () => { setDialog(null); } });
      return;
    }
    const target = dialog.field;
    commitFields(
      fields.map(f => (f.key === target.key ? result.field : f)),
      { staleBaseline: target, onDone: () => { setDialog(null); } },
    );
  };

  return (
    <div>
      {inlineError && (
        <div role="alert" data-testid="workflow-save-error" className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[0.9286rem]">
          <p className="font-medium text-danger-fg">
            The change was not saved to .loctt/config/workflow.yaml.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          data-testid="custom-fields-create"
          disabled={save.isPending}
          onClick={() => { save.reset(); setDialog({ mode: "create" }); }}
        >
          + Add custom field
        </Button>
      </div>

      {fields.length === 0 ? (
        <p data-testid="custom-fields-empty" className="text-[0.9286rem] text-text-secondary">
          This tracker declares no custom fields. Use{" "}
          <strong className="font-medium">+ Add custom field</strong> to create one.
        </p>
      ) : (
        <div data-testid="custom-fields-list" className="space-y-3">
          {fields.map(field => (
            <FieldRow
              key={field.key}
              field={field}
              counts={valueCounts[field.key] ?? {}}
              disabled={save.isPending}
              onEdit={() => { save.reset(); setDialog({ mode: "edit", field }); }}
              onDelete={() => { save.reset(); setDeletingField(field); }}
              onDeleteValue={value => { save.reset(); setDeleting({ field, value }); }}
            />
          ))}
        </div>
      )}

      {dialog !== null && (
        <CustomFieldEditDialog
          mode={dialog.mode}
          existingKeys={collectionKeys(workflow, "custom_fields")}
          initial={dialog.mode === "edit" ? dialog.field : undefined}
          pending={save.isPending}
          error={dialogError}
          onSubmit={applyDialog}
          onClose={() => { setDialog(null); save.reset(); }}
        />
      )}

      {/* SET-49: deleting the whole field. When tasks hold values, the
          remap-or-clear dialog covers them; the count summed across the
          field's values drives whether a choice is required. */}
      {deletingField !== null && (
        <RemapDeleteDialog
          noun="field"
          itemLabel={deletingField.label}
          itemKey={deletingField.key}
          // The whole-field blast radius: tasks holding any value for the
          // field, whatever its type. Summing `valueCounts` here reported 0
          // for number/boolean fields (they have no enum values), so the
          // confirm claimed a field in use "affects nothing".
          count={fieldCounts[deletingField.key] ?? 0}
          // A field-level delete has no in-collection remap target that
          // makes sense (fields are not interchangeable), so only "clear"
          // is offered — the dialog degrades to a clear-or-cancel.
          alternatives={[]}
          pending={save.isPending}
          error={saveError}
          onConfirm={() => {
            const next = fields.filter(f => f.key !== deletingField.key);
            // Clearing every value the field held on the tasks that hold
            // them, through the remap table the server validates.
            const perValue: Record<string, string | null> = {};
            for (const v of deletingField.values ?? []) perValue[v.key] = null;
            commitFields(
              next,
              Object.keys(perValue).length > 0
                ? { remap: { [deletingField.key]: perValue } }
                : {},
            );
          }}
          onClose={() => { setDeletingField(null); save.reset(); }}
        />
      )}

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
                remap: {
                  [deleting.field.key]: {
                    [deleting.value.key]: choice.kind === "remap" ? choice.to : null,
                  },
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

/**
 * A view-by-default field row: label, key, type/multi/searchable read
 * out, enum values with refcounts, and Edit / Delete controls. No inline
 * inputs — value edits moved to the Edit dialog (open decision #3).
 */
function FieldRow({
  field,
  counts,
  disabled,
  onEdit,
  onDelete,
  onDeleteValue,
}: {
  readonly field: CustomFieldDef;
  readonly counts: Readonly<Record<string, number>>;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onDeleteValue: (value: CustomFieldValueDef) => void;
}) {
  const basis = enumSortBasis(field);

  return (
    <div
      data-testid={`custom-field-${field.key}`}
      data-field-type={field.type}
      data-field-multi={field.multi ? "true" : "false"}
      className="rounded-md border border-border-subtle bg-bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[0.9286rem]">
        <span data-testid={`custom-field-label-${field.key}`} className="font-medium">
          {field.label}
        </span>
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] text-text-secondary">
          {field.key}
        </code>
        <span
          data-testid={`custom-field-type-${field.key}`}
          className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.8571rem] text-text-secondary"
        >
          {field.type}{field.multi ? " · multi" : ""}
        </span>
        <span
          data-testid={`custom-field-searchable-${field.key}`}
          data-searchable={field.searchable ? "true" : "false"}
          className="text-[0.8571rem] text-text-tertiary"
        >
          {field.searchable ? "searchable" : "not searchable"}
        </span>

        <span className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid={`custom-field-edit-${field.key}`}
            disabled={disabled}
            onClick={onEdit}
            className="h-7 rounded-md border border-border-default px-2 text-[0.8571rem] disabled:opacity-40"
          >
            Edit
          </button>
          <button
            type="button"
            data-testid={`custom-field-delete-${field.key}`}
            disabled={disabled}
            onClick={onDelete}
            className="h-7 rounded-md border border-border-default px-2 text-[0.8571rem] text-danger-fg disabled:opacity-40"
          >
            Delete
          </button>
        </span>
      </div>

      {field.type === "enum" && (
        <div className="mt-2">
          <table
            data-testid={`custom-field-values-${field.key}`}
            data-sort-basis={basis}
            className="w-full border-collapse text-left text-[0.8571rem]"
          >
            <thead>
              <tr className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
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
                  <td className="py-0.5 pr-3">{v.value ?? "—"}</td>
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
                      className="h-6 rounded border border-border-default px-1.5 text-[0.7857rem] text-danger-fg disabled:opacity-40"
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
            className="mt-1 text-[0.7857rem] text-text-tertiary"
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
