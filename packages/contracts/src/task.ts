/** A single relationship edge stored in task frontmatter. */
export interface TaskRelationship {
  readonly type: string;
  readonly target: string;
}

/** Task frontmatter — the structured metadata stored in task.md YAML. */
export interface TaskFrontmatter {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status?: string;
  readonly status_updated_at?: string;
  readonly task_type?: string;
  readonly priority?: string;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start_date?: string;
  readonly due_date?: string;
  readonly estimate?: string;
  readonly completed_at?: string;
  readonly milestone?: string;
  readonly archived?: boolean;
  readonly archived_at?: string;
  readonly relationships?: readonly TaskRelationship[];
  readonly key_history?: readonly string[];
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** A full task: frontmatter + markdown body. */
export interface Task {
  readonly frontmatter: TaskFrontmatter;
  readonly body: string;
}
