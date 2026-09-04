import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ActivityPanel } from "../activity/ActivityPanel.tsx";
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
import { useTaskGraph } from "../api/hooks/useTaskGraph.ts";
import {
  useArchiveTask,
  useDeleteTask,
  useDuplicateTask,
  useMoveTask,
} from "../api/hooks/useTaskMutations.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel.tsx";
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { BodyEditor } from "../editor/BodyEditor.tsx";
import { buildLookups } from "../list/lookups.ts";
import { RelationshipsPanel } from "../relationships/RelationshipsPanel.tsx";
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const calendar = useCalendar();
  const workflow = useWorkflow();
  // The whole graph, for the relationships panel's tree render. Called
  // unconditionally with the other queries: hooks cannot sit below the
  // pending / error returns.
  const taskGraph = useTaskGraph();

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
  const duplicate = useDuplicateTask(taskRef);

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

  /**
   * TSK-20. The copy's key is allocated by the server, so the only
   * honest source for where to navigate is the response — computing
   * it client-side would be a guess about a counter another writer
   * may have moved.
   *
   * No dialog: duplicating creates a new task and destroys nothing, so
   * it takes the same friction as Archive rather than Delete's typed
   * confirmation (TSK-23's proportionality).
   *
   * On failure the navigation does not happen. Staying put is the
   * whole point — landing on a task that was never created, or worse
   * back on the list as though something had been made, would read as
   * a success.
   */
  const onDuplicate = (): void => {
    setWriteError(null);
    duplicate.mutate(undefined, {
      onSuccess: created => {
        void navigate({ to: "/tasks/$key", params: { key: created.key } });
      },
      onError: (err: Error) => { setWriteError(err.message); },
    });
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
                  className="rounded bg-warn-fg/15 px-1.5 py-0.5 text-[11px] font-medium text-warn-fg"
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
                      onDuplicate();
                      close();
                    }}
                  >
                    Duplicate
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
              {/* M2.3. Keyed by the task so navigating A → B builds a
                  fresh editor rather than re-seeding one that still
                  holds A's buffer — TSK-40's "task B's editor shows
                  task B's body, never A's buffered content". A prop
                  change alone would not be enough: the buffer and the
                  autosave timers live in refs, which survive a
                  re-render by design. */}
              <BodyEditor
                key={task.data.frontmatter.id}
                taskRef={taskRef}
                body={task.data.body}
                bodyToken={task.data.bodyToken}
                lossyConstructs={task.data.lossyConstructs}
                /* A body write bumps `updated_at`, so the *list* rows
                   and the meta panel's timestamp are both stale after
                   one. Invalidating here is also what keeps the
                   editor's own token fresh: without it the next read
                   is up to 60s away (the shared poll), and until then
                   the editor holds a token the file has moved past. */
                onSaved={() => {
                  void queryClient.invalidateQueries({ queryKey: ["task", taskRef] });
                  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
                  void queryClient.invalidateQueries({ queryKey: ["tasks-feed"] });
                }}
                mentionCandidates={(users.data?.items ?? []).map(u => ({
                  id: u.id,
                  name: u.name ?? u.id,
                }))}
              />
            </Section>

            <Section title="Related">
              {/* M2.5a. Keyed by the task for the same reason the other
                  panels are: the picker's typed query, the collapsed
                  groups and the collapsed tree nodes are component
                  state, and carrying A's collapsed set onto B is the
                  leak REL-5's last clause forbids. */}
              <RelationshipsPanel
                key={task.data.frontmatter.id}
                taskRef={taskRef}
                taskId={fm.id}
                taskKey={fm.key}
                taskTitle={fm.title}
                taskKeyHistory={fm.key_history ?? []}
                relationships={task.data.relationships}
                stored={fm.relationships}
                workflow={workflow.data}
                statusOf={lookups.status}
                taskIndex={taskGraph}
              />
            </Section>

            <Section title="Attachments">
              {/* M2.5b. Keyed by the task for the same reason the other
                  panels are: the upload queue is component state, and
                  carrying A's queue onto B would show B outcomes for
                  files that were never dropped on it. */}
              <AttachmentsPanel
                key={task.data.frontmatter.id}
                taskRef={taskRef}
                attachments={task.data.attachments}
                attachmentsError={task.data.attachmentsError}
                onRetry={() => { void task.refetch(); }}
              />
            </Section>

            <Section title="Activity">
              {/* M2.4b. Keyed by the task for the same reason the
                  other two panels are: the expanded/collapsed state of
                  a bulk row and the loaded page count are component
                  state, and carrying A's loaded pages onto B would
                  show B a feed it never fetched. */}
              <ActivityPanel
                key={task.data.frontmatter.id}
                taskRef={taskRef}
                workflow={workflow.data}
                users={users.data?.items ?? []}
                labels={labels.data?.items ?? []}
                milestones={milestones.data?.items ?? []}
                sprints={sprints.data?.items ?? []}
                projects={projects.data?.items ?? []}
                calendar={calendar.data}
              />
            </Section>

            <Section title="Comments">
              {/* M2.4a. Keyed by the task for the same reason
                  `BodyEditor` is: the composer's buffer and the
                  in-progress edit live in refs, which survive a
                  re-render, so navigating A → B without a remount
                  would carry A's half-typed comment onto B. */}
              <CommentsPanel
                key={task.data.frontmatter.id}
                taskRef={taskRef}
                users={users.data?.items ?? []}
              />
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
