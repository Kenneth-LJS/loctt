import type {
  CalendarConfig,
  LabelDef,
  MilestoneDef,
  SprintDef,
  TaskFrontmatterPublic,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";

import type { WireHealth } from "../health/fieldHealth.ts";
import { fieldView, unrecognisedHealth } from "../health/fieldHealth.ts";
import { relativeTime, shortDate } from "../list/format.ts";
import type { ListLookups } from "../list/lookups.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { UserAvatar } from "../ui/UserAvatar.tsx";
import { customFieldRows } from "./editors/CustomFields.tsx";
import { DateField } from "./editors/DateField.tsx";
import { LabelsField } from "./editors/LabelsField.tsx";
import type { PickerOption } from "./editors/OptionPicker.tsx";
import { fieldSlug, OptionPicker } from "./editors/OptionPicker.tsx";
import { TextField } from "./editors/TextField.tsx";
import { estimationShape } from "./estimation.ts";
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
  health,
  lookups,
  workflow,
  users,
  labels,
  milestones,
  sprints,
  calendar,
  currentUser,
  identityUnknown,
  onSet,
  onUnset,
  onCreateLabel,
  searchLabels,
  searchMilestones,
  searchSprints,
  searchUsers,
  labelError,
  onDismissLabelError,
  fieldError,
  onRetryField,
  onDismissFieldError,
}: {
  readonly frontmatter: TaskFrontmatterPublic;
  /**
   * Field-level health findings for this task (DEG-29 / UX-7), straight
   * from `GET /api/tasks/:ref`. Two kinds surface here:
   *
   *  - a **corrupt** field (`wrong_type` / `missing_required`) — its
   *    value is *not* in `frontmatter` (the tolerant parse lifted it out),
   *    so a row that only reads `fm` renders a bare "—" that reads as
   *    "no value". Instead the row shows the stored value with a warning
   *    (`Due ⚠ corrupt: 42`) and a Clear control, so the fault is visible
   *    and fixable rather than silently empty.
   *  - an **unrecognised** preserved key (`jira_id: ABC-123`, P7) — the
   *    schema did not know it but the file kept it. The "Not recognised"
   *    group lists these so the person editing the task can see they
   *    exist (closes the DEG-7 client blind spot).
   *
   * Omitted when the task is clean.
   */
  readonly health?: readonly WireHealth[] | undefined;
  readonly lookups: ListLookups;
  readonly workflow: WorkflowConfig | undefined;
  readonly users: readonly UserProfile[];
  readonly labels: readonly LabelDef[];
  readonly milestones: readonly MilestoneDef[];
  readonly sprints: readonly SprintDef[];
  readonly calendar: CalendarConfig | undefined;
  /**
   * L3: the current (active) user, for the "Assign to me" quick action.
   * `null` when the current-user read failed — identity is unknown
   * (SHL-40), which also sets {@link identityUnknown}; the quick action
   * is then hidden rather than writing under a guessed identity.
   */
  readonly currentUser?: UserProfile | null | undefined;
  /** L3: true when identity is unknown (SHL-40) — hides "Assign to me". */
  readonly identityUnknown?: boolean | undefined;
  readonly onSet: (field: string, value: unknown) => void;
  readonly onUnset: (field: string) => void;
  readonly onCreateLabel: (name: string) => Promise<string | undefined>;
  /** K90: server-side label search for the picker (see LabelsField). */
  readonly searchLabels: (q: string) => Promise<readonly LabelDef[]>;
  /** K90: server-side searches for the milestone/sprint/user pickers. */
  readonly searchMilestones: (q: string) => Promise<readonly MilestoneDef[]>;
  readonly searchSprints: (q: string) => Promise<readonly SprintDef[]>;
  readonly searchUsers: (q: string) => Promise<readonly UserProfile[]>;
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

  // L3: the resolved assignee/reporter profiles, for the avatar beside
  // each picker (matching the list's AssigneeCell). Undefined for an
  // unset field or a dangling id the tracker no longer knows — no face
  // for a referent that cannot be shown.
  const assigneeUser = users.find(u => u.id === fm.assignee);
  const reporterUser = users.find(u => u.id === fm.reporter);

  /**
   * L3: whether the "Assign to me" quick action is offered. Hidden when
   *  - identity is unknown (SHL-40 refuses attributed writes — writing
   *    under a guessed identity is exactly what that block prevents),
   *  - there is no current user at all,
   *  - the current user is archived (archived users cannot be assigned
   *    new work — TSK-7), or
   *  - the current user is already the assignee (nothing to do).
   */
  const assignableSelf =
    identityUnknown !== true &&
    currentUser !== null &&
    currentUser !== undefined &&
    currentUser.archived !== true &&
    fm.assignee !== currentUser.id
      ? currentUser
      : undefined;

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
  // reload — which it does for free, because `customFieldRows` derives
  // the visible set from `fm.task_type` on every render, and the
  // optimistic type change updates that immediately (no refetch). The
  // full declared set is passed through; the scope filter (and the
  // out-of-scope-with-value read-only rendering) lives in
  // `customFieldRows`.
  const allCustomDefs = workflow?.custom_fields ?? [];

  const estimate = estimateControl(workflow, fm.estimate, onSet, onUnset);

  /** The rejection belonging to `field`, or undefined. */
  const errorFor = (field: string): FieldFailure | undefined =>
    fieldError?.field === field ? fieldError : undefined;

  /**
   * The whole-field corruption on `field`, or undefined (DEG-29 / UX-7).
   *
   * Only whole-field faults (`wrong_type` / `missing_required`) render as
   * the corrupt-value notice: their value was lifted out of `frontmatter`,
   * so the editor row would otherwise show an empty "—". An element fault
   * (`labels[2]`) leaves the field's value in `frontmatter`, so its row
   * still renders the value — element faults are not this row's business.
   */
  const corruptFor = (field: string): WireHealth | undefined =>
    fieldView(field, undefined, health).fieldHealth;

  const unrecognised = unrecognisedHealth(health);

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
        <Row {...rowShared} label="Status" error={errorFor("status")} corrupt={corruptFor("status")} onClearCorrupt={() => { onUnset("status"); }}>
          <OptionPicker
            label="Status"
            value={fm.status}
            options={statusOptions}
            onSelect={v => { onSet("status", v); }}
          />
        </Row>

        <Row {...rowShared} label="Type" error={errorFor("task_type")} corrupt={corruptFor("task_type")} onClearCorrupt={() => { onUnset("task_type"); }}>
          <OptionPicker
            label="Type"
            value={fm.task_type}
            options={typeOptions}
            onSelect={v => { onSet("task_type", v); }}
            onClear={() => { onUnset("task_type"); }}
            emptyText="Set type"
          />
        </Row>

        <Row {...rowShared} label="Priority" error={errorFor("priority")} corrupt={corruptFor("priority")} onClearCorrupt={() => { onUnset("priority"); }}>
          <OptionPicker
            label="Priority"
            value={fm.priority}
            options={priorityOptions}
            onSelect={v => { onSet("priority", v); }}
            onClear={() => { onUnset("priority"); }}
            emptyText="Set priority"
          />
        </Row>

        {/* Read-only: a project change rekeys, so it is the Move
            dialog's job and `setField` refuses the field outright. */}
        <Row {...rowShared} label="Project">
          <span className="text-[0.9286rem] text-text-primary">
            {fm.project === undefined
              ? <span className="text-text-tertiary">—</span>
              : project?.name ?? "unresolved — not in the current config"}
          </span>
        </Row>

        <Row {...rowShared} label="Assignee" error={errorFor("assignee")} corrupt={corruptFor("assignee")} onClearCorrupt={() => { onUnset("assignee"); }}>
          <div className="flex min-w-0 items-center gap-1.5">
            {/* L3: show the assigned person's face beside the picker,
                matching the list's AssigneeCell. The avatar in the picker
                *options* would need Combobox internals (off-limits), so it
                lives here in the row's trigger area instead — noted. */}
            {assigneeUser !== undefined && (
              <UserAvatar
                user={assigneeUser}
                sizeClass="h-5 w-5 text-[0.7143rem]"
                testId="meta-assignee-avatar"
              />
            )}
            <div className="min-w-0 flex-1">
              <OptionPicker
                label="Assignee"
                value={fm.assignee}
                options={userOptions(users, fm.assignee)}
                onSelect={v => { onSet("assignee", v); }}
                onClear={() => { onUnset("assignee"); }}
                emptyText="Add assignee"
                search={{
                  onQuery: q => searchUsers(q).then(rows => userOptions(rows, fm.assignee)),
                  placeholder: "Search users…",
                }}
                disabledReason="Archived users cannot be assigned new work."
              />
            </div>
          </div>
          {/* L3: "Assign to me". Hidden when the current user is already
              the assignee, when identity is unknown (SHL-40 refuses
              attributed writes), and when the current user is archived
              (archived users cannot be assigned new work — TSK-7). */}
          {assignableSelf !== undefined && (
            <div className="mt-1">
              <Button
                variant="ghost"
                size="sm"
                testId="meta-assign-to-me"
                onClick={() => { onSet("assignee", assignableSelf.id); }}
                className="-mx-1 h-6 text-accent"
              >
                Assign to me
              </Button>
            </div>
          )}
        </Row>

        <Row {...rowShared} label="Reporter" error={errorFor("reporter")} corrupt={corruptFor("reporter")} onClearCorrupt={() => { onUnset("reporter"); }}>
          <div className="flex min-w-0 items-center gap-1.5">
            {reporterUser !== undefined && (
              <UserAvatar
                user={reporterUser}
                sizeClass="h-5 w-5 text-[0.7143rem]"
                testId="meta-reporter-avatar"
              />
            )}
            <div className="min-w-0 flex-1">
              <OptionPicker
                label="Reporter"
                value={fm.reporter}
                options={userOptions(users, fm.reporter)}
                onSelect={v => { onSet("reporter", v); }}
                onClear={() => { onUnset("reporter"); }}
                emptyText="Add reporter"
                disabledReason="Archived users cannot be set as reporter."
                search={{
                  onQuery: q => searchUsers(q).then(rows => userOptions(rows, fm.reporter)),
                  placeholder: "Search users…",
                }}
              />
            </div>
          </div>
        </Row>

        <Row {...rowShared} label="Labels" error={errorFor("labels")} corrupt={corruptFor("labels")} onClearCorrupt={() => { onUnset("labels"); }}>
          <LabelsField
            attached={fm.labels ?? []}
            all={labels}
            searchLabels={searchLabels}
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

        <Row {...rowShared} label="Milestone" error={errorFor("milestone")} corrupt={corruptFor("milestone")} onClearCorrupt={() => { onUnset("milestone"); }}>
          <OptionPicker
            label="Milestone"
            value={fm.milestone}
            options={namedOptions(milestones, fm.milestone)}
            onSelect={v => { onSet("milestone", v); }}
            onClear={() => { onUnset("milestone"); }}
            emptyText="Add milestone"
            disabledReason="Archived milestones cannot be newly assigned."
            search={{
              onQuery: q => searchMilestones(q).then(rows => namedOptions(rows, fm.milestone)),
              placeholder: "Search milestones…",
            }}
          />
        </Row>

        <Row {...rowShared} label="Sprint" error={errorFor("sprint")} corrupt={corruptFor("sprint")} onClearCorrupt={() => { onUnset("sprint"); }}>
          <OptionPicker
            label="Sprint"
            value={fm.sprint}
            options={namedOptions(sprints, fm.sprint)}
            onSelect={v => { onSet("sprint", v); }}
            onClear={() => { onUnset("sprint"); }}
            emptyText="Add to sprint"
            disabledReason="Archived sprints cannot be newly assigned."
            search={{
              onQuery: q => searchSprints(q).then(rows => namedOptions(rows, fm.sprint)),
              placeholder: "Search sprints…",
            }}
          />
        </Row>

        <Row {...rowShared} label="Start" error={errorFor("start_date")} corrupt={corruptFor("start_date")} onClearCorrupt={() => { onUnset("start_date"); }}>
          <DateField
            label="Start"
            value={fm.start_date}
            calendar={calendar}
            onCommit={v => { onSet("start_date", v); }}
            onClear={() => { onUnset("start_date"); }}
            emptyText="Set start date"
            {...datesInverted(fm.start_date, fm.due_date)
              ? { problem: "The start date is after the due date." }
              : {}}
          />
        </Row>

        <Row {...rowShared} label="Due" error={errorFor("due_date")} corrupt={corruptFor("due_date")} onClearCorrupt={() => { onUnset("due_date"); }}>
          <DateField
            label="Due"
            value={fm.due_date}
            calendar={calendar}
            onCommit={v => { onSet("due_date", v); }}
            onClear={() => { onUnset("due_date"); }}
            emptyText="Set due date"
            {...datesInverted(fm.start_date, fm.due_date)
              ? { problem: "The due date is before the start date." }
              : {}}
          />
        </Row>

        {/* Absent entirely when estimation is disabled — TSK-9's third
            bullet says absent, not "shown empty". */}
        {estimate !== null && (
          <Row {...rowShared} label="Estimate" error={errorFor("estimate")} corrupt={corruptFor("estimate")} onClearCorrupt={() => { onUnset("estimate"); }}>{estimate}</Row>
        )}

        {/* TSK-5: present only when set, and never with an edit
            affordance. Its own row rather than a disabled control,
            because a disabled control still says "this is editable,
            just not now", which is not what auto-managed means. */}
        {fm.completed_date !== undefined && (
          <Row {...rowShared} label="Completed">
            <span
              data-testid="meta-completed-date"
              className="text-[0.9286rem] text-text-primary"
            >
              {shortDate(fm.completed_date, today)}
              <span className="ml-1 text-[0.7857rem] text-text-tertiary">
                (set by the status)
              </span>
            </span>
          </Row>
        )}

        {customFieldRows({
          defs: allCustomDefs,
          taskType: fm.task_type,
          values: fm.fields ?? {},
          onSet,
          onUnset,
        }).map(row => (
          <Row
            {...rowShared}
            key={row.key}
            label={row.label}
            error={errorFor(row.key)}
            // Health entries for a custom field are keyed `fields.<key>`
            // (that is how core's validator attributes them), so the
            // lookup uses the dotted form — but the UNSET call takes the
            // BARE key, exactly as the healthy editor does
            // (CustomFields.tsx `onUnset(def.key)`). Sending the dotted
            // form 400s ("custom field \"fields.x\" is not set"), so a
            // corrupt custom field could never be cleared.
            corrupt={corruptFor(`fields.${row.key}`)}
            onClearCorrupt={() => { onUnset(row.key); }}
          >
            {row.node}
          </Row>
        ))}
      </dl>

      {/* DEG-7 / DEG-29 (UX-7): preserved keys the schema does not know.
          Rendered by a client component here (the DEG-7 client blind spot
          — before this, only a core round-trip test and an sr-only span in
          the list cell covered it) so the person editing the task can see
          the key exists and remove it. */}
      {unrecognised.length > 0 && (
        <UnrecognisedGroup
          fields={unrecognised}
          onRemove={field => { onUnset(field); }}
        />
      )}

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
    <div className="mt-4 space-y-1 border-t border-border-subtle pt-3 text-[0.7857rem] text-text-tertiary">
      <p data-testid="meta-created">
        {/* K26: `created_at` is field-local — a corrupt/absent stamp
            still loads the task, so the footer shows a dash rather than
            "Invalid Date". */}
        Created{" "}
        {fm.created_at === undefined ? (
          <span>—</span>
        ) : (
          <time title={fm.created_at}>{relativeTime(fm.created_at, now)}</time>
        )}
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
        Updated{" "}
        {fm.updated_at === undefined ? (
          <span>—</span>
        ) : (
          <time title={fm.updated_at}>{relativeTime(fm.updated_at, now)}</time>
        )}
      </p>
      {history.length > 0 && (
        <p data-testid="meta-key-history">
          {/* Named as previous so they are not mistaken for the live
              key, and phrased so a user whose bookmark changed can see
              why (XS-46's second bullet). */}
          Previously {history.map(k => <code key={k}>{k}</code>)
            .reduce<React.ReactNode[]>((acc, node, i) => i === 0 ? [node] : [...acc, ", ", node], [])}
          {" — now "}
          <code>{fm.key}</code>. Old links still resolve.
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
  // The shape (disabled / enum / numeric) is decided by the shared
  // `estimationShape` so this control and the create modal's cannot
  // disagree about what the same config means (SET-9's "everywhere it
  // appears").
  const shape = estimationShape(workflow);
  if (shape === null) return null;

  if (shape.kind === "enum") {
    // Constrained to `preset_values` — a free-text box here would let
    // a value outside the scale reach the file, which is the whole
    // point of declaring a scale.
    const options: PickerOption[] = shape.options.map(v => ({ key: v, label: v }));
    return (
      <OptionPicker
        label="Estimate"
        value={value}
        options={options}
        onSelect={v => { onSet("estimate", v); }}
        onClear={() => { onUnset("estimate"); }}
        emptyText="Add estimate"
      />
    );
  }

  return (
    <TextField
      label="Estimate"
      value={value}
      numeric
      suffix={shape.suffix}
      placeholder="Add estimate"
      onCommit={v => { onSet("estimate", Number(v)); }}
      onClear={() => { onUnset("estimate"); }}
    />
  );
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
  // O5: a corrupt/absent profile name is field-local; the picker
  // degrades that user's label to its id so no option renders blank.
  const displayName = (u: UserProfile) => u.name ?? u.id;
  const nameCounts = new Map<string, number>();
  for (const u of users) {
    const n = displayName(u);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  return users.map(u => ({
    key: u.id,
    label: displayName(u),
    ...(u.archived === true ? { disabled: true, suffix: "(archived)" } : {}),
    ...((nameCounts.get(displayName(u)) ?? 0) > 1 ? { hint: u.id.slice(-6) } : {}),
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
  corrupt,
  onClearCorrupt,
  taskKey,
  onRetry,
  onDismiss,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly error?: FieldFailure | undefined;
  /** A whole-field corruption on this row's field (DEG-29 / UX-7). */
  readonly corrupt?: WireHealth | undefined;
  /** Clears the corrupt value (removes the field). */
  readonly onClearCorrupt?: (() => void) | undefined;
  readonly taskKey: string;
  readonly onRetry?: (() => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[0.9286rem]">
      <dt className="pt-0.5 text-text-tertiary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">
        {corrupt !== undefined && (
          // The stored bad value + a warning, *above* the still-usable
          // editor below — so the value is visible (not a bare "—") and
          // the editor is the repair affordance (set a valid value),
          // beside an explicit Clear (remove the field). DEG-29 / UX-7.
          <CorruptFieldNotice
            label={label}
            health={corrupt}
            {...(onClearCorrupt !== undefined ? { onClear: onClearCorrupt } : {})}
          />
        )}
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

/**
 * A corrupt field's stored value, shown as a warning rather than the bare
 * "—" the editor would otherwise render (DEG-29 / UX-7).
 *
 * The tolerant parse lifted the bad value out of `frontmatter` into
 * `health`, so the editor below this notice has no value and would draw an
 * empty control that reads as "no value set". This notice makes the fault
 * *visible*: the label, a ⚠ glyph, the word "corrupt", and the raw stored
 * value (`Due ⚠ corrupt: 42`), with the validator's message on hover and
 * a screen-reader-only word so the signal is not colour- or glyph-only.
 *
 * Two repair paths: the editor immediately below sets a valid value; the
 * **Clear** here removes the field (`unset`), which core also drops the
 * health entry for so the raw value stops round-tripping.
 */
function CorruptFieldNotice({
  label,
  health,
  onClear,
}: {
  readonly label: string;
  readonly health: WireHealth;
  readonly onClear?: (() => void) | undefined;
}) {
  const slug = fieldSlug(label);
  return (
    <Callout
      tone="warn"
      role="status"
      testId={`meta-corrupt-${slug}`}
      className="mb-1 flex-col items-stretch gap-1 px-2 py-1.5 text-[0.8571rem]"
    >
      <p title={health.error}>
        <span className="font-medium">{label}</span>{" "}
        <span aria-hidden="true">⚠</span>{" "}
        corrupt:{" "}
        <span data-testid={`meta-corrupt-raw-${slug}`} className="break-all">
          {health.rawText}
        </span>
        <span className="sr-only"> (corrupt value — {health.error})</span>
      </p>
      {onClear !== undefined && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            testId={`meta-corrupt-clear-${slug}`}
            onClick={onClear}
            className="-mx-1 h-6 text-warn-fg underline"
          >
            Clear
          </Button>
        </div>
      )}
    </Callout>
  );
}

/**
 * The "Not recognised" group — preserved frontmatter keys the schema does
 * not know (P7 passthrough), listed so a person editing the task can see
 * they exist and remove them (DEG-7 / DEG-29 / UX-7).
 *
 * Read-only: an unrecognised key has no editor (LocTT does not know its
 * shape), so each row shows the key, its stored value, and a Remove
 * control — nothing else. Removing calls `unset`, which core clears from
 * disk (dropping the passthrough value and its health entry).
 *
 * This is the client render DEG-7 required: before it, the round-trip was
 * proven only by a core test, and the sole client trace was an sr-only
 * "(unrecognised)" in one list cell — no surface showed the key to a user.
 */
function UnrecognisedGroup({
  fields,
  onRemove,
}: {
  readonly fields: readonly WireHealth[];
  readonly onRemove: (field: string) => void;
}) {
  return (
    <section
      data-testid="meta-unrecognised-group"
      aria-label="Not recognised"
      className="mt-4 border-t border-border-subtle pt-3"
    >
      <h3 className="mb-2 text-[0.7857rem] font-medium uppercase tracking-wide text-text-tertiary">
        Not recognised
      </h3>
      <p className="mb-2 text-[0.7857rem] text-text-tertiary">
        These keys were kept from the file but LocTT does not use them.
      </p>
      <dl className="space-y-2">
        {fields.map(h => {
          const slug = fieldSlug(h.field);
          return (
            <div
              key={h.field}
              data-testid={`meta-unrecognised-${slug}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-[0.9286rem]"
            >
              <div className="min-w-0">
                <code className="text-text-secondary">{h.field}</code>
                {": "}
                <span className="break-all text-text-primary">{h.rawText}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                testId={`meta-unrecognised-remove-${slug}`}
                onClick={() => { onRemove(h.field); }}
                className="h-6 text-text-tertiary underline"
              >
                Remove
              </Button>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
