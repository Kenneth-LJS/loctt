import type { TaskFrontmatterPublic } from "@loctt/contracts";

import { shortDate } from "../list/format.ts";
import type { ListLookups } from "../list/lookups.ts";

/**
 * The detail page's right-hand meta panel — **read-only in M2.1**.
 * The inline editors land in M2.2; this ticket owes the column and
 * what it displays.
 *
 * Every stored value here is a key or a ULID on disk. None of them is
 * shown raw: statuses, priorities and types resolve through the
 * workflow's labels, project and assignee through their own configs.
 * P-4 keeps ULIDs out of UI content, and a raw workflow key
 * (`in_progress`) is not what the user configured as the label.
 *
 * A reference that no longer resolves is named as unresolved rather
 * than printed as its id — the same rule the list cells follow, for
 * the same reason: an eight-character fragment of a ULID tells the
 * reader nothing and looks like a legitimate value.
 */
export function MetaPanel({
  frontmatter: fm,
  lookups,
}: {
  readonly frontmatter: TaskFrontmatterPublic;
  readonly lookups: ListLookups;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const status = lookups.status(fm.status);
  const priority = lookups.priority(fm.priority);
  const taskType = lookups.taskType(fm.task_type);
  const project = lookups.project(fm.project);
  const assignee = lookups.user(fm.assignee);
  const reporter = lookups.user(fm.reporter);

  return (
    <aside
      aria-label="Task details"
      data-testid="meta-panel"
      className="min-w-0 self-start rounded-lg border border-border-subtle bg-bg-surface p-4"
    >
      <dl className="space-y-3">
      <Row label="Status" value={resolved(fm.status, status?.label)} />
      <Row label="Type" value={resolved(fm.task_type, taskType?.label)} />
      <Row label="Priority" value={resolved(fm.priority, priority?.label)} />
      <Row label="Project" value={resolved(fm.project, project?.name)} />
      <Row label="Assignee" value={resolved(fm.assignee, assignee?.name)} />
      <Row label="Reporter" value={resolved(fm.reporter, reporter?.name)} />
      <Row
        label="Labels"
        value={
          fm.labels === undefined || fm.labels.length === 0
            ? undefined
            : fm.labels.map(id => lookups.label(id)?.name ?? "unresolved").join(", ")
        }
      />
      <Row label="Start" value={fm.start_date === undefined ? undefined : shortDate(fm.start_date, today)} />
      <Row label="Due" value={fm.due_date === undefined ? undefined : shortDate(fm.due_date, today)} />
      <Row label="Estimate" value={fm.estimate} />
      <Row label="Created" value={shortDate(fm.created_at, today)} />
      <Row label="Updated" value={shortDate(fm.updated_at, today)} />
      </dl>
    </aside>
  );
}

/**
 * A stored value's display form.
 *
 * Three distinct states, kept apart: unset (nothing on disk), resolved
 * (a label from config), and set-but-unresolvable (config no longer
 * defines it — drift, which the user has to be told about rather than
 * shown as a raw id).
 */
function resolved(raw: string | undefined, label: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return label ?? "unresolved — not in the current config";
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[13px]">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">
        {value ?? <span className="text-text-tertiary">—</span>}
      </dd>
    </div>
  );
}
