import type { CalendarConfig, CustomFieldDef, ProjectDef } from "@loctt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { apiClient,ApiError, UnparseableBodyError } from "../api/client.ts";
import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { RichBuffer } from "../editor/markdown.ts";
import { RichEditor } from "../editor/RichEditor.tsx";
import { nonWorkingNote } from "../task/editors/DateField.tsx";
import { LabelsField } from "../task/editors/LabelsField.tsx";
import { OptionPicker } from "../task/editors/OptionPicker.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { useToasts } from "../ui/Toast.tsx";
import {
  afterCreateAnother,
  type CreateFormState,
  dateRangeProblem,
  emptyForm,
  hasUserContent,
  toCreateRequest,
} from "./formState.ts";
import { NO_PROJECT_MESSAGE, resolveProjectChoice } from "./projectChoice.ts";

/**
 * The single create-task modal (flow-task-create.md, NEW-1..41).
 *
 * ## One component, three entry points
 *
 * NEW-1 requires the header `+`, a board column's "+ Add task" and the
 * `n` shortcut to render *the same* modal — same fields, same layout,
 * same heading — differing only in what is pre-filled. That is why the
 * entry point is a single `initialStatus` prop rather than three
 * call sites each assembling a form: a field present in one and absent
 * in another is the failure the case names, and the only way to be
 * sure is to have nothing to diverge.
 *
 * ## What this does NOT implement
 *
 * The project resolution chain. `GET /api/projects` reports
 * `effective_default`, which core computed with the same function the
 * CLI and `POST /api/tasks` use. See `projectChoice.ts` for why
 * re-deriving it here would be a fourth opinion about where a task
 * lands.
 *
 * Nor the body editor: `RichEditor` is the one TipTap instance, shared
 * with task detail, so NEW-9's "matching what the full editor would
 * have produced for the same input" holds because it is literally the
 * same serializer.
 */
export function CreateTaskModal({
  initialStatus,
  onClose,
  returnFocusTo,
}: {
  /** Pre-selected status, from a board column's "+ Add task" (NEW-3). */
  readonly initialStatus?: string | undefined;
  readonly onClose: () => void;
  /**
   * The element to restore focus to (NEW-4, NEW-28). Captured by the
   * *opener* rather than read here, because by the time this mounts
   * the trigger may already have lost focus to the dialog.
   */
  readonly returnFocusTo?: HTMLElement | null | undefined;
}) {
  const workflow = useWorkflow();
  const projects = useProjects();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const users = useUsers();
  const calendar = useCalendar();
  const currentUser = useCurrentUser();
  const createLabel = useCreateLabel();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toasts = useToasts();

  const wf = workflow.data;
  const projectList = useMemo(() => projects.data?.items ?? [], [projects.data]);
  const choice = useMemo(
    () => resolveProjectChoice(projectList, projects.data?.effective_default),
    [projectList, projects.data],
  );

  // The form's starting point, recomputed only when the resolved
  // inputs actually arrive. `initial` is kept so NEW-27 can tell the
  // app's pre-fill apart from the user's typing.
  const initial = useMemo<CreateFormState>(
    () =>
      emptyForm({
        ...(choice.kind === "ask" ? {} : { project: choice.id }),
        ...(initialStatus !== undefined ? { status: initialStatus } : {}),
        // NEW-6: reporter defaults to the current user; assignee stays
        // empty on purpose, so the form does not silently assign work.
        ...(currentUser.data?.id !== undefined ? { reporter: currentUser.data.id } : {}),
      }),
    [choice, initialStatus, currentUser.data],
  );

  const [form, setForm] = useState<CreateFormState>(initial);
  const [seeded, setSeeded] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const [showTitleRequired, setShowTitleRequired] = useState(false);
  const [showProjectRequired, setShowProjectRequired] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [labelError, setLabelError] = useState<string | undefined>(undefined);

  // The body's serializer, and the key that remounts the editor when
  // "Create another" clears the form.
  const bodyBuffer = useRef(new RichBuffer(""));
  /** Synchronous in-flight guard — see the double-submit note below. */
  const inFlight = useRef(false);
  const [bodyEpoch, setBodyEpoch] = useState(0);

  const titleRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Seed once the resolved values land, and only while the user has
  // not started typing — a refetch must not overwrite a half-filled
  // form.
  useEffect(() => {
    if (seeded) return;
    if (projects.isSuccess && (currentUser.isSuccess || currentUser.isError)) {
      setForm(initial);
      setSeeded(true);
    }
  }, [seeded, projects.isSuccess, currentUser.isSuccess, currentUser.isError, initial]);

  // NEW-4: the title has focus immediately, so typing goes into the
  // field rather than the page behind.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // NEW-4 / NEW-28: focus returns to whatever opened the modal.
  useEffect(() => {
    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  const dateProblem = dateRangeProblem(form.start_date, form.due_date);
  const titleFilled = form.title.trim() !== "";
  const dirty = hasUserContent(form, initial);

  const requestClose = (): void => {
    // NEW-27: proportionate. An untouched modal closes at once; one
    // with typed content asks first, so a misclick on the backdrop
    // cannot destroy a written body.
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // A11Y-14's third bullet: the page behind is marked `inert`, so a
  // screen reader's virtual cursor cannot browse the list underneath.
  // `aria-modal` alone is not enough — support for it is uneven, and
  // the case asks for the content to be genuinely unreachable rather
  // than merely flagged.
  useInertBackground(panelRef);

  // NEW-28: focus is trapped. Tab cycles within the panel and never
  // reaches the page behind, which is inert (the backdrop covers it
  // and `aria-modal` hides the rest from assistive tech).
  //
  // NEW-31: this listens in the capture phase so `Esc` is handled here
  // rather than by a shortcut elsewhere, and so the discard
  // confirmation on top of this dialog gets first refusal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
      );
      const list = Array.from(focusables).filter(el => el.offsetParent !== null || el.isContentEditable);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active !== null && !panel.contains(active)) {
        // Focus escaped (a stray programmatic move). Bring it back
        // rather than letting Tab walk into the page behind.
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); };
  });

  const submit = async (): Promise<void> => {
    // NEW-23: a whitespace-only title is empty. The trimmed form is
    // what gets stored, per its third bullet.
    if (!titleFilled) {
      setShowTitleRequired(true);
      titleRef.current?.focus();
      return;
    }
    // NEW-19: never guess a project. The server would refuse anyway
    // (measured: 400 with field "project"), but refusing here keeps
    // the message at the field the user must act on.
    if (choice.kind === "ask" && form.project === undefined) {
      setShowProjectRequired(true);
      return;
    }
    if (dateProblem !== undefined) return;
    // NEW-29: the guard is a **ref**, not the `submitting` state and
    // not the `disabled` attribute.
    //
    // `disabled` is not enough on its own: it only appears after React
    // re-renders, and the second click of a double-click lands before
    // that. `submitting` state is not enough either, and this is the
    // subtle one — every click handler closes over the render's value
    // of `submitting`, so two clicks in the same tick both see `false`
    // and both proceed. Measured: with only the state check, two
    // dispatched clicks created two tasks.
    //
    // A ref is shared across closures and updates synchronously, so
    // the second call sees `true` on the same tick that the first set
    // it. That is the only version of this guard that survives the
    // race the case describes.
    if (inFlight.current) return;
    inFlight.current = true;

    setSubmitting(true);
    setFailure(null);
    try {
      const created = await apiClient.post<{ key: string; title: string }>(
        "/api/tasks",
        toCreateRequest(form),
      );
      setCreatedCount(n => n + 1);

      // NEW-13: the new row/card has to appear in the view behind
      // without a manual reload, and the total has to move with it.
      // These are the same keys `useTaskMutations` drops after a
      // write, so create and edit refresh the same surfaces.
      //
      // Note what is deliberately NOT done here: nothing is spliced
      // into the list optimistically. NEW-13's third bullet requires a
      // task that does not match the active filter to *not* appear,
      // and only a refetch through the filter can know that. The toast
      // is the confirmation in that case.
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["recents"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });

      // NEW-12: the toast names the key and title and offers "Open".
      // NEW-13: this is the confirmation for a task that does not match
      // the active filter, and the link is its escape hatch.
      toasts.show(`Created ${created.key} — ${created.title}`, {
        label: "Open",
        onAct: () => { void navigate({ to: "/tasks/$key", params: { key: created.key } }); },
      });

      if (createAnother) {
        // NEW-11: project and type survive; everything else is rebuilt
        // from empty so no stale value can be posted with task two.
        setForm(afterCreateAnother(form));
        bodyBuffer.current = new RichBuffer("");
        setBodyEpoch(n => n + 1);
        setShowTitleRequired(false);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      setFailure(describeFailure(err, createdCount));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const wfReady = wf !== undefined;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onMouseDown={e => {
        // NEW-27: a backdrop click is a dismissal, and goes through the
        // same proportionate prompt as Esc.
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="create-task-modal"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-border-default bg-bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          {/* NEW-1: the same heading in all three entry points. */}
          <h2 id={headingId} className="text-[15px] font-semibold text-text-primary">
            New task
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            data-testid="create-close"
            className="grid h-7 w-7 place-items-center rounded text-text-tertiary hover:bg-bg-muted hover:text-text-primary"
          >
            {"×"}
          </button>
        </div>

        {/* The form body scrolls; the header and footer stay put, so
            NEW-24's twenty-five label chips cannot push the submit
            button past the viewport. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {failure !== null && (
            <div
              role="alert"
              data-testid="create-error"
              className="rounded border border-danger-fg/40 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
            >
              {failure.message}
            </div>
          )}

          <ProjectField
            choice={choice}
            projects={projectList}
            value={form.project}
            required={showProjectRequired}
            onSelect={id => {
              setForm(f => ({
                ...f,
                project: id,
                // NEW-21: project-scoped selections are cleared with a
                // visible note rather than submitted and rejected.
                milestone: undefined,
                sprint: undefined,
              }));
              setShowProjectRequired(false);
            }}
          />

          <Field label="Title" htmlFor="create-title">
            <input
              id="create-title"
              ref={titleRef}
              data-testid="create-title"
              value={form.title}
              onChange={e => {
                setForm(f => ({ ...f, title: e.target.value }));
                if (e.target.value.trim() !== "") setShowTitleRequired(false);
              }}
              className="w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary"
            />
            {showTitleRequired && (
              <p role="alert" data-testid="create-title-required" className="mt-1 text-[11px] text-danger-fg">
                A title is required.
              </p>
            )}
          </Field>

          {wfReady && (
            <div className="grid grid-cols-2 gap-3">
              <EnumField
                label="Status"
                testid="status"
                defs={wf.statuses}
                value={form.status}
                onSelect={k => { setForm(f => ({ ...f, status: k })); }}
                onClear={() => { setForm(f => ({ ...f, status: undefined })); }}
              />
              <EnumField
                label="Priority"
                testid="priority"
                defs={wf.priorities}
                value={form.priority}
                onSelect={k => { setForm(f => ({ ...f, priority: k })); }}
                onClear={() => { setForm(f => ({ ...f, priority: undefined })); }}
              />
              <EnumField
                label="Type"
                testid="type"
                defs={wf.task_types}
                value={form.task_type}
                onSelect={k => { setForm(f => ({ ...f, task_type: k })); }}
                onClear={() => { setForm(f => ({ ...f, task_type: undefined })); }}
              />
              <RefField
                label="Sprint"
                testid="sprint"
                entries={sprints.data?.items ?? []}
                value={form.sprint}
                onSelect={k => { setForm(f => ({ ...f, sprint: k })); }}
                onClear={() => { setForm(f => ({ ...f, sprint: undefined })); }}
              />
              <RefField
                label="Milestone"
                testid="milestone"
                entries={milestones.data?.items ?? []}
                value={form.milestone}
                onSelect={k => { setForm(f => ({ ...f, milestone: k })); }}
                onClear={() => { setForm(f => ({ ...f, milestone: undefined })); }}
              />
              <UserField
                label="Assignee"
                testid="assignee"
                users={users.data?.items ?? []}
                value={form.assignee}
                onSelect={k => { setForm(f => ({ ...f, assignee: k })); }}
                onClear={() => { setForm(f => ({ ...f, assignee: undefined })); }}
              />
              <UserField
                label="Reporter"
                testid="reporter"
                users={users.data?.items ?? []}
                value={form.reporter}
                onSelect={k => { setForm(f => ({ ...f, reporter: k })); }}
                onClear={() => { setForm(f => ({ ...f, reporter: undefined })); }}
              />
            </div>
          )}

          <Field label="Labels">
            {/* NEW-7: the same field as task detail, so inline creation
                keeps TSK-55's create-then-attach ordering rather than
                a second implementation of it. */}
            <div data-testid="create-labels">
              <LabelsField
                attached={form.labels}
                all={labels.data?.items ?? []}
                onChange={ids => { setForm(f => ({ ...f, labels: [...ids] })); }}
                onCreate={async name => {
                  try {
                    const made = await createLabel.mutateAsync({ name });
                    setLabelError(undefined);
                    return made.id;
                  } catch (err) {
                    // NEW-36: no phantom selection. Returning undefined
                    // is what stops LabelsField attaching anything.
                    setLabelError(
                      `Couldn't create the label “${name}”: ${errText(err)}`,
                    );
                    return undefined;
                  }
                }}
                createError={labelError}
                onDismissCreateError={() => { setLabelError(undefined); }}
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <FormDateField
              label="Start date"
              testid="start"
              value={form.start_date}
              calendar={calendar.data}
              onChange={v => { setForm(f => ({ ...f, start_date: v })); }}
            />
            <FormDateField
              label="Due date"
              testid="due"
              value={form.due_date}
              calendar={calendar.data}
              onChange={v => { setForm(f => ({ ...f, due_date: v })); }}
            />
          </div>
          {dateProblem !== undefined && (
            <p role="alert" data-testid="create-date-problem" className="text-[11px] text-danger-fg">
              {dateProblem}
            </p>
          )}

          {wfReady && wf.custom_fields.length > 0 && (
            <fieldset className="space-y-2 rounded border border-border-subtle p-3">
              {/* NEW-10's fourth bullet: this header exists only when
                  there is something under it. */}
              <legend className="px-1 text-[12px] font-medium text-text-secondary">
                Custom fields
              </legend>
              {wf.custom_fields.map(def => (
                <CreateCustomField
                  key={def.key}
                  def={def}
                  value={form.fields[def.key]}
                  problem={fieldProblem(failure, def)}
                  onChange={v => {
                    setForm(f => {
                      const next = { ...f.fields };
                      if (v === undefined) delete next[def.key];
                      else next[def.key] = v;
                      return { ...f, fields: next };
                    });
                  }}
                />
              ))}
            </fieldset>
          )}

          <Field label="Description">
            {/* NEW-9: the compact editor. `Enter` inside it makes a
                paragraph and never submits the form — submission is
                explicit, via the button. */}
            <div className="rounded border border-border-default bg-bg-surface px-2 py-1.5">
              <RichEditor
                // Remounting on `bodyEpoch` is what clears the editor
                // for "Create another" (NEW-11): `RichEditor` reads
                // `markdown` once per mount by design, so without a
                // new key the previous task's body would stay on
                // screen and be posted again.
                key={bodyEpoch}
                markdown=""
                onDocChange={doc => {
                  // `RichBuffer` is the shared serializer, so the
                  // markdown stored from this compact editor is
                  // byte-identical to what task detail's full editor
                  // would produce for the same document (NEW-9).
                  bodyBuffer.current.applyRich(doc);
                  const next = bodyBuffer.current.text;
                  setForm(f => ({ ...f, body: next }));
                }}
                onBlur={() => { /* nothing is committed until submit */ }}
                mentionCandidates={[]}
                ariaLabel="Description"
              />
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              data-testid="create-another"
              checked={createAnother}
              onChange={e => { setCreateAnother(e.target.checked); }}
            />
            Create another
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              data-testid="create-cancel"
              className="rounded border border-border-default px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="create-submit"
              // NEW-2: enabled as soon as the title is non-empty.
              // NEW-29: disabled while in flight, and the flag above
              // catches the click that beats the re-render.
              disabled={!titleFilled || submitting || dateProblem !== undefined}
              onClick={() => { void submit(); }}
              className="rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create task"}
            </button>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <DiscardDialog
          onKeep={() => { setConfirmDiscard(false); }}
          onDiscard={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
    </div>
  );
}

/** What went wrong, in the terms NEW-32/37/38/39 ask for. */
interface CreateFailure {
  readonly message: string;
  /** The server-named field, when it named one (ERR-14, NEW-40). */
  readonly field?: string | undefined;
}

/**
 * Turns a thrown error into something that states what was attempted,
 * what state the data is in, and what to do.
 *
 * The three branches are the three honest answers, and they are
 * different on purpose:
 *
 *  - **No envelope at all** (NEW-37): the request never reached the
 *    API. The task was definitely not created, and saying so is the
 *    point — the case forbids a success toast and requires the
 *    connection to be named.
 *  - **A 2xx whose body will not parse** (NEW-38): the write may well
 *    have landed. P4's rare exception applies: the message cannot
 *    claim a cause, so it states the uncertainty and tells the user to
 *    reload and check *before* retrying, because a retry might
 *    duplicate.
 *  - **An envelope** (NEW-32/34/35/40): the server explained itself.
 *    Its message is used verbatim rather than reworded, because it
 *    names the milestone, the project or the field, and a generic
 *    rewrite would discard exactly that.
 */
function describeFailure(err: unknown, createdSoFar: number): CreateFailure {
  // NEW-39: when a "Create another" sequence fails part-way, the user
  // must not re-enter work that already exists.
  const prefix = createdSoFar > 0
    ? `${String(createdSoFar)} task${createdSoFar === 1 ? "" : "s"} already created. `
    : "";

  if (err instanceof ApiError) {
    if (err.envelope === undefined) {
      if (err.status === 0) {
        return {
          message: `${prefix}The task was not created — the server could not be reached. Your entries are kept; retry when it is back.`,
        };
      }
      return {
        message: `${prefix}The task may or may not have been created — the server's reply could not be read. Reload the list to check before retrying.`,
      };
    }
    return {
      message: `${prefix}Couldn't create the task: ${err.envelope.message}`,
      ...(err.envelope.field !== undefined ? { field: err.envelope.field } : {}),
    };
  }
  // A 2xx whose body will not parse (NEW-38).
  //
  // This is the one case where the honest answer is "I don't know".
  // The server accepted the request and replied; the reply is
  // unreadable, so whether the task was written is genuinely unknown.
  // P4's rare exception applies: the message cannot name a cause, but
  // it must still say what was attempted, what state the data is in,
  // and what to do — and "reload and check" comes before "retry",
  // because retrying a create that may have landed is how one task
  // becomes two.
  if (err instanceof UnparseableBodyError) {
    return {
      message: `${prefix}The task may or may not have been created — `
        + `the server replied, but the reply could not be read. Reload `
        + `the list to check before retrying.`,
    };
  }
  // A `fetch` that never reached the server rejects with a bare
  // `TypeError` ("Failed to fetch"), not an `ApiError` — the client
  // only wraps a response it actually received, plus its own timeout.
  // Measured while building this: killing the route made the modal say
  // "Couldn't create the task: Failed to fetch", which is a browser
  // implementation detail rather than an answer to "did my task get
  // created". NEW-37 requires the message to say the task was **not**
  // created and to name the connection as the reason, and here that
  // claim is safe: a request that never left cannot have been applied.
  if (err instanceof TypeError) {
    return {
      message: `${prefix}The task was not created — the server could not be reached. Your entries are kept; retry when it is back.`,
    };
  }
  return {
    message: `${prefix}Couldn't create the task: ${errText(err)}`,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The server's field message, when it belongs to this custom field. */
function fieldProblem(failure: CreateFailure | null, def: CustomFieldDef): string | undefined {
  if (failure?.field === undefined) return undefined;
  // Core names custom fields as `fields.<key>`.
  if (failure.field !== `fields.${def.key}`) return undefined;
  return failure.message;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The project control.
 *
 * NEW-18's second bullet is why the sole-project case still renders a
 * visible, labelled control rather than nothing: the user must be able
 * to see which project their task lands in, even when they cannot
 * change it.
 */
function ProjectField({
  choice,
  projects,
  value,
  required,
  onSelect,
}: {
  readonly choice: ReturnType<typeof resolveProjectChoice>;
  readonly projects: readonly ProjectDef[];
  readonly value: string | undefined;
  readonly required: boolean;
  readonly onSelect: (id: string) => void;
}) {
  // NEW-17: an archived project is never offered.
  const options = projects
    .filter(p => p.archived !== true)
    .map(p => ({ key: p.id, label: `${p.name} (${p.prefix})` }));

  if (choice.kind === "sole") {
    const only = projects.find(p => p.id === choice.id);
    return (
      <Field label="Project">
        <div
          data-testid="create-project-sole"
          className="rounded border border-border-subtle bg-bg-muted px-2 py-1.5 text-[13px] text-text-secondary"
        >
          {only ? `${only.name} (${only.prefix})` : choice.id}
        </div>
      </Field>
    );
  }

  return (
    <Field label="Project">
      <div data-testid="create-project">
        <OptionPicker
          label="Project"
          value={value}
          options={options}
          onSelect={onSelect}
        />
      </div>
      {required && (
        <p role="alert" data-testid="create-project-required" className="mt-1 text-[11px] text-danger-fg">
          {NO_PROJECT_MESSAGE}
        </p>
      )}
    </Field>
  );
}

/**
 * A workflow enum (status, priority, type).
 *
 * NEW-5: the options are whatever `workflow.yaml` declares, in its
 * order, showing `label` and storing `key`. Nothing here knows how
 * many there should be, which is what makes a seven-priority workspace
 * show seven and a one-type workspace show one.
 */
function EnumField({
  label,
  testid,
  defs,
  value,
  onSelect,
  onClear,
}: {
  readonly label: string;
  readonly testid: string;
  readonly defs: readonly { key: string; label: string; color?: string | undefined }[];
  readonly value: string | undefined;
  readonly onSelect: (key: string) => void;
  readonly onClear: () => void;
}) {
  return (
    <Field label={label}>
      <div data-testid={`create-${testid}`}>
        <OptionPicker
          label={label}
          value={value}
          options={defs.map(d => ({
            key: d.key,
            label: d.label,
            ...(d.color !== undefined ? { color: d.color } : {}),
          }))}
          onSelect={onSelect}
          onClear={onClear}
          clearLabel="None"
        />
      </div>
    </Field>
  );
}

/**
 * A sprint or milestone picker.
 *
 * NEW-6: archived entries are filtered out — an archived thing can
 * still be *shown* on a task that already references it, but offering
 * it as a new choice is precisely what archiving prevents.
 */
function RefField({
  label,
  testid,
  entries,
  value,
  onSelect,
  onClear,
}: {
  readonly label: string;
  readonly testid: string;
  readonly entries: readonly { id: string; name: string; archived?: boolean | undefined }[];
  readonly value: string | undefined;
  readonly onSelect: (key: string) => void;
  readonly onClear: () => void;
}) {
  return (
    <Field label={label}>
      <div data-testid={`create-${testid}`}>
        <OptionPicker
          label={label}
          value={value}
          options={entries
            .filter(e => e.archived !== true)
            .map(e => ({ key: e.id, label: e.name }))}
          onSelect={onSelect}
          onClear={onClear}
          clearLabel="None"
        />
      </div>
    </Field>
  );
}

/**
 * Assignee / reporter.
 *
 * NEW-6's second bullet: two users may share a display name, so a
 * truncated id disambiguates rather than presenting two identical
 * rows the user cannot choose between.
 */
function UserField({
  label,
  testid,
  users,
  value,
  onSelect,
  onClear,
}: {
  readonly label: string;
  readonly testid: string;
  readonly users: readonly { id: string; name: string; archived?: boolean | undefined }[];
  readonly value: string | undefined;
  readonly onSelect: (key: string) => void;
  readonly onClear: () => void;
}) {
  const live = users.filter(u => u.archived !== true);
  const nameCounts = new Map<string, number>();
  for (const u of live) nameCounts.set(u.name, (nameCounts.get(u.name) ?? 0) + 1);

  return (
    <Field label={label}>
      <div data-testid={`create-${testid}`}>
        <OptionPicker
          label={label}
          value={value}
          options={live.map(u => ({
            key: u.id,
            label: (nameCounts.get(u.name) ?? 0) > 1
              ? `${u.name} (${u.id.slice(-6)})`
              : u.name,
          }))}
          onSelect={onSelect}
          onClear={onClear}
          clearLabel="None"
        />
      </div>
    </Field>
  );
}

/**
 * A date input for the form.
 *
 * Distinct from task detail's `DateField`, which is a click-to-edit
 * trigger that commits on blur — the right shape for editing a saved
 * task in place, and the wrong one inside a form where nothing is
 * committed until submit. The calendar *reading* is shared:
 * `nonWorkingNote` is imported rather than reimplemented, so NEW-8's
 * marking and TSK-8's agree by construction.
 *
 * The value is stored as the `YYYY-MM-DD` the control yields, with no
 * parse and no `Date` in between — NEW-8's third bullet.
 */
function FormDateField({
  label,
  testid,
  value,
  calendar,
  onChange,
}: {
  readonly label: string;
  readonly testid: string;
  readonly value: string | undefined;
  readonly calendar: CalendarConfig | undefined;
  readonly onChange: (value: string | undefined) => void;
}) {
  const note = value === undefined ? undefined : nonWorkingNote(value, calendar);
  return (
    <Field label={label} htmlFor={`create-${testid}`}>
      <input
        id={`create-${testid}`}
        type="date"
        data-testid={`create-${testid}`}
        min="1900-01-01"
        max="2099-12-31"
        value={value ?? ""}
        onChange={e => { onChange(e.target.value === "" ? undefined : e.target.value); }}
        className="w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary"
      />
      {note !== undefined && (
        <span data-testid={`create-nonworking-${testid}`} className="mt-0.5 block text-[11px] text-text-tertiary">
          {note}
        </span>
      )}
    </Field>
  );
}

/**
 * One declared custom field, with a control matching its type.
 *
 * NEW-10: a `string` gets a text box, a `number` a numeric input, a
 * `date` a date picker, a `boolean` a checkbox, and a `multi` `enum` a
 * multi-select over the declared values, showing labels and storing
 * keys.
 *
 * The number control is a text input with `inputMode="decimal"`, not
 * `<input type="number">`. That is deliberate and it is what makes
 * NEW-40 reachable: a native number input silently discards a
 * non-numeric paste, so the value the case requires the user to enter
 * never exists and the field-level rejection it asks for can never be
 * shown. The same reasoning is already written down in
 * `TextField.tsx`, for the same reason.
 */
function CreateCustomField({
  def,
  value,
  problem,
  onChange,
}: {
  readonly def: CustomFieldDef;
  readonly value: unknown;
  readonly problem: string | undefined;
  readonly onChange: (value: unknown) => void;
}) {
  const testid = `create-field-${def.key}`;
  const [local, setLocal] = useState<string | undefined>(undefined);

  if (def.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[12px] text-text-secondary">
        <input
          type="checkbox"
          data-testid={testid}
          checked={value === true}
          onChange={e => { onChange(e.target.checked ? true : undefined); }}
        />
        {def.label}
      </label>
    );
  }

  if (def.type === "enum") {
    const values = def.values ?? [];
    if (def.multi) {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={def.label}>
          <div data-testid={testid} className="flex flex-wrap gap-1.5">
            {values.map(v => {
              const on = selected.includes(v.key);
              return (
                <button
                  key={v.key}
                  type="button"
                  data-testid={`${testid}-${v.key}`}
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? selected.filter(k => k !== v.key) : [...selected, v.key];
                    onChange(next.length > 0 ? next : undefined);
                  }}
                  className={[
                    "rounded-full border px-2 py-0.5 text-[12px]",
                    on
                      ? "border-accent bg-accent text-accent-contrast"
                      : "border-border-default text-text-secondary hover:bg-bg-muted",
                  ].join(" ")}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
          <FieldProblem problem={problem} testid={testid} />
        </Field>
      );
    }
    return (
      <Field label={def.label}>
        <div data-testid={testid}>
          <OptionPicker
            label={def.label}
            value={typeof value === "string" ? value : undefined}
            options={values.map(v => ({ key: v.key, label: v.label }))}
            onSelect={k => { onChange(k); }}
            onClear={() => { onChange(undefined); }}
            clearLabel="None"
          />
        </div>
        <FieldProblem problem={problem} testid={testid} />
      </Field>
    );
  }

  if (def.type === "date") {
    return (
      <Field label={def.label} htmlFor={testid}>
        <input
          id={testid}
          type="date"
          data-testid={testid}
          value={typeof value === "string" ? value : ""}
          onChange={e => { onChange(e.target.value === "" ? undefined : e.target.value); }}
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary"
        />
        <FieldProblem problem={problem} testid={testid} />
      </Field>
    );
  }

  const numeric = def.type === "number";
  // Only scalars reach this control (string / number / date), so a
  // non-scalar means the form state and the declared type disagree —
  // show nothing rather than "[object Object]".
  const shown = local ?? (
    typeof value === "string" || typeof value === "number" ? String(value) : ""
  );
  return (
    <Field label={def.label} htmlFor={testid}>
      <input
        id={testid}
        type="text"
        data-testid={testid}
        {...(numeric ? { inputMode: "decimal" as const } : {})}
        value={shown}
        onChange={e => {
          const raw = e.target.value;
          setLocal(raw);
          if (raw === "") { onChange(undefined); return; }
          if (!numeric) { onChange(raw); return; }
          const n = Number(raw);
          // A non-numeric entry is kept verbatim and sent as typed, so
          // the server's own type validation is what rejects it and
          // names the field (NEW-40). Coercing to NaN here would post
          // `null` and produce a different, less honest error.
          onChange(Number.isFinite(n) && raw.trim() !== "" ? n : raw);
        }}
        className="w-full rounded border border-border-default bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary"
      />
      <FieldProblem problem={problem} testid={testid} />
    </Field>
  );
}

function FieldProblem({
  problem,
  testid,
}: {
  readonly problem: string | undefined;
  readonly testid: string;
}) {
  if (problem === undefined) return null;
  return (
    <p role="alert" data-testid={`${testid}-problem`} className="mt-1 text-[11px] text-danger-fg">
      {problem}
    </p>
  );
}

/**
 * NEW-27's confirmation.
 *
 * "Keep editing" is the default and the first control, because the
 * destructive answer should never be the one a stray Enter selects.
 */
function DiscardDialog({
  onKeep,
  onDiscard,
}: {
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/30 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Discard this task?"
        data-testid="create-discard-confirm"
        className="w-full max-w-sm rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <h3 className="mb-2 text-[14px] font-semibold text-text-primary">Discard this task?</h3>
        <p className="mb-3 text-[12px] text-text-secondary">
          What you have typed will be lost.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            data-testid="create-discard-keep"
            onClick={onKeep}
            className="rounded border border-border-default px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted"
          >
            Keep editing
          </button>
          <button
            type="button"
            data-testid="create-discard-confirm-btn"
            onClick={onDiscard}
            className="rounded bg-danger-fg px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
