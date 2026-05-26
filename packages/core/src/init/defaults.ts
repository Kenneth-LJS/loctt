import { ulid } from "ulid";

/** Default workflow.yaml content matching design-doc defaults. */
export function defaultWorkflowYaml(prefix: string): string {
  return `key:
  prefix: "${prefix}"

statuses:
  - key: not_started
    label: Not started
    category: pending
  - key: in_progress
    label: In progress
    category: active
  - key: blocked
    label: Blocked
    category: active
  - key: done
    label: Done
    category: completed

priorities:
  - key: low
    label: Low
    value: 1
  - key: medium
    label: Medium
    value: 2
  - key: high
    label: High
    value: 3

task_types:
  - key: task
    label: Task

relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    structural: true
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
  - key: relates_to
    label: Relates to
    kind: symmetric

custom_fields: []
`;
}

/** Default queries.yaml content. */
export function defaultQueriesYaml(): string {
  const id1 = ulid();
  const id2 = ulid();
  return `queries:
  - id: ${id1}
    name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - id: ${id2}
    name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc
`;
}

/**
 * Default state.yaml content. The entity type is keyed by the
 * starting project's key, not the literal `task`, so per-project
 * counters work cleanly when more projects are added later.
 */
export function defaultStateYaml(projectKey: string, prefix: string): string {
  return `keys:
  ${projectKey}:
    prefix: "${prefix}"
    next_number: 1
`;
}

/** Default projects.yaml content for `loctt init`. */
export function defaultProjectsYaml(projectKey: string, label: string, prefix: string): string {
  return `projects:
  - key: ${projectKey}
    label: ${label}
    prefix: "${prefix}"

default: ${projectKey}
`;
}
