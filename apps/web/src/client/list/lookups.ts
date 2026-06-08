import type {
  LabelDef,
  PriorityDef,
  ProjectDef,
  StatusDef,
  TaskTypeDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";

/**
 * Resolution maps that turn the ids/keys stored on a task into the
 * display data the table cells need. Tasks store project/assignee/
 * label ids (ULIDs) and status/priority/type keys (workflow keys);
 * none of those are human-readable on their own. We build these maps
 * once per render from the already-cached config/list queries and
 * hand them to the cell renderers.
 */
export interface ListLookups {
  project: (id: string | undefined) => ProjectDef | undefined;
  user: (id: string | undefined) => UserProfile | undefined;
  label: (id: string) => LabelDef | undefined;
  status: (key: string | undefined) => StatusDef | undefined;
  priority: (key: string | undefined) => PriorityDef | undefined;
  taskType: (key: string | undefined) => TaskTypeDef | undefined;
}

function indexBy<T, K extends keyof T>(items: readonly T[], key: K): Map<T[K], T> {
  const m = new Map<T[K], T>();
  for (const it of items) m.set(it[key], it);
  return m;
}

export function buildLookups(input: {
  projects: readonly ProjectDef[];
  users: readonly UserProfile[];
  labels: readonly LabelDef[];
  workflow: WorkflowConfig | undefined;
}): ListLookups {
  const projects = indexBy(input.projects, "id");
  const users = indexBy(input.users, "id");
  const labels = indexBy(input.labels, "id");
  const statuses = indexBy(input.workflow?.statuses ?? [], "key");
  const priorities = indexBy(input.workflow?.priorities ?? [], "key");
  const taskTypes = indexBy(input.workflow?.task_types ?? [], "key");

  return {
    project: id => (id === undefined ? undefined : projects.get(id)),
    user: id => (id === undefined ? undefined : users.get(id)),
    label: id => labels.get(id),
    status: key => (key === undefined ? undefined : statuses.get(key)),
    priority: key => (key === undefined ? undefined : priorities.get(key)),
    taskType: key => (key === undefined ? undefined : taskTypes.get(key)),
  };
}
