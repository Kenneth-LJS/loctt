import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import { useSetField } from "../api/hooks/useSetField.ts";
import { useTask } from "../api/hooks/useTask.ts";
import {
  useArchiveTask,
  useDeleteTask,
  useMoveTask,
} from "../api/hooks/useTaskMutations.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { buildLookups } from "../list/lookups.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { DeleteTaskDialog } from "./DeleteTaskDialog.tsx";
import type { FieldFailure } from "./fieldFailure.ts";
import { buildLabelIndex, toFieldFailure } from "./fieldFailure.ts";
import { MetaPanel } from "./MetaPanel.tsx";
import { MoveTaskDialog } from "./MoveTaskDialog.tsx";
import { TaskNotFound } from "./TaskNotFound.tsx";

/**
 * The task detail read shell (M2.1).
 *
 * Everything on this page renders from one `GET /api/tasks/:ref`, so
 * pasting the URL cold produces the identical view — no state carried
 * from the list is required (TSK-1, P-2).
 *
 * Three failure shapes, kept visibly apart, because conflating any two
 * of them tells the user something false:
 *
 *  - **404** → `TaskNotFound`. The key resolves to nothing. Rendered
 *    inside the shell, not through the route boundary (ERR-8).
 *  - **Unreachable server** → `ErrorState`, which names `loctt ui`
 *    rather than saying the task is missing (TSK-53). `ErrorState`
 *    already distinguishes these: a transport failure never becomes an
 *    `ApiError`, so it has no envelope.
 *  - **Anything else** (a 500, a corrupt file the server could not
 *    parse) → `ErrorState` with the server's own envelope, which
 *    carries the path and the parse detail (TSK-54).
 *
 * A read is safe to repeat, so all three offer a control rather than
 * a dead end.
 */
export function TaskDetail({ taskRef }: { readonly taskRef: string }) {
  const task = useTask(taskRef);
  const navigate = useNavigate();

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const calendar = useCalendar();
  const workflow = useWorkflow();

  const [confirming, setConfirming] = useState<"delete" | "move" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /**
   * The archive/move failure is held here rather than read off the
   * mutation, so dismissing it is possible and so a *stale* failure
   * from a previous attempt cannot outlive the attempt that produced
   * it (TSK-52's "offers retry" needs the message to clear on the
   * retry that works).
   */
  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * A field write that the server rejected, held per field so it
   * renders *at the control that failed* rather than as a detached
   * toast (P4, TSK-49). The envelope carries `field`; when core did
   * not name one, the server fills it in from the request, so this is
   * always keyed by something.
   */
  const [fieldError, setFieldError] = useState<FieldFailure | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  const setField = useSetField(taskRef);
  const createLabel = useCreateLabel();

  const archive = useArchiveTask(taskRef);
  const del = useDeleteTask(taskRef);
  const move = useMoveTask(taskRef);

  // The confirmation toast is transient; a permanent "Copied" would
  // stop meaning anything after the first copy (TSK-19).
  useEffect(() => {
    if (copied === null) return undefined;
    const t = setTimeout(() => { setCopied(null); }, 2500);
    return () => { clearTimeout(t); };
  }, [copied]);

  if (task.isPending) {
    // Named, and distinguishable from both the 404 and the error
    // states — TSK-45 requires a not-found not be presented the same
    // way as a load in progress.
    return (
      <div className="grid h-full place-items-center p-8">
        <p aria-busy="true" className="text-[13px] text-text-tertiary">
          Loading {taskRef}…
        </p>
      </div>
    );
  }

  if (task.isError) {
    if (task.error instanceof ApiError && task.error.code === "not_found") {
      /**
       * XS-57. A *write* that discovered the task is gone invalidates
       * this query, whose refetch then 404s — and swapping straight to
       * `TaskNotFound` here threw away the only thing the case is
       * about. The generic page says the key resolves to nothing,
       * which is true and answers none of the four bullets: it does
       * not say the edit failed, does not say the task was deleted
       * while the page was open, and cannot show the field's value
       * snapping back because the field is gone with it.
       *
       * So while a `not_found` field failure stands, the detail page
       * stays up on its last-known data with the notice at the
       * control. `task.data` survives the failed refetch — React Query
       * keeps the previous success — and the notice carries the route
       * back to the list, which is what `TaskNotFound` was providing.
       *
       * A cold navigation to a key that never existed is unaffected:
       * `fieldError` is null there, and it takes the branch below.
       */
      if (!(fieldError?.code === "not_found" && task.data !== undefined)) {
        return <TaskNotFound taskKey={taskRef} />;
      }
    } else {
      return (
        <ErrorState
          error={task.error}
          context={`Loading ${taskRef}`}
          onRetry={() => { void task.refetch(); }}
        />
      );
    }
  }

  const fm = task.data.frontmatter;
  const lookups = buildLookups({
    projects: projects.data?.items ?? [],
    users: users.data?.items ?? [],
    labels: labels.data?.items ?? [],
    workflow: workflow.data,
  });
  const project = lookups.project(fm.project);
  const archived = fm.archived === true;

  /**
   * TSK-2. The server resolves retired keys, and returns the *current*
   * key with the retired one in `key_history`. So the chip can show
   * what is live while the page still says which key was navigated by
   * — the user can tell which is which without a second request.
   */
  const navigatedByRetired =
    taskRef !== fm.key && (fm.key_history ?? []).includes(taskRef);

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      // A clipboard the browser refused is not a silent no-op: the
      // user would otherwise paste whatever was there before.
      setCopied(null);
      setWriteError(
        "The browser would not give LocTT access to the clipboard.",
      );
    }
  };

  /**
   * One field, one request. XS-54 rests on this: two tabs editing
   * different fields both land, because neither sends a field it did
   * not change.
   */
  /**
   * The names the user configured, for the ids and keys a rejection
   * quotes (ERR-43).
   *
   * Built from the queries the panel already renders from, so a
   * message naming `01M15Z…` or `in_progress` comes back naming
   * "Ada Byron" or "In progress" — the same words the picker beside
   * it shows. The server cannot do this: core's messages are shared
   * with the CLI and MCP and its validator holds keys by design.
   */
  const labelIndex = buildLabelIndex({
    statuses: workflow.data?.statuses,
    priorities: workflow.data?.priorities,
    taskTypes: workflow.data?.task_types,
    customFields: workflow.data?.custom_fields,
    users: users.data?.items,
    labels: labels.data?.items,
    milestones: milestones.data?.items,
    sprints: sprints.data?.items,
    projects: projects.data?.items,
  });

  /**
   * One field, one request. XS-54 and TSK-34 both rest on this: two
   * writers editing different fields both land, because neither sends
   * a field it did not change.
   *
   * `fm.key` rather than `taskRef` for the failure: a user who arrived
   * through a retired key or a ULID must still be told about `T-12`
   * (XS-57's first bullet, and P4 generally).
   */
  const writeField = (vars: { field: string; value?: unknown }): void => {
    setFieldError(null);
    setField.mutate(vars, {
      onError: (err: Error) => {
        setFieldError(toFieldFailure(err, vars, labelIndex, fm.key));
      },
    });
  };

  const onSet = (field: string, value: unknown): void => {
    writeField({ field, value });
  };

  const onUnset = (field: string): void => {
    writeField({ field });
  };

  /**
   * Creates the label, then hands its id back so the caller can
   * attach it. Resolving `undefined` on failure is what keeps the
   * pill from being drawn for a label that does not exist (TSK-55).
   */
  const onCreateLabel = async (name: string): Promise<string | undefined> => {
    setLabelError(null);
    try {
      const created = await createLabel.mutateAsync({ name });
      return created.id;
    } catch (err) {
      setLabelError(
        `The label “${name}” was not created: ${(err as Error).message}`,
      );
      return undefined;
    }
  };

  const onArchiveToggle = (): void => {
    setWriteError(null);
    archive.mutate(
      { archive: !archived },
      {
        // TSK-52: on failure nothing is invalidated as archived, so no
        // badge appears and the menu still reads Archive. The message
        // names the failure and the control is still there to retry.
        onError: (err: Error) => { setWriteError(err.message); },
      },
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border-subtle px-6 py-4">
        {/* All tasks › project label. The label is the project's `name`
            — not its slug `key` or its `prefix`, which name the same
            thing to the machine and nothing to the reader (TSK-1). */}
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-[12px]">
          <Link
            to="/list"
            className="text-text-tertiary no-underline hover:text-text-primary"
          >
            All tasks
          </Link>
          {project !== undefined && (
            <>
              <span aria-hidden="true" className="text-text-tertiary">›</span>
              {/* Filters the list to this project — a breadcrumb that
                  does not narrow anything is a label wearing a link's
                  clothes. */}
              <Link
                to="/list"
                search={{ project: [project.id] }}
                className="text-text-tertiary no-underline hover:text-text-primary"
              >
                {project.name}
              </Link>
            </>
          )}
        </nav>

        <div className="flex items-start justify-between gap-4">
          {/* min-w-0 is what stops a 400-character unbroken title from
              forcing the flex row wider than the viewport (TSK-24). A
              flex child's default min-width is auto, i.e. its content,
              so without this the header — and the page — scroll
              sideways. `break-words` then wraps inside the box. */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {/* The chip carries the *current* key, always. Showing
                  the navigated-by key here would imply a retired key
                  is live (TSK-2). */}
              <span
                data-testid="task-key-chip"
                className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-[12px] font-medium text-text-secondary"
              >
                {fm.key}
              </span>
              {archived && (
                <span
                  data-testid="archived-badge"
                  className="rounded bg-warning-fg/15 px-1.5 py-0.5 text-[11px] font-medium text-warning-fg"
                >
                  Archived
                </span>
              )}
            </div>
            {/* `title` makes the full string recoverable on hover even
                when it wraps to a clamped height (TSK-24). */}
            <h1
              title={fm.title}
              className="break-words text-[20px] font-semibold leading-tight text-text-primary"
            >
              {fm.title}
            </h1>
            {navigatedByRetired && (
              <p className="mt-1.5 text-[12px] text-text-tertiary">
                You followed{" "}
                <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[11px]">
                  {taskRef}
                </code>
                , which is a retired key for this task. Its current key
                is <strong className="font-medium text-text-primary">{fm.key}</strong>.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {copied !== null && (
              <span role="status" className="text-[12px] text-text-tertiary">
                {copied} copied
              </span>
            )}
            <Menu
              aria-label={`Actions for ${fm.key}`}
              align="end"
              trigger={t => (
                <button
                  type="button"
                  onClick={t.toggle}
                  aria-haspopup={t["aria-haspopup"]}
                  aria-expanded={t["aria-expanded"]}
                  id={t.id}
                  className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted"
                >
                  More
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      // The bare key — no URL, no prefix noise, no
                      // surrounding whitespace (TSK-19).
                      void copy(fm.key, "Key");
                      close();
                    }}
                  >
                    Copy key
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      // Absolute, and built from the *current* key so
                      // the pasted link does not re-enter through a
                      // retired one.
                      void copy(
                        `${window.location.origin}/tasks/${encodeURIComponent(fm.key)}`,
                        "Link",
                      );
                      close();
                    }}
                  >
                    Copy link
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setWriteError(null);
                      setConfirming("move");
                      close();
                    }}
                  >
                    Move to project…
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      onArchiveToggle();
                      close();
                    }}
                  >
                    {/* No dialog either way: archive is reversible, and
                        friction proportionate to consequence is the
                        whole distinction from delete (TSK-23). */}
                    {archived ? "Unarchive" : "Archive"}
                  </MenuItem>
                  <MenuItem
                    className="text-danger-fg hover:text-danger-fg"
                    onSelect={() => {
                      setWriteError(null);
                      setConfirming("delete");
                      close();
                    }}
                  >
                    Delete…
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        {writeError !== null && (
          <p role="alert" className="mt-3 text-[13px] text-danger-fg">
            {writeError}{" "}
            <button
              type="button"
              onClick={() => { setWriteError(null); }}
              className="underline"
            >
              Dismiss
            </button>
          </p>
        )}
      </header>

      {/* Two columns: the task's content on the left, meta on the
          right. `min-w-0` on the left column for the same reason as
          the header — without it a long unbroken word in the body or
          the title pushes the grid wider than the pane (TSK-24). */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-6">
            <Section title="Description">
              {task.data.body.trim() === "" ? (
                <p className="text-[13px] text-text-tertiary">
                  No description.
                </p>
              ) : (
                // Read-only this ticket: the body editor is M2.3. A
                // pre keeps the markdown legible without pretending to
                // be a renderer that does not exist yet, and
                // `whitespace-pre-wrap` + `break-words` keep a long
                // unbroken line inside the column (TSK-24).
                <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-text-primary">
                  {task.data.body}
                </pre>
              )}
            </Section>

            {/* Placeholders, deliberately. The panels themselves are
                M2.4 (relationships), M2.5 (attachments) and M2.6
                (activity/comments); this ticket owes the two-column
                shell they land in, and an absent heading would make
                the layout untestable until then. Each names what it
                will hold rather than rendering an empty box. */}
            <Section title="Related">
              <PanelStub
                count={task.data.relationships.length}
                noun="linked task"
                pending="Relationships arrive with the relationships panel."
              />
            </Section>

            <Section title="Attachments">
              <PanelStub
                count={task.data.attachments.length}
                noun="attachment"
                pending="Attachments arrive with the attachments panel."
              />
            </Section>

            <Section title="Activity">
              <p className="text-[13px] text-text-tertiary">
                The activity feed arrives with the activity panel.
              </p>
            </Section>

            <Section title="Comments">
              <p className="text-[13px] text-text-tertiary">
                Comments arrive with the comments panel.
              </p>
            </Section>
          </div>

          <MetaPanel
            frontmatter={fm}
            lookups={lookups}
            workflow={workflow.data}
            users={users.data?.items ?? []}
            labels={labels.data?.items ?? []}
            milestones={milestones.data?.items ?? []}
            sprints={sprints.data?.items ?? []}
            calendar={calendar.data}
            onSet={onSet}
            onUnset={onUnset}
            onCreateLabel={onCreateLabel}
            {...(labelError !== null ? { labelError } : {})}
            onDismissLabelError={() => { setLabelError(null); }}
            {...(fieldError !== null ? { fieldError } : {})}
            {...(fieldError?.retry !== undefined
              ? {
                  // Re-attempts *the same field-level write* — ERR-3's
                  // fourth bullet is specific about that. Rebuilding
                  // it from the current panel state would re-send
                  // whatever the field holds now, which after the
                  // rollback is the old value.
                  onRetryField: retryWith(fieldError.retry, writeField),
                }
              : {})}
            onDismissFieldError={() => { setFieldError(null); }}
          />
        </div>
      </div>

      {confirming === "delete" && (
        <DeleteTaskDialog
          taskKey={fm.key}
          title={fm.title}
          pending={del.isPending}
          error={writeError ?? undefined}
          onCancel={() => {
            // TSK-44: the dialog unmounts, so its typed string goes
            // with it — reopening starts empty rather than pre-filled.
            setConfirming(null);
            setWriteError(null);
          }}
          onConfirm={() => {
            setWriteError(null);
            del.mutate(undefined, {
              onSuccess: () => {
                setConfirming(null);
                void navigate({ to: "/list" });
              },
              // TSK-50: no navigation on failure. Navigating away
              // would read as a successful delete for a task that is
              // still on disk.
              onError: (err: Error) => { setWriteError(err.message); },
            });
          }}
        />
      )}

      {confirming === "move" && (
        <MoveTaskDialog
          taskKey={fm.key}
          projects={projects.data?.items ?? []}
          currentProject={fm.project}
          pending={move.isPending}
          error={writeError ?? undefined}
          onCancel={() => {
            setConfirming(null);
            setWriteError(null);
          }}
          onConfirm={projectId => {
            setWriteError(null);
            move.mutate(
              { project: projectId },
              {
                onSuccess: result => {
                  setConfirming(null);
                  // A move rekeys the task, so the URL we are on now
                  // names a retired key. Following the new one keeps
                  // the address bar honest about what is live.
                  if (result.newKey !== undefined && result.newKey !== fm.key) {
                    void navigate({
                      to: "/tasks/$key",
                      params: { key: result.newKey },
                      replace: true,
                    });
                  }
                },
                onError: (err: Error) => { setWriteError(err.message); },
              },
            );
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A panel whose data this ticket fetches but whose rendering belongs
 * to a later one. It states the count it *has* rather than rendering
 * nothing: "3 linked tasks" is true and useful now, and it means the
 * later panel replaces a number rather than filling a void.
 */
function PanelStub({
  count,
  noun,
  pending,
}: {
  readonly count: number;
  readonly noun: string;
  readonly pending: string;
}) {
  return (
    <p className="text-[13px] text-text-tertiary">
      {count === 0
        ? `No ${noun}s.`
        : `${String(count)} ${noun}${count === 1 ? "" : "s"}. ${pending}`}
    </p>
  );
}

/**
 * Binds a stored write's vars to a retry callback.
 *
 * A function rather than a spread at the call site so the narrowing
 * survives: `FieldFailure.retry` is optional, and spreading it inside
 * the JSX widens `field` back to `string | undefined` even under a
 * guard on the same expression.
 */
function retryWith(
  vars: { readonly field: string; readonly value?: unknown },
  send: (v: { field: string; value?: unknown }) => void,
): () => void {
  return () => {
    send("value" in vars ? { field: vars.field, value: vars.value } : { field: vars.field });
  };
}
