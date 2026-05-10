/** A single relationship edge stored in task frontmatter. */
export interface TaskRelationship {
  readonly type: string;
  readonly target: string;
  /**
   * Lexorank string used to order the targets of a single
   * relationship type within one source task. Only set when the
   * relationship type is configured as `ranked: true` in the
   * workflow. Tasks without rank sort below ranked ones.
   */
  readonly rank?: string;
}

/** Task frontmatter — the structured metadata stored in task.md YAML. */
export interface TaskFrontmatter {
  readonly id: string;
  readonly key: string;
  /**
   * The project this task belongs to (matches `ProjectDef.key`).
   * Required on tasks created post-projects-introduction. Optional
   * here only because tests/fixtures may construct partial
   * frontmatter for narrow assertions.
   */
  readonly project?: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status?: string;
  readonly status_updated_at?: string;
  readonly task_type?: string;
  readonly priority?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start_date?: string;
  readonly due_date?: string;
  readonly estimate?: string;
  /**
   * Auto-managed: set when status moves into a `completed`-category
   * status; cleared when moved out. Not user-editable.
   */
  readonly completed_date?: string;
  readonly milestone?: string;
  readonly archived?: boolean;
  readonly archived_at?: string;
  readonly relationships?: readonly TaskRelationship[];
  readonly key_history?: readonly string[];
  readonly fields?: Readonly<Record<string, unknown>>;
  /**
   * Lexorank string for manual drag-reorder within a board column.
   * Independent from relationship rank. Cards without `board_rank`
   * sort below ranked ones, fallback to created.
   */
  readonly board_rank?: string;
}

/** A full task: frontmatter + markdown body. */
export interface Task {
  readonly frontmatter: TaskFrontmatter;
  readonly body: string;
}
