import { ulid } from "ulid";

/**
 * Default workflow.yaml content seeded on `loctt init`.
 *
 * The fixture matches §1.5 of TEMP-UI-DISCREPANCIES.md (the locked UI
 * plan): four statuses across all four categories, four priorities
 * (highest→lowest by list order), five task types, six relationships
 * mirroring Jira's defaults plus parent/child, free-form numeric
 * estimation in story points, and timeline defaults grouped by sprint
 * with blocks-arrows enabled.
 *
 * Everything is editable in Settings → Workflow once the tracker is
 * created. The philosophy: enable features by default so users who
 * need them find them; users who don't simply ignore them.
 */
export function defaultWorkflowYaml(prefix: string): string {
  return `key:
  prefix: "${prefix}"

statuses:
  - key: backlog
    label: Backlog
    category: pending
  - key: in_progress
    label: In progress
    category: active
  - key: done
    label: Done
    category: completed
  - key: wont_do
    label: Won't do
    category: discarded

# Order top→bottom = highest→lowest priority. \`value\` is the numeric
# weight used by sort comparisons; the Settings UI recomputes these on
# drag-reorder (top = N, bottom = 1).
priorities:
  - key: critical
    label: Critical
    value: 4
  - key: high
    label: High
    value: 3
  - key: medium
    label: Medium
    value: 2
  - key: low
    label: Low
    value: 1

task_types:
  - key: story
    label: Story
  - key: bug
    label: Bug
  - key: task
    label: Task
  - key: spike
    label: Spike
  - key: feature
    label: Feature

relationships:
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
    structural: true
    ranked: true
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    structural: true
    ranked: true
  - key: clones
    label: Clones
    inverse: is_cloned_by
    inverse_label: Is cloned by
  - key: duplicates
    label: Duplicates
    inverse: is_duplicated_by
    inverse_label: Is duplicated by
  - key: causes
    label: Causes
    inverse: is_caused_by
    inverse_label: Is caused by
  - key: relates_to
    label: Relates to
    kind: symmetric

custom_fields: []

estimation:
  enabled: true
  unit: points
  unit_label: pts
  scale: free

timeline:
  dependency_relationship: blocks
  default_zoom: week
  show_arrows: true
  default_grouping: sprint
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
