import type { BuilderTree, SavedQuery } from "@loctt/contracts";
import { ulid } from "ulid";

import { serializeQueriesConfig } from "../config/queries.js";
import { slugifyName } from "../projects/slug.js";
import { queryToConditions } from "../query/builderTree.js";

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
    default: true
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
    graph: acyclic
    ranked: true
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    graph: tree
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

/**
 * Derive the structured `conditions` for a seeded view from its DSL. The
 * DSL is the authored intent; `conditions` are generated from it (and, via
 * `serializeQueriesConfig`, the written `query` is re-derived from the
 * conditions — so the two are guaranteed to agree). A parse failure here
 * is a bug in the seed DSL, not user input, so it throws.
 *
 * The `blocked` view uses `has_link("is_blocked_by")`, which the extended
 * BuilderTree represents structurally — this is what proves the extension.
 */
function seedConditions(dsl: string): BuilderTree {
  const res = queryToConditions(dsl);
  if (!res.ok) {
    throw new Error(`default view DSL does not parse: ${dsl} — ${res.reason}`);
  }
  return res.tree;
}

/** Default queries.yaml content. */
export function defaultQueriesYaml(): string {
  const recentOpenDsl = "archived != true and status != done";
  const blockedDsl = 'archived != true and has_link("is_blocked_by")';
  const queries: SavedQuery[] = [
    {
      id: ulid(),
      name: "recent-open",
      query: recentOpenDsl,
      conditions: seedConditions(recentOpenDsl),
      sort: [{ field: "updated_at", direction: "desc" }],
    },
    {
      id: ulid(),
      name: "blocked",
      query: blockedDsl,
      conditions: seedConditions(blockedDsl),
      sort: [
        { field: "priority", direction: "desc" },
        { field: "updated_at", direction: "desc" },
      ],
    },
  ];
  return serializeQueriesConfig({ queries });
}

/**
 * Default state.yaml content. The entity type is keyed by the
 * starting project's id (ULID), matching the projects.yaml entry.
 */
export function defaultStateYaml(projectId: string, prefix: string): string {
  return `keys:
  ${projectId}:
    prefix: "${prefix}"
    next_number: 1
`;
}

/**
 * Default projects.yaml content for `loctt init`.
 *
 * Caller passes the generated project id (ULID), the user-visible
 * name, and the immutable task-key prefix.
 */
export function defaultProjectsYaml(projectId: string, name: string, prefix: string): string {
  // YAML scalar that may contain spaces — quote `name` to be safe.
  const escapedName = JSON.stringify(name);
  // K3: a tracker is born with a slug so its URLs are readable from the
  // first one. A name with no usable ASCII yields none, and resolution
  // falls back to the ULID rather than inventing a handle.
  const slug = slugifyName(name);
  const slugLine = slug !== undefined ? `    slug: ${slug}\n` : "";
  return `projects:
  - id: ${projectId}
    name: ${escapedName}
${slugLine}    prefix: "${prefix}"

default: ${projectId}
`;
}
