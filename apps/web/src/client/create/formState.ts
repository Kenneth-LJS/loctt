import type { CreateTaskRequest } from "@loctt/contracts";

/**
 * The create form's values, and the two operations NEW-11 turns on.
 *
 * Kept as a plain object with plain functions so the "Create another"
 * rule is testable without rendering anything. The rule is small and
 * the failure it guards against is silent: a due date or an assignee
 * carried invisibly into the next task is not something the user sees
 * until they look at the file.
 */
export interface CreateFormState {
  readonly project: string | undefined;
  readonly title: string;
  readonly status: string | undefined;
  readonly priority: string | undefined;
  readonly task_type: string | undefined;
  readonly sprint: string | undefined;
  readonly milestone: string | undefined;
  readonly assignee: string | undefined;
  readonly reporter: string | undefined;
  readonly labels: readonly string[];
  readonly start_date: string | undefined;
  readonly due_date: string | undefined;
  readonly body: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export function emptyForm(overrides: Partial<CreateFormState> = {}): CreateFormState {
  return {
    project: undefined,
    title: "",
    status: undefined,
    priority: undefined,
    task_type: undefined,
    sprint: undefined,
    milestone: undefined,
    assignee: undefined,
    reporter: undefined,
    labels: [],
    start_date: undefined,
    due_date: undefined,
    body: "",
    fields: {},
    ...overrides,
  };
}

/**
 * What survives a "Create another" submission.
 *
 * NEW-11 names the two that stay — **project and type** — and is
 * explicit about why the rest must not: "carrying an assignee or a due
 * date silently into the next task is the specific failure this case
 * guards against". Its fourth bullet goes further and requires the
 * cleared fields to be *absent from the second task's frontmatter*,
 * not merely blank on screen. That is why this returns a fresh state
 * built from `emptyForm` rather than deleting keys from the old one:
 * a stale value cannot survive a field this function does not name.
 *
 * Status is cleared with the rest. It is not in the case's preserved
 * pair, and a status pre-filled from a board column (NEW-3) is a
 * property of *that* click, not of the next task.
 */
export function afterCreateAnother(prev: CreateFormState): CreateFormState {
  return emptyForm({
    project: prev.project,
    task_type: prev.task_type,
  });
}

/**
 * The request body for a form state, with empty values omitted.
 *
 * Omission rather than `null`/`""` is what NEW-2 and NEW-11 both need:
 * a field the user did not fill must take its **workflow default**
 * server-side, and an empty string is a value that defeats that and
 * then fails validation later. It is also what makes NEW-11's fourth
 * bullet true on disk — an omitted key is absent from frontmatter,
 * where `""` would be present and empty.
 */
export function toCreateRequest(form: CreateFormState): CreateTaskRequest {
  const title = form.title.trim();
  return {
    title,
    ...(form.project !== undefined ? { project: form.project } : {}),
    ...(form.status !== undefined ? { status: form.status } : {}),
    ...(form.priority !== undefined ? { priority: form.priority } : {}),
    ...(form.task_type !== undefined ? { task_type: form.task_type } : {}),
    ...(form.sprint !== undefined ? { sprint: form.sprint } : {}),
    ...(form.milestone !== undefined ? { milestone: form.milestone } : {}),
    ...(form.assignee !== undefined ? { assignee: form.assignee } : {}),
    ...(form.reporter !== undefined ? { reporter: form.reporter } : {}),
    ...(form.labels.length > 0 ? { labels: [...form.labels] } : {}),
    ...(form.start_date !== undefined ? { start_date: form.start_date } : {}),
    ...(form.due_date !== undefined ? { due_date: form.due_date } : {}),
    ...(form.body.trim() !== "" ? { body: form.body } : {}),
    ...(Object.keys(form.fields).length > 0 ? { fields: form.fields } : {}),
  };
}

/**
 * Whether the form holds anything the user would mind losing.
 *
 * NEW-27 wants the discard prompt to be *proportionate*: an untouched
 * modal closes immediately, a modal with typed content asks first. So
 * this asks "did the user put something here", which is not the same
 * as "does this differ from the initial state" — a pre-filled project
 * or a board column's status is the app's contribution, not the
 * user's, and prompting over it would make the confirmation
 * meaningless through familiarity.
 */
export function hasUserContent(form: CreateFormState, initial: CreateFormState): boolean {
  if (form.title.trim() !== "") return true;
  if (form.body.trim() !== "") return true;
  if (form.labels.length > 0) return true;
  if (Object.keys(form.fields).length > 0) return true;
  return (
    form.priority !== initial.priority
    || form.task_type !== initial.task_type
    || form.sprint !== initial.sprint
    || form.milestone !== initial.milestone
    || form.assignee !== initial.assignee
    || form.reporter !== initial.reporter
    || form.start_date !== initial.start_date
    || form.due_date !== initial.due_date
    || form.status !== initial.status
    || form.project !== initial.project
  );
}

/**
 * NEW-26: a due date before the start date, caught before submission.
 *
 * String comparison is correct and deliberate here: both are
 * `YYYY-MM-DD`, which sorts lexicographically in date order. Parsing
 * to `Date` would introduce a timezone the stored values do not have —
 * the thing NEW-8's third bullet forbids.
 */
export function dateRangeProblem(
  start: string | undefined,
  due: string | undefined,
): string | undefined {
  if (start === undefined || due === undefined) return undefined;
  if (start === "" || due === "") return undefined;
  if (due >= start) return undefined;
  return `Due date ${due} is before the start date ${start}.`;
}
