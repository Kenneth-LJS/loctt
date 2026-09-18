import type { QuerySort, WorkflowConfig } from "@loctt/contracts";
import { isSortableTaskField } from "@loctt/contracts";

/**
 * VUE-37: an invalid sort field must be flagged in the editor so it can
 * be corrected, and named when the view is applied.
 *
 * Measured behaviour this guards: `POST /api/views` accepts
 * `sort: [{ field: "nonexistent_field", … }]` with 201 and applying the
 * view returns 200 with the rows silently unsorted — no mention of the
 * field anywhere. `isSortableTaskField` already exists in contracts and
 * answers the question; nothing was calling it for saved-view sorts.
 *
 * Custom fields are workspace-specific, so `fields.<key>` is checked
 * against the workflow config rather than accepted on shape alone —
 * `isSortableTaskField` deliberately accepts any well-formed
 * `fields.*`, which is right for the generic check and too permissive
 * here, where we know which custom fields exist.
 */

export interface SortFieldProblem {
  /** Index into the sort array, so the editor can flag that row. */
  readonly index: number;
  readonly field: string;
  readonly message: string;
}

export function validateSortFields(
  sort: readonly QuerySort[],
  workflow?: WorkflowConfig,
): readonly SortFieldProblem[] {
  const problems: SortFieldProblem[] = [];

  const customKeys = new Set((workflow?.custom_fields ?? []).map(f => f.key));

  sort.forEach((entry, index) => {
    const { field } = entry;

    if (field.startsWith("fields.")) {
      const key = field.slice("fields.".length);
      // With no workflow config loaded we cannot know which custom
      // fields exist, so we do not invent a failure.
      if (workflow !== undefined && !customKeys.has(key)) {
        problems.push({
          index,
          field,
          message: `“${field}” is not a custom field in this workspace, so rows will not be sorted by it.`,
        });
      }
      return;
    }

    if (!isSortableTaskField(field)) {
      problems.push({
        index,
        field,
        message: `“${field}” is not a task field, so rows will not be sorted by it.`,
      });
    }
  });

  return problems;
}
