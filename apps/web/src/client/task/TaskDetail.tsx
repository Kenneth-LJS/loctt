import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ActivityPanel } from "../activity/ActivityPanel.tsx";
import { ApiError } from "../api/client.ts";
import {
  searchLabels,
  searchMilestones,
  searchSprints,
  searchUsers,
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { activityQueryKey } from "../api/hooks/useActivity.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
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
import { BodyEditor } from "../editor/BodyEditor.tsx";
import { buildLookups } from "../list/lookups.ts";
import { RelationshipsPanel } from "../relationships/RelationshipsPanel.tsx";
import { takeTaskOrigin } from "../router/taskOrigin.ts";
import { useAnnouncer } from "../ui/Announcer.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { DeleteTaskDialog } from "./DeleteTaskDialog.tsx";
import { EditableTitle } from "./EditableTitle.tsx";
import type { FieldFailure } from "./fieldFailure.ts";
import { buildLabelIndex, toFieldFailure } from "./fieldFailure.ts";
import { fieldLabel } from "./fieldLabel.ts";
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
export function TaskDetail({
  taskRef,
  activityTab,
  rekeyedFrom,
  rekeyedWhileOpen,
}: {
  readonly taskRef: string;
  /** The activity tab from `?tab=` (CMT-18); undefined → the default. */
  readonly activityTab?: "comments" | "activity" | "all";
  /**
   * GIT-19. The retired key this tab was following before it was rekeyed
   * elsewhere, from `?rekeyedFrom=`. Set by the follow-the-rekey redirect
   * below so the note can still explain the change after the URL has moved
   * to the current key.
   */
  readonly rekeyedFrom?: string;
  /**
   * GIT-19. `true` only when the follow above came from a tab that was
   * *open* on this task when it was renumbered elsewhere (from
   * `?rekeyedWhileOpen=`). It selects the "renumbered while you had it open"
   * note; a cold navigation to a retired key leaves it unset and shows the
   * plain retired-key note (TSK-2).
   */
  readonly rekeyedWhileOpen?: boolean;
}) {
  const task = useTask(taskRef);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  // UI-12. The route this task was opened FROM, so the back affordance
  // below can return there exactly (filters, sort, page and all)
  // instead of a hardcoded "/list". `useState(() => …)` runs the
  // initializer exactly once, on this component's first render — and
  // the route keys `TaskDetail` on `taskRef` (router/index.tsx), so a
  // fresh mount happens on every task navigated to, never a reused one
  // that could pick up a stale origin from the task before it.
  //
  // `takeTaskOrigin` returns undefined on a cold load (direct link,
  // refresh, a shared URL) by construction — see taskOrigin.ts for why
  // that can't be answered any other way — and `undefined` here means
  // "render no back control at all", per Ken's ruling. It is never
  // "unknown, so guess /list".
  const [origin] = useState(() => takeTaskOrigin());
  // A11Y-24: the shell's screen-reader channel, so a field save's
  // outcome is spoken. A successful `set` has no durable surface of its
  // own (the value simply updates in place), and its failure notice is
  // an anchored `role="alert"` — this makes both perceptible to a
  // non-sighted user through the one announcement region.
  const { announce } = useAnnouncer();

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const calendar = useCalendar();
  const workflow = useWorkflow();
  // L3: the active user, for MetaPanel's "Assign to me" quick action.
  // `data === null` is the identity-unknown state (SHL-40) — no users
  // registered or the read failed; the button is hidden there.
  const currentUser = useCurrentUser();
  // The whole graph, for the relationships panel's tree render. Called
  // unconditionally with the other queries: hooks cannot sit below the
  // pending / error returns.
  const taskGraph = useTaskGraph();

  const [confirming, setConfirming] = useState<"delete" | "move" | null>(null);
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

  // GIT-19: the write carries the stable id the tab fetched, so an edit
  // submitted after the ref was rekeyed onto another task is refused rather
  // than landing on the wrong task. Undefined until the first fetch lands;
  // a write cannot fire before then (the controls render from `task.data`).
  const setField = useSetField(taskRef, task.data?.frontmatter.id);
  const createLabel = useCreateLabel();

  const archive = useArchiveTask(taskRef);
  const del = useDeleteTask(taskRef);
  const move = useMoveTask(taskRef);
  const duplicate = useDuplicateTask(taskRef);


  /**
   * GIT-19 — follow a rekey that happened in another tab.
   *
   * When a background poll returns this task with a *different* current
   * key than the one in the URL, and the URL key is now one of its retired
   * keys, the task was renumbered while the tab sat open (a collision rekey
   * in another tab). The header already renders the current key (`fm.key`)
   * rather than the stale URL ref, so nothing here ever presents the old
   * key as authoritative — but the address bar still names the retired key.
   * Follow it: navigate to the current key and carry the retired one in
   * `?rekeyedFrom=` so the note below can keep explaining the change.
   *
   * `replace` so the retired-key URL does not become a back-stack entry
   * that would just redirect again. Skipped once we have already followed
   * (`taskRef === currentKey`).
   *
   * The follow fires for BOTH a cold navigation straight to a retired key
   * (TSK-2's move scenario) and a tab renumbered while it sat open. What
   * differs is the *note copy*, not whether we follow: a tab that was open
   * during the rekey gets "renumbered while you had it open"; a plain
   * retired-key visit gets "…which is a retired key for this task. Its
   * current key is …" (TSK-2 / XS-43). Both are told apart by whether this
   * tab ever observed `taskRef === currentKey` — only a tab that once showed
   * this key as live was actually renumbered underneath the user. That
   * signal is a ref (reset on each URL ref) and cannot survive the redirect,
   * so it is stamped into the URL as `rekeyedWhileOpen` when true; the note
   * reads it back after the redirect to pick the copy. A cold nav follows
   * without the marker and shows the retired-key copy.
   */
  const currentKey = task.data?.frontmatter.key;
  const currentHistory = task.data?.frontmatter.key_history;
  const sawLiveRef = useRef(false);
  useEffect(() => {
    // New URL ref — forget whatever a previous task looked like.
    sawLiveRef.current = false;
  }, [taskRef]);
  useEffect(() => {
    if (currentKey === taskRef) sawLiveRef.current = true;
  }, [currentKey, taskRef]);
  useEffect(() => {
    if (currentKey === undefined || currentKey === taskRef) return;
    if (rekeyedFrom !== undefined) return;
    if (!(currentHistory ?? []).includes(taskRef)) return;
    const whileOpen = sawLiveRef.current;
    void navigate({
      to: "/tasks/$key",
      params: { key: currentKey },
      search: prev => ({
        ...prev,
        rekeyedFrom: taskRef,
        ...(whileOpen ? { rekeyedWhileOpen: true } : {}),
      }),
      replace: true,
    });
  }, [currentKey, currentHistory, taskRef, rekeyedFrom, navigate]);

  if (task.isPending) {
    // Named, and distinguishable from both the 404 and the error
    // states — TSK-45 requires a not-found not be presented the same
    // way as a load in progress.
    return (
      <div className="grid h-full place-items-center p-8">
        {/* LoadingState carries role="status" + aria-busy, so the load is
            announced — the bare <p aria-busy> here was silent to a screen
            reader (design-review §A3). The centered wrapper and the muted
            treatment are preserved. */}
        <LoadingState className="text-[0.9286rem] text-text-tertiary">
          Loading {taskRef}…
        </LoadingState>
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
   *
   * GIT-19. Two shapes reach this note. Cold navigation through a retired
   * key: `taskRef` is the retired one and differs from `fm.key`. And the
   * follow-the-rekey redirect above, after which `taskRef === fm.key` (the
   * URL has moved to the current key) but `rekeyedFrom` names the retired
   * key the tab was on when it was renumbered elsewhere.
   */
  const retiredKey =
    taskRef !== fm.key && (fm.key_history ?? []).includes(taskRef)
      ? taskRef
      : rekeyedFrom !== undefined && (fm.key_history ?? []).includes(rekeyedFrom)
        ? rekeyedFrom
        : undefined;
  const navigatedByRetired = retiredKey !== undefined;


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
    // O5: `UserProfile.name` is now optional (a corrupt/absent name is
    // field-local). The label index needs a name string per id, so a
    // nameless user degrades to its id here — an id-shaped message beats
    // one with a blank where the name should be.
    users: users.data?.items.map(u => ({ id: u.id, name: u.name ?? u.id })),
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
  /**
   * A11Y-24. Announce the save outcome exactly once per write, from the
   * mutation's own callbacks — never from render, which would re-speak on
   * every unrelated re-paint (a background poll, a sibling field's edit)
   * and read out a stale backlog. The `Announcer` keys each message by a
   * counter, so two identical outcomes still both announce.
   *
   *  - Success is polite ("Status saved"): the value updated in place
   *    without moving focus, and a poll interrupt would be the wrong
   *    shape for a routine confirmation.
   *  - Failure is assertive and carries the *same message the notice
   *    shows* (`failure.message`) — a silent failure is A11Y-24's named
   *    worst case, and the field's `role="alert"` notice and this
   *    channel agree word-for-word so the two are never in conflict.
   */
  const writeField = (vars: { field: string; value?: unknown }): void => {
    setFieldError(null);
    setField.mutate(vars, {
      onSuccess: () => {
        announce(`${fieldLabel(vars.field)} saved`);
      },
      onError: (err: Error) => {
        const failure = toFieldFailure(err, vars, labelIndex, fm.key);
        setFieldError(failure);
        announce(failure.message, "assertive");
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

  // One page scroll (Ken, 2026-09-24): the header and the task body
  // scroll together in the shell's <main>. This used to be a fixed-height
  // column with its own inner scroller under the header, so the body
  // scrolled in a box and the page's scroll restoration never applied.
  return (
    <div className="flex flex-col">
      {/* UI-12: back to wherever this task was opened FROM — absent
          entirely on a cold load (Ken: "if cold load then no back
          button"), never a disabled control or a fallback destination.
          Same visual treatment as MilestoneDetail's "All milestones"
          back-link (the same decorative `arrowLeft` Icon beside the label),
          but the destination and label are the actual origin route
          (including its filters/sort/page) rather than a hardcoded one.
          This is independent of the "All tasks" breadcrumb inside the
          header below, which always points at the unfiltered list. */}
      {origin !== undefined && (
        <Link
          // `to` resolves as a path template, not a full href — the
          // search params have to travel through `search` instead, or a
          // literal "?status=…" would end up percent-encoded into the
          // pathname. `router.parseSearch` is the same parser the route
          // itself would apply to that query string, so a filtered
          // `/list?status=in_progress&page=2` round-trips exactly.
          to={origin.pathname}
          search={router.options.parseSearch(origin.search) as Record<string, unknown>}
          data-testid="task-detail-back"
          className="inline-flex items-center gap-1 self-start px-6 pt-4 text-[0.8571rem] text-text-tertiary no-underline hover:underline"
        >
          <Icon name="arrowLeft" size={12} />
          {origin.label}
        </Link>
      )}
      <header className="border-b border-border-subtle px-6 py-4">
        {/* All tasks › project label. The label is the project's `name`
            — not its slug `key` or its `prefix`, which name the same
            thing to the machine and nothing to the reader (TSK-1). */}
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-[0.8571rem]">
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
                className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.8571rem] font-medium text-text-secondary"
              >
                {fm.key}
              </span>
              {archived && (
                <span
                  data-testid="archived-badge"
                  className="rounded bg-warn-fg/15 px-1.5 py-0.5 text-[0.7857rem] font-medium text-warn-fg"
                >
                  Archived
                </span>
              )}
            </div>
            {/* L1: the title is editable in place, closing the GUI's
                core/surface parity hole (core/CLI/MCP can all rename via
                the `title` field). It writes through the same `writeField`
                path the MetaPanel editors use, so a rejection renders the
                shared FieldFailureNotice under the heading. `title` hover,
                break-words, and the K26 key fallback all live in the
                component. */}
            <EditableTitle
              title={fm.title}
              taskKey={fm.key}
              onCommit={t => { onSet("title", t); }}
              {...(fieldError?.field === "title" ? { error: fieldError } : {})}
              {...(fieldError?.field === "title" && fieldError.retry !== undefined
                ? { onRetry: retryWith(fieldError.retry, writeField) }
                : {})}
              onDismiss={() => { setFieldError(null); }}
            />
            {navigatedByRetired && (
              <p className="mt-1.5 text-[0.8571rem] text-text-tertiary">
                {/* GIT-19: the "renumbered while you had it open" copy is
                    reserved for a tab that was OPEN on this task when it was
                    rekeyed elsewhere (`rekeyedWhileOpen`). A cold navigation
                    to a retired key — which also follows to the live key —
                    keeps the plain retired-key copy TSK-2 / XS-43 require.
                    Keying on `rekeyedFrom === retiredKey` alone conflated the
                    two, because the cold-nav follow also stamps
                    `rekeyedFrom`. */}
                {rekeyedWhileOpen === true
                  ? "This task was renumbered while you had it open. It used to be "
                  : "You followed "}
                <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.7857rem]">
                  {retiredKey}
                </code>
                {rekeyedWhileOpen === true
                  ? ". Its current key is "
                  : ", which is a retired key for this task. Its current key is "}
                <strong className="font-medium text-text-primary">{fm.key}</strong>.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Menu
              aria-label={`Actions for ${fm.key}`}
              align="end"
              // Ken, 2026-09-24: a ⋯ icon like every other action menu,
              // not a "More" text button.
              trigger={t => (
                <IconButton
                  variant="secondary"
                  aria-label="Task actions"
                  testId="task-actions"
                  onClick={t.toggle}
                  aria-haspopup={t["aria-haspopup"]}
                  aria-expanded={t["aria-expanded"]}
                  id={t.id}
                >
                  <Icon name="more" size={16} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      onDuplicate();
                      close();
                    }}
                  >
                    <Icon name="plus" size={14} />
                    Duplicate
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setWriteError(null);
                      setConfirming("move");
                      close();
                    }}
                  >
                    <Icon name="chevronRight" size={14} />
                    Move to project
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
                    <Icon name={archived ? "unarchive" : "archive"} size={14} />
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
                    <Icon name="trash" size={14} />
                    Delete
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        {writeError !== null && (
          <p role="alert" className="mt-3 text-[0.9286rem] text-danger-fg">
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
      <div>
        <div className="grid grid-cols-1 gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* On a single column (mobile) the meta panel is ordered FIRST so
              Status / Priority / Assignee / Due sit directly under the
              title, above the description and comments — the most-used
              fields are otherwise unreachable at the bottom of the page.
              At `lg` the grid is two columns and source order (content
              left, meta right) is restored with `lg:order-none`. */}
          <div className="order-2 min-w-0 space-y-6 lg:order-none">
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
                taskId={task.data.frontmatter.id}
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
                  // The save adds a `body_edited` history entry.
                  void queryClient.invalidateQueries({ queryKey: activityQueryKey(taskRef) });
                }}
                mentionCandidates={(users.data?.items ?? []).map(u => ({
                  id: u.id,
                  name: u.name ?? u.id,
                }))}
              />
            </Section>

            <Section title="Related" id="relationships">
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
                // K26: title may be absent. It feeds only the link
                // picker's self-match predicate (not display), so an empty
                // string is honest — the key self-matches via `selfKey`.
                taskTitle={fm.title ?? ""}
                taskKeyHistory={fm.key_history ?? []}
                relationships={task.data.relationships}
                stored={fm.relationships}
                workflow={workflow.data}
                statusOf={lookups.status}
                taskIndex={taskGraph}
              />
            </Section>

            <Section title="Attachments" id="attachments">
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

            {/* K-5: Comments / Activity / All are ONE tabbed panel now.
                ActivityPanel owns all three tabs (the Comments tab renders
                <CommentsPanel> internally), so there is no separate
                Comments section — a standalone one would double-mount the
                composer/list (A163). Keyed by the task for the same reason
                as before: the composer buffer, in-progress edit, and the
                feed's loaded page count are component state that must not
                carry from task A onto task B. */}
            {/* K76: `#comments` scrolls the comments/activity panel into
                view. A link to a specific comment (`#comment-<id>`) also
                carries `?tab=comments` (see the copy-link affordance) so
                the comment is actually mounted when the scroll runs. */}
            <div id="comments">
            <ActivityPanel
              key={task.data.frontmatter.id}
              taskRef={taskRef}
              {...(activityTab !== undefined ? { tab: activityTab } : {})}
              onTabChange={t => {
                // CMT-18: record the open tab in the URL so it is
                // shareable/deep-linkable. `replace` keeps tab switches out
                // of the back-stack (a tab is a view of one task, not a
                // navigation step).
                void navigate({
                  to: "/tasks/$key",
                  params: { key: taskRef },
                  search: { tab: t },
                  replace: true,
                });
              }}
              workflow={workflow.data}
              users={users.data?.items ?? []}
              labels={labels.data?.items ?? []}
              milestones={milestones.data?.items ?? []}
              sprints={sprints.data?.items ?? []}
              projects={projects.data?.items ?? []}
              calendar={calendar.data}
            />
            </div>
          </div>

          {/* Ordered FIRST on mobile (see the content column's note) so it
              sits under the title; `lg:order-none` restores the right-hand
              column at two-up. The wrapper is the grid item; the panel's
              own width comes from the 280px track. */}
          <div className="order-1 min-w-0 lg:order-none">
          <MetaPanel
            frontmatter={fm}
            {...(task.data.health !== undefined ? { health: task.data.health } : {})}
            lookups={lookups}
            workflow={workflow.data}
            users={users.data?.items ?? []}
            labels={labels.data?.items ?? []}
            milestones={milestones.data?.items ?? []}
            sprints={sprints.data?.items ?? []}
            calendar={calendar.data}
            {...(currentUser.data != null ? { currentUser: currentUser.data } : {})}
            identityUnknown={currentUser.data === null}
            onSet={onSet}
            onUnset={onUnset}
            onCreateLabel={onCreateLabel}
            searchLabels={searchLabels}
            searchMilestones={searchMilestones}
            searchSprints={searchSprints}
            searchUsers={searchUsers}
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
      </div>

      {confirming === "delete" && (
        <DeleteTaskDialog
          taskKey={fm.key}
          // K26: an untitled task shows a placeholder; the dialog heading
          // already names the key.
          title={fm.title ?? "(untitled)"}
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
  id,
  children,
}: {
  readonly title: string;
  /** K76: deep-link anchor (e.g. `relationships`, `attachments`). */
  readonly id?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section {...(id !== undefined ? { id } : {})}>
      <h2 className="mb-2 text-[0.8571rem] font-semibold uppercase tracking-wide text-text-tertiary">
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
