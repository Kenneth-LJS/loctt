import type {
  CalendarConfig,
  CustomFieldDef,
  LabelDef,
  MilestoneDef,
  SprintDef,
  TaskFrontmatterPublic,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";

import { relativeTime, shortDate } from "../list/format.ts";
import type { ListLookups } from "../list/lookups.ts";
import { customFieldRows } from "./editors/CustomFields.tsx";
import { DateField } from "./editors/DateField.tsx";
import { LabelsField } from "./editors/LabelsField.tsx";
import type { PickerOption } from "./editors/OptionPicker.tsx";
import { OptionPicker } from "./editors/OptionPicker.tsx";
import { TextField } from "./editors/TextField.tsx";
import type { FieldFailure } from "./fieldFailure.ts";
import { FieldFailureNotice } from "./FieldFailureNotice.tsx";

/**
 * The detail page's right-hand meta panel — **editable from M2.2a**.
 *
 * Every row writes through one verb: `POST /api/tasks/:ref/set`, one
 * field per request (`useSetField`). There is no PATCH or PUT on
 * `/api/tasks/:ref`.
 *
 * ## P3 governs every control here
 *
 * No status, priority, type, enum value, milestone or sprint is
 * hardcoded anywhere in this file or the editors beneath it. Each list
 * is `workflow.yaml` (or the relevant config) in its configured order,
 * rendered by `label` and stored by `key`. A tracker with seven
 * statuses gets seven; a tracker whose statuses are in Welsh gets
 * Welsh. The one place a colour appears it is the colour the user
 * configured, never a map from a key this app decided to know about.
 *
 * ## What is deliberately *not* editable
 *
 *  - **Completed date** (TSK-5). Core lists it in `AUTO_MANAGED_FIELDS`
 *    and refuses a direct write; it is stamped when the status moves
 *    into a `completed`-category status and cleared on the way out.
 *    Rendering an edit affordance would offer the user a control whose
 *    every use the server rejects.
 *  - **Key and key history** (XS-42). `key` is in core's
 *    `USER_IMMUTABLE_FIELDS`, so the API rejects it; there is no
 *    control for either, and the footer renders key history as prose.
 *  - **Project.** Moving a task between projects rekeys it, which is
 *    the Move dialog's job (M2.1) rather than a dropdown's — and
 *    `project` is immutable to `setField` for that reason.
 *  - **Created / updated.** Stamped by the tracker.
 */
export function MetaPanel({
  frontmatter: fm,
  lookups,
  workflow,
  users,
  labels,
  milestones,
  sprints,
  calendar,
  onSet,
  onUnset,
  onCreateLabel,
  labelError,
  onDismissLabelError,
  fieldError,
  onRetryField,
  onDismissFieldError,
}: {
  readonly frontmatter: TaskFrontmatterPublic;
  readonly lookups: ListLookups;
  readonly workflow: WorkflowConfig | undefined;
  readonly users: readonly UserProfile[];
  readonly labels: readonly LabelDef[];
  readonly milestones: readonly MilestoneDef[];
  readonly sprints: readonly SprintDef[];
  readonly calendar: CalendarConfig | undefined;
  readonly onSet: (field: string, value: unknown) => void;
  readonly onUnset: (field: string) => void;
  readonly onCreateLabel: (name: string) => Promise<string | undefined>;
  readonly labelError?: string | undefined;
  readonly onDismissLabelError?: (() => void) | undefined;
  /**
   * A server rejection, keyed by the field it belongs to.
   *
   * ERR-14 / P4: it renders under *that* control, not as a toast. The
   * server's envelope carries `field` for exactly this — the panel
   * does not have to parse a message to find out where it goes.
   *
   * M2.2b widened this from `{ field, message }` to the whole
   * `FieldFailure`. A message is enough for a bad enum value and
   * wrong for everything else: ERR-3 needs the data-state claim in
   * words, ERR-4 needs "unknown" not to become "not saved", and
   * XS-57 needs `not_found` to demote retry. None of those are
   * recoverable from message text.
   */
  readonly fieldError?: FieldFailure | undefined;
  /** Re-sends the failed write. Absent when retrying cannot help. */
  readonly onRetryField?: (() => void) | undefined;
  readonly onDismissFieldError?: (() => void) | undefined;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const project = lookups.project(fm.project);

  const statusOptions = (workflow?.statuses ?? []).map(s => ({
    key: s.key,
    label: s.label,
    ...(s.color !== undefined ? { color: s.color } : {}),
  }));
  const priorityOptions = (workflow?.priorities ?? []).map(p => ({
    key: p.key,
    label: p.label,
    ...(p.color !== undefined ? { color: p.color } : {}),
  }));
  const typeOptions = (workflow?.task_types ?? []).map(t => ({
    key: t.key,
    label: t.label,
    ...(t.color !== undefined ? { color: t.color } : {}),
  }));

  // TSK-12's fourth bullet: fields scoped to a task type appear only
  // for that type, and changing the type updates the set without a
  // reload — which it does for free, because the visible set is
  // derived from `fm.task_type` on every render and the optimistic
  // type change updates that immediately.
  const customDefs = scopedCustomFields(workflow?.custom_fields ?? [], fm.task_type);

  const estimate = estimateControl(workflow, fm.estimate, onSet, onUnset);

  /** The rejection belonging to `field`, or undefined. */
  const errorFor = (field: string): FieldFailure | undefined =>
    fieldError?.field === field ? fieldError : undefined;

  /**
   * The props every row shares, spread at each call site.
   *
   * **Not a component defined here.** A `const Row = props => …` inside
   * this function is a *new component type* on every render, so React
   * unmounts and remounts the whole subtree rather than updating it —
   * and an open `TextField` loses its draft the moment a background
   * refetch repaints any other row. That is precisely the clobbering
   * XS-4's second bullet forbids, arriving from the panel rather than
   * from the editor. Written the obvious way first, and caught by
   * XS-4's test.
   */
  const rowShared = {
    taskKey: fm.key,
    ...(onRetryField !== undefined ? { onRetry: onRetryField } : {}),
    ...(onDismissFieldError !== undefined ? { onDismiss: onDismissFieldError } : {}),
  } as const;

  return (
    <aside
      aria-label="Task details"
      data-testid="meta-panel"
      // No `overflow-y-auto`: without a max-height it would do
      // nothing. TSK-26's "the panel remains scrollable" is satisfied
      // by the detail page's own scroll container, which is what
      // carries a 25-label panel past the fold.
      className="min-w-0 self-start rounded-lg border border-border-subtle bg-bg-surface p-4"
    >
      <dl className="space-y-3">
        <Row {...rowShared} label="Status" error={errorFor("status")}>
          <OptionPicker
            label="Status"
            value={fm.status}
            options={statusOptions}
            onSelect={v => { onSet("status", v); }}
          />
        </Row>

        <Row {...rowShared} label="Type" error={errorFor("task_type")}>
          <OptionPicker
            label="Type"
            value={fm.task_type}
            options={typeOptions}
            onSelect={v => { onSet("task_type", v); }}
            onClear={() => { onUnset("task_type"); }}
          />
        </Row>

        <Row {...rowShared} label="Priority" error={errorFor("priority")}>
          <OptionPicker
            label="Priority"
            value={fm.priority}
            options={priorityOptions}
            onSelect={v => { onSet("priority", v); }}
            onClear={() => { onUnset("priority"); }}
          />
        </Row>

        {/* Read-only: a project change rekeys, so it is the Move
            dialog's job and `setField` refuses the field outright. */}
        <Row {...rowShared} label="Project">
          <span className="text-[13px] text-text-primary">
            {fm.project === undefined
              ? <span className="text-text-tertiary">—</span>
              : project?.name ?? "unresolved — not in the current config"}
          </span>
        </Row>

        <Row {...rowShared} label="Assignee" error={errorFor("assignee")}>
          <OptionPicker
            label="Assignee"
            value={fm.assignee}
            options={userOptions(users, fm.assignee)}
            onSelect={v => { onSet("assignee", v); }}
            onClear={() => { onUnset("assignee"); }}
            disabledReason="Archived users cannot be assigned new work."
          />
        </Row>

        <Row {...rowShared} label="Reporter" error={errorFor("reporter")}>
          <OptionPicker
            label="Reporter"
            value={fm.reporter}
            options={userOptions(users, fm.reporter)}
            onSelect={v => { onSet("reporter", v); }}
            onClear={() => { onUnset("reporter"); }}
            disabledReason="Archived users cannot be set as reporter."
          />
        </Row>

        <Row {...rowShared} label="Labels" error={errorFor("labels")}>
          <LabelsField
            attached={fm.labels ?? []}
            all={labels}
            onChange={ids => {
              // TSK-42 again: the last label removed clears the field
              // rather than storing `[]`.
              if (ids.length === 0) onUnset("labels");
              else onSet("labels", ids);
            }}
            onCreate={onCreateLabel}
            createError={labelError}
            onDismissCreateError={onDismissLabelError}
          />
        </Row>

        <Row {...rowShared} label="Milestone" error={errorFor("milestone")}>
          <OptionPicker
            label="Milestone"
            value={fm.milestone}
            options={namedOptions(milestones, fm.milestone)}
            onSelect={v => { onSet("milestone", v); }}
            onClear={() => { onUnset("milestone"); }}
            disabledReason="Archived milestones cannot be newly assigned."
          />
        </Row>

        <Row {...rowShared} label="Sprint" error={errorFor("sprint")}>
          <OptionPicker
            label="Sprint"
            value={fm.sprint}
            options={namedOptions(sprints, fm.sprint)}
            onSelect={v => { onSet("sprint", v); }}
            onClear={() => { onUnset("sprint"); }}
            disabledReason="Archived sprints cannot be newly assigned."
          />
        </Row>

        <Row {...rowShared} label="Start" error={errorFor("start_date")}>
          <DateField
            label="Start"
            value={fm.start_date}
            calendar={calendar}
            onCommit={v => { onSet("start_date", v); }}
            onClear={() => { onUnset("start_date"); }}
            {...datesInverted(fm.start_date, fm.due_date)
              ? { problem: "The start date is after the due date." }
              : {}}
          />
        </Row>

        <Row {...rowShared} label="Due" error={errorFor("due_date")}>
          <DateField
            label="Due"
            value={fm.due_date}
            calendar={calendar}
            onCommit={v => { onSet("due_date", v); }}
            onClear={() => { onUnset("due_date"); }}
            {...datesInverted(fm.start_date, fm.due_date)
              ? { problem: "The due date is before the start date." }
              : {}}
          />
        </Row>

        {/* Absent entirely when estimation is disabled — TSK-9's third
            bullet says absent, not "shown empty". */}
        {estimate !== null && (
          <Row {...rowShared} label="Estimate" error={errorFor("estimate")}>{estimate}</Row>
        )}

        {/* TSK-5: present only when set, and never with an edit
            affordance. Its own row rather than a disabled control,
            because a disabled control still says "this is editable,
            just not now", which is not what auto-managed means. */}
        {fm.completed_date !== undefined && (
          <Row {...rowShared} label="Completed">
            <span
              data-testid="meta-completed-date"
              className="text-[13px] text-text-primary"
            >
              {shortDate(fm.completed_date, today)}
              <span className="ml-1 text-[11px] text-text-tertiary">
                (set by the status)
              </span>
            </span>
          </Row>
        )}

        {customFieldRows({
          defs: customDefs,
          values: fm.fields ?? {},
          onSet,
          onUnset,
        }).map(row => (
          <Row {...rowShared} key={row.key} label={row.label} error={errorFor(row.key)}>
            {row.node}
          </Row>
        ))}
      </dl>

      <Footer frontmatter={fm} />
    </aside>
  );
}

/**
 * Created / updated / previous keys (TSK-14, XS-46).
 *
 * Relative times with the absolute timestamp on `title`, so the
 * precise instant is recoverable without spending a row on it.
 *
 * The previous-keys row renders **only when `key_history` is
 * non-empty**. Both cases spell that out — no empty "Previous keys:"
 * label with nothing after it — and it is the kind of thing a
 * conditional on the *array* rather than on its length gets wrong,
 * since `[]` is truthy.
 */
function Footer({
  frontmatter: fm,
}: {
  readonly frontmatter: TaskFrontmatterPublic;
}) {
  const history = fm.key_history ?? [];
  // Read once per render rather than held in state: the panel
  // re-renders whenever the task refetches, which is exactly when the
  // stamp has moved. A ticking clock would be its own case.
  const now = Date.now();
  return (
    <div className="mt-4 space-y-1 border-t border-border-subtle pt-3 text-[11px] text-text-tertiary">
      <p data-testid="meta-created">
        Created <time title={fm.created_at}>{relativeTime(fm.created_at, now)}</time>
      </p>
      {/* **Relative, not a short date.** This block's own comment has
          said "relative times" since M2.1 while the code rendered
          `shortDate` — day granularity, so a CLI write and the page
          load beside it produce the identical string. XS-4's third
          bullet requires the footer show "something changed *and
          when*" after a `loctt set`, which a date that cannot move
          within the day does not. `relativeTime` already existed for
          the list's Updated column; the footer now uses it, and the
          exact instant stays recoverable on `title` as before. */}
      <p data-testid="meta-updated">
        Updated <time title={fm.updated_at}>{relativeTime(fm.updated_at, now)}</time>
      </p>
      {history.length > 0 && (
        <p data-testid="meta-key-history">
          {/* Named as previous so they are not mistaken for the live
              key, and phrased so a user whose bookmark changed can see
              why (XS-46's second bullet). */}
          Previously {history.map(k => <code key={k} className="font-mono">{k}</code>)
            .reduce<React.ReactNode[]>((acc, node, i) => i === 0 ? [node] : [...acc, ", ", node], [])}
          {" — now "}
          <code className="font-mono">{fm.key}</code>. Old links still resolve.
        </p>
      )}
    </div>
  );
}

/**
 * The estimate control for the configured estimation mode (TSK-9).
 *
 * `null` means the row does not exist — estimation absent or disabled.
 * Distinct from a rendered-but-empty control, which the case forbids.
 */
function estimateControl(
  workflow: WorkflowConfig | undefined,
  value: string | undefined,
  onSet: (field: string, value: unknown) => void,
  onUnset: (field: string) => void,
): React.ReactNode | null {
  const est = workflow?.estimation;
  if (est === undefined || !est.enabled) return null;

  if (est.unit === "custom_enum") {
    // Constrained to `preset_values` — a free-text box here would let
    // a value outside the scale reach the file, which is the whole
    // point of declaring a scale.
    const options: PickerOption[] = (est.preset_values ?? []).map(v => ({
      key: String(v),
      label: String(v),
    }));
    return (
      <OptionPicker
        label="Estimate"
        value={value}
        options={options}
        onSelect={v => { onSet("estimate", v); }}
        onClear={() => { onUnset("estimate"); }}
      />
    );
  }

  // Numeric modes. `unit_label` is required for `custom_numeric` and
  // absent for the built-in units, whose own names read correctly as
  // the suffix ("5 points").
  const suffix = est.unit_label ?? est.unit;
  return (
    <TextField
      label="Estimate"
      value={value}
      numeric
      suffix={suffix}
      onCommit={v => { onSet("estimate", Number(v)); }}
      onClear={() => { onUnset("estimate"); }}
    />
  );
}

/**
 * Custom fields visible for a task of this type.
 *
 * **`CustomFieldDef` carries no type scope today.** TSK-12's fourth
 * bullet describes fields "scoped to a task type", and the schema
 * (`packages/contracts/src/workflow.ts`) has `key`, `label`, `type`,
 * `multi`, `searchable` and `values` — no `task_types`. So every
 * declared field applies to every task, and this function is the seam
 * where scoping would land rather than a scoping implementation.
 *
 * Adding the field to the contract is a schema change with CLI, MCP
 * and settings-UI consequences, which is outside this ticket. The
 * bullet is reported unmet rather than faked.
 */
function scopedCustomFields(
  defs: readonly CustomFieldDef[],
  _taskType: string | undefined,
): readonly CustomFieldDef[] {
  return defs;
}

/**
 * User picker options (TSK-7).
 *
 * Archived users are **present and disabled**, not filtered out: a
 * task already assigned to one must keep displaying that name with the
 * marker, and an option list that omitted them would render the
 * current value as unrecognized. The `current` argument is not used to
 * decide inclusion for that reason — everyone is included; archiving
 * only decides selectability.
 *
 * Display names are not unique, so a name shared by two profiles gets
 * a truncated id beside each. Only where it collides: a hint on every
 * row would be noise, and the ULID fragment is meaningless except as a
 * tiebreak.
 */
function userOptions(
  users: readonly UserProfile[],
  _current: string | undefined,
): readonly PickerOption[] {
  const nameCounts = new Map<string, number>();
  for (const u of users) {
    nameCounts.set(u.name, (nameCounts.get(u.name) ?? 0) + 1);
  }
  return users.map(u => ({
    key: u.id,
    label: u.name,
    ...(u.archived === true ? { disabled: true, suffix: "(archived)" } : {}),
    ...((nameCounts.get(u.name) ?? 0) > 1 ? { hint: u.id.slice(-6) } : {}),
  }));
}

/** Milestone / sprint options — same archived rule as users. */
function namedOptions(
  entries: readonly { id: string; name: string; archived?: boolean | undefined }[],
  _current: string | undefined,
): readonly PickerOption[] {
  return entries.map(e => ({
    key: e.id,
    label: e.name,
    ...(e.archived === true ? { disabled: true, suffix: "(archived)" } : {}),
  }));
}

/**
 * Whether start is after due (TSK-8's fourth bullet).
 *
 * Both are `YYYY-MM-DD`, so a lexical compare is chronological — and
 * unlike a `Date` round-trip it cannot move a date across a timezone
 * boundary on the way to the comparison.
 */
function datesInverted(start: string | undefined, due: string | undefined): boolean {
  if (start === undefined || due === undefined) return false;
  return start.slice(0, 10) > due.slice(0, 10);
}

function Row({
  label,
  children,
  error,
  taskKey,
  onRetry,
  onDismiss,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly error?: FieldFailure | undefined;
  readonly taskKey: string;
  readonly onRetry?: (() => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[13px]">
      <dt className="pt-0.5 text-text-tertiary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">
        {children}
        {error !== undefined && (
          // At the field, not in a toast (P4). The notice adds the two
          // things the server's sentence cannot carry: what state the
          // file is in, and which control is honest to offer.
          <FieldFailureNotice
            failure={error}
            taskKey={taskKey}
            {...(error.retry !== undefined && onRetry !== undefined
              ? { onRetry }
              : {})}
            {...(onDismiss !== undefined ? { onDismiss } : {})}
          />
        )}
      </dd>
    </div>
  );
}
