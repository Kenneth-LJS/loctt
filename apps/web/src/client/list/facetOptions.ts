import type { WorkflowConfig } from "@loctt/contracts";

import type { FilterOption } from "./FilterFacet.tsx";

/**
 * The ONE definition of "what values may a facet offer".
 *
 * Extracted from `FilterBar.tsx` (K102) where it was private. The saved-view
 * form dialog now renders the same field/operator/value rows the top filter
 * bar does, and both must offer the same options from ONE definition — a
 * second copy is exactly the drift that lets the dialog propose a value the
 * bar cannot show (or vice versa). This is a pure move: the behaviour is
 * byte-for-byte what FilterBar had.
 */

export interface FacetOptions {
  project: FilterOption[];
  status: FilterOption[];
  priority: FilterOption[];
  type: FilterOption[];
  assignee: FilterOption[];
  reporter: FilterOption[];
  labels: FilterOption[];
  milestone: FilterOption[];
  sprint: FilterOption[];
}

export interface NamedEntity {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean | undefined;
}

/**
 * Like {@link NamedEntity} but `name` may be `undefined` (O5 — a corrupt
 * or absent profile name is field-local; the user still loads). Only the
 * user facet degrades this way, so it is a separate shape rather than
 * loosening every entity's `name`.
 */
export interface NamedUser {
  readonly id: string;
  readonly name?: string | undefined;
  readonly archived?: boolean | undefined;
}

export function buildFacetOptions(input: {
  projects: readonly NamedEntity[];
  users: readonly NamedUser[];
  labels: readonly NamedEntity[];
  milestones: readonly NamedEntity[];
  sprints: readonly NamedEntity[];
  workflow: WorkflowConfig | undefined;
}): FacetOptions {
  const live = <T extends { archived?: boolean | undefined }>(xs: readonly T[]): readonly T[] =>
    xs.filter(x => x.archived !== true);
  const userOpts: FilterOption[] = input.users.map(u => {
    // O5: a nameless profile degrades to its id so the facet option is
    // never blank.
    const name = u.name ?? u.id;
    return {
      value: u.id,
      label: u.archived ? `${name} (archived)` : name,
    };
  });
  return {
    project: live(input.projects).map(p => ({ value: p.id, label: p.name })),
    status: (input.workflow?.statuses ?? []).map(s => ({ value: s.key, label: s.label })),
    priority: (input.workflow?.priorities ?? []).map(p => ({ value: p.key, label: p.label })),
    type: (input.workflow?.task_types ?? []).map(t => ({ value: t.key, label: t.label })),
    // Assignee and reporter share one option set built from the known
    // users — archived ones included (greyed) so historical filters
    // still work. Because the options come from the users list and not
    // from task values, a dangling ULID (a deleted user, PRU-25) is
    // never offered on either facet.
    assignee: userOpts,
    reporter: userOpts,
    labels: live(input.labels).map(l => ({ value: l.id, label: l.name })),
    milestone: live(input.milestones).map(m => ({ value: m.id, label: m.name })),
    sprint: live(input.sprints).map(s => ({ value: s.id, label: s.name })),
  };
}
