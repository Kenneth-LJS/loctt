import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useProjects } from "../api/hooks/sidebarData.ts";
import { useInfoFresh } from "../api/hooks/useInfo.ts";
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useSetProjectPrefix,
  useUpdateProject,
} from "../api/hooks/useProjectMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { DeleteProjectDialog } from "./DeleteProjectDialog.tsx";
import { slugify, validateNewProject } from "./projectForm.ts";

/**
 * Settings → Projects (PRU-5, PRU-6, PRU-7, PRU-17, PRU-19, PRU-20,
 * PRU-32, PRU-33, PRU-35, PRU-36, PRU-44, PRU-45, PRU-46, XS-63).
 *
 * PRU-44/PRU-45: the per-project prefix is an editable control
 * (`PrefixEdit`) wired to `useSetProjectPrefix`, with a confirm dialog
 * stating how many tasks a rename touches before it runs, and a
 * field-level collision error. Previously the field was `readOnly
 * disabled` and the hook was dead — the tags were hollow (K30).
 *
 * The panel is not scoped by the top-bar project filter (PRU-32):
 * project *management* is about every project, so nothing here reads
 * the `?project=` search param.
 */

function CreateProjectForm({
  existing,
  onDone,
}: {
  readonly existing: readonly ProjectDef[];
  readonly onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const create = useCreateProject();

  // PRU-19/PRU-35/PRU-36: the conflict is surfaced *before* submit,
  // from the project list the panel already holds. No round-trip
  // half-creates the project.
  const problems = validateNewProject(
    { name, prefix, slug: slugTouched ? slug : slugify(name) },
    existing,
  );
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const blocked = problems.name !== undefined
    || problems.prefix !== undefined
    || problems.slug !== undefined
    || name.trim().length === 0
    || prefix.trim().length === 0;

  const submit = () => {
    if (blocked) return;
    create.mutate(
      {
        name: name.trim(),
        prefix: prefix.trim(),
        ...(effectiveSlug.length > 0 ? { slug: effectiveSlug } : {}),
      },
      { onSuccess: onDone },
    );
  };

  const serverField = create.error instanceof ApiError
    ? create.error.envelope?.field
    : undefined;
  const serverMessage = create.error instanceof ApiError
    ? create.error.envelope?.message ?? create.error.message
    : create.error?.message;

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">Name</span>
        <input
          data-testid="project-create-name"
          value={name}
          onChange={e => { setName(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
        />
        {problems.name !== undefined && (
          <p role="alert" data-testid="project-create-name-problem" className="text-[11px] text-danger-fg">
            {problems.name}
          </p>
        )}
      </label>

      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">
          Prefix
          {/* PRU-5: not "permanent" (no longer true) and not silent —
              the cost is stated. */}
          <span className="ml-1 text-text-tertiary">
            — changeable later only by renaming every task in the project
          </span>
        </span>
        <input
          data-testid="project-create-prefix"
          value={prefix}
          onChange={e => { setPrefix(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 font-mono text-[13px]"
        />
        {problems.prefix !== undefined && (
          <p role="alert" data-testid="project-create-prefix-problem" className="text-[11px] text-danger-fg">
            {problems.prefix}
          </p>
        )}
      </label>

      <label className="grid gap-1 text-[13px]">
        <span className="text-text-secondary">
          Slug <span className="text-text-tertiary">— used in links; fixed once created</span>
        </span>
        <input
          data-testid="project-create-slug"
          value={effectiveSlug}
          onChange={e => { setSlugTouched(true); setSlug(e.target.value); }}
          className="h-8 rounded-md border border-border-default bg-bg-surface px-2 font-mono text-[13px]"
        />
        {problems.slug !== undefined && (
          <p role="alert" data-testid="project-create-slug-problem" className="text-[11px] text-danger-fg">
            {problems.slug}
          </p>
        )}
      </label>

      {create.isError && (
        <p
          role="alert"
          data-testid={`project-create-error${serverField !== undefined ? `-${serverField}` : ""}`}
          className="text-[12px] text-danger-fg"
        >
          {serverMessage}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-3 text-[13px] text-text-secondary">
          Cancel
        </button>
        <button
          type="button"
          data-testid="project-create-submit"
          disabled={blocked || create.isPending}
          onClick={submit}
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create project"}
        </button>
      </div>
    </div>
  );
}

/**
 * PRU-44 / PRU-45: the editable project-prefix control.
 *
 * The prefix is editable — unlike the slug — but a change rewrites
 * every task key in the project, so it does *not* save on blur the way
 * the name does. The user edits the field, then confirms in a dialog
 * that states the blast radius in numbers (how many tasks, that old
 * keys keep resolving) before anything is written (PRU-44).
 *
 * A prefix already in use is caught at the field before submit
 * (PRU-45): the client holds the project list, so the collision is
 * surfaced without a round-trip. The server enforces the same rule and
 * returns a `field: "prefix"` envelope, which renders here at the input
 * too — the early check is a warning, not the enforcement.
 */
function PrefixEdit({
  project,
  taskCount,
  others,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  readonly others: readonly ProjectDef[];
}) {
  const [draft, setDraft] = useState(project.prefix);
  const [confirming, setConfirming] = useState(false);
  const setPrefix = useSetProjectPrefix();

  const trimmed = draft.trim();
  const changed = trimmed !== project.prefix;

  // PRU-45: re-entering the project's own prefix is a no-op, not a
  // collision. Compared case-insensitively for the same reason the
  // create form does: two prefixes differing only in case produce keys
  // a human cannot tell apart.
  const exact = others.find(p => p.prefix === trimmed);
  const caseless = others.find(
    p => p.prefix.toLowerCase() === trimmed.toLowerCase(),
  );
  const clientProblem =
    trimmed.length === 0
      ? "A prefix cannot be empty."
      : exact
        ? `Prefix ${trimmed} is already used by "${exact.name}". Prefixes must be unique across the tracker.`
        : caseless
          ? `Prefix ${trimmed} differs only in case from ${caseless.prefix}, used by "${caseless.name}". Task keys from the two would be hard to tell apart.`
          : undefined;

  // The server's field-level error (PRU-45, ERR-14) renders at the
  // input, not only in a toast.
  const serverError = setPrefix.error instanceof ApiError
    && setPrefix.error.envelope?.field === "prefix"
    ? setPrefix.error.envelope.message
    : undefined;
  const problem = clientProblem ?? serverError;

  const reset = () => {
    setConfirming(false);
    setDraft(project.prefix);
    setPrefix.reset();
  };

  return (
    <>
      <input
        aria-label={`Prefix of project ${project.name}`}
        data-testid={`project-prefix-${project.id}`}
        value={draft}
        onChange={e => { setDraft(e.target.value); setPrefix.reset(); }}
        aria-invalid={problem !== undefined ? true : undefined}
        className="h-8 w-24 rounded-md border border-border-subtle bg-bg-surface px-2 font-mono text-[13px] hover:border-border-default focus:border-border-default"
      />
      <button
        type="button"
        data-testid={`project-prefix-save-${project.id}`}
        disabled={!changed || problem !== undefined}
        onClick={() => { setConfirming(true); }}
        className="ml-2 h-8 rounded-md px-2 text-[13px] text-text-secondary hover:bg-bg-muted disabled:opacity-40"
      >
        Change
      </button>
      {problem !== undefined && changed && (
        <p
          role="alert"
          data-testid={`project-prefix-error-${project.id}`}
          className="mt-1 text-[12px] text-danger-fg"
        >
          {problem}
        </p>
      )}

      {confirming && (
        <Modal title={`Change ${project.name} prefix?`} onClose={reset}>
          <div className="grid gap-3" data-testid={`project-prefix-confirm-${project.id}`}>
            <p className="text-[13px] text-text-secondary">
              Changing the prefix to{" "}
              <code className="font-mono">{trimmed}</code> renames{" "}
              {taskCount} {taskCount === 1 ? "task" : "tasks"} in this
              project. Their numbers are preserved, and their old keys will
              keep resolving.
            </p>

            {setPrefix.isError && serverError !== undefined && (
              <p role="alert" data-testid={`project-prefix-confirm-error-${project.id}`} className="text-[12px] text-danger-fg">
                {serverError} Nothing was renamed.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid={`project-prefix-cancel-${project.id}`}
                onClick={reset}
                className="h-8 rounded-md px-3 text-[13px] text-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid={`project-prefix-confirm-btn-${project.id}`}
                disabled={setPrefix.isPending}
                onClick={() => {
                  setPrefix.mutate(
                    { id: project.id, prefix: trimmed },
                    { onSuccess: () => { setConfirming(false); } },
                  );
                }}
                className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50"
              >
                {setPrefix.isPending ? "Renaming…" : `Rename ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ProjectRow({
  project,
  taskCount,
  others,
  isOnlyProject,
  onDelete,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  readonly others: readonly ProjectDef[];
  readonly isOnlyProject: boolean;
  readonly onDelete: () => void;
}) {
  const [name, setName] = useState(project.name);
  const update = useUpdateProject();
  const archive = useArchiveProject();

  const commitName = () => {
    const next = name.trim();
    if (next.length === 0 || next === project.name) {
      setName(project.name);
      return;
    }
    update.mutate({ id: project.id, name: next });
  };

  return (
    <tr data-testid={`project-row-${project.id}`} data-archived={project.archived === true ? "true" : "false"}>
      <td className="py-2 pr-3">
        <input
          aria-label={`Name of project ${project.name}`}
          data-testid={`project-name-${project.id}`}
          value={name}
          onChange={e => { setName(e.target.value); }}
          onBlur={commitName}
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[13px] hover:border-border-subtle focus:border-border-default"
        />
      </td>
      {/* PRU-6/PRU-20: the slug is fixed — links depend on it — so it
          stays disabled and says why. The prefix, unlike the slug, IS
          editable (PRU-44), through its own confirm dialog: a change
          rewrites every task key, so it does not save on blur. */}
      <td className="py-2 pr-3">
        <input
          readOnly
          disabled
          aria-label={`Slug of project ${project.name}`}
          data-testid={`project-slug-${project.id}`}
          title="A project's slug is fixed so existing links keep working."
          value={project.slug ?? ""}
          className="h-8 w-full rounded-md bg-bg-muted px-2 font-mono text-[13px] text-text-secondary"
        />
      </td>
      <td className="py-2 pr-3">
        <PrefixEdit project={project} taskCount={taskCount} others={others} />
      </td>
      <td className="py-2 pr-3 text-[13px] text-text-secondary">
        {/* PRU-17: the count is visible before any dialog opens. */}
        <span data-testid={`project-refcount-${project.id}`}>{taskCount}</span>
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          data-testid={`project-archive-${project.id}`}
          onClick={() => {
            archive.mutate({ id: project.id, archived: project.archived !== true });
          }}
          className="h-8 rounded-md px-2 text-[13px] text-text-secondary hover:bg-bg-muted"
        >
          {project.archived === true ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          data-testid={`project-delete-${project.id}`}
          disabled={isOnlyProject}
          title={isOnlyProject
            ? "A tracker must have at least one project. Create the replacement first."
            : undefined}
          onClick={onDelete}
          className="h-8 rounded-md px-2 text-[13px] text-danger-fg hover:bg-danger-bg disabled:opacity-50"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export function ProjectsPanel() {
  const projects = useProjects();
  // K16: the completed-rename notice rides on /api/info, the same
  // channel the schema banner uses for a server-side fact the client
  // could not otherwise know.
  //
  // Must sit ABOVE the isError/isLoading early returns. It was below
  // them, so the first render (projects loading) never ran its hooks
  // and the second did — React error #310, "rendered more hooks than
  // during the previous render", which crashed the whole panel
  // subtree. typecheck cannot see that; only running it can.
  const info = useInfoFresh();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectDef | undefined>(undefined);
  const deleteProject = useDeleteProject();

  // Ordering (ERR-1): error before empty, so a failure never renders as
  // "you have no projects".
  if (projects.isError) {
    return (
      <div className="p-8">
        <ErrorState
          error={projects.error}
          onRetry={() => { void projects.refetch(); }}
          context="the projects list"
        />
      </div>
    );
  }
  if (projects.isLoading) {
    return <div className="p-8 text-[13px] text-text-tertiary">Loading projects…</div>;
  }

  const items = projects.data?.items ?? [];
  const counts = projects.data?.task_counts ?? {};
  const completed = info.data?.completedPrefixRename;

  return (
    <div className="p-8" data-testid="settings-projects">
      <h1 className="mb-1 text-lg font-semibold">Projects</h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Each project has its own key prefix and counter. Defined in{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono">
          .loctt/config/projects.yaml
        </code>
        .
      </p>

      {/* PRU-46 / K16: an interrupted rename is *already finished* by
          the time this renders — the server completes one ahead of
          every handler, so a mid-rename state cannot reach the client.
          What the user needs is to be told their keys changed, once.
          `role="status"`, not `alert`: nothing is wrong and there is
          nothing to do. The panel previously rendered a "did not
          finish" warning off `pending_prefix_rename`, a field the
          middleware guarantees is never populated — dead code that
          read as a working feature. */}
      {completed !== undefined && (
        <div
          role="status"
          data-testid="project-prefix-rename-completed"
          className="mb-4 rounded-md border border-border-default bg-bg-muted p-3 text-[13px]"
        >
          <p className="mb-1 font-medium">
            A prefix rename that was interrupted has been completed
          </p>
          <p className="text-text-secondary">
            <code className="font-mono">{completed.from}</code> →{" "}
            <code className="font-mono">{completed.to}</code>,{" "}
            {completed.renamed}{" "}
            {completed.renamed === 1 ? "task" : "tasks"} renamed. Old keys
            still resolve.
          </p>
        </div>
      )}

      {/* NEW-20 / K23: the workspace `default:` points at a project
          that no longer exists (a rename or hand-edit left it stale).
          This is tolerated drift, not a config error — the list below
          is healthy — but new tasks now fall to the ask state instead
          of landing in that default, so the user is told once, where
          they can fix it. `role="alert"`: unlike the completed-rename
          notice above, there is something to do. */}
      {projects.data?.default_drift !== undefined && (
        <div
          role="alert"
          data-testid="project-default-drift"
          className="mb-4 rounded-md border border-border-subtle bg-warn-bg p-3 text-[13px] text-warn-fg"
        >
          <p className="mb-1 font-medium">Your workspace default no longer exists</p>
          <p>
            <code className="font-mono">
              {projects.data.default_drift.default}
            </code>{" "}
            is set as the default project but is not in the list below. New
            tasks will ask you to pick a project until you set a default that
            exists.
          </p>
        </div>
      )}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-tertiary">
            <th className="py-1 pr-3 font-medium">Name</th>
            <th className="py-1 pr-3 font-medium">Slug</th>
            <th className="py-1 pr-3 font-medium">Prefix</th>
            <th className="py-1 pr-3 font-medium">Tasks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map(p => (
            <ProjectRow
              key={p.id}
              project={p}
              taskCount={counts[p.id] ?? 0}
              others={items.filter(o => o.id !== p.id)}
              isOnlyProject={items.length === 1}
              onDelete={() => { setDeleting(p); }}
            />
          ))}
        </tbody>
      </table>

      <div className="mt-4">
        <button
          type="button"
          data-testid="project-create-open"
          onClick={() => { setCreating(true); }}
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast"
        >
          New project
        </button>
      </div>

      {creating && (
        <Modal title="New project" onClose={() => { setCreating(false); }}>
          <CreateProjectForm existing={items} onDone={() => { setCreating(false); }} />
        </Modal>
      )}

      {deleting !== undefined && (
        <DeleteProjectDialog
          project={deleting}
          taskCount={counts[deleting.id] ?? 0}
          others={items.filter(p => p.id !== deleting.id && p.archived !== true)}
          mutation={deleteProject}
          onClose={() => { setDeleting(undefined); deleteProject.reset(); }}
        />
      )}
    </div>
  );
}
