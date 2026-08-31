import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useProjects } from "../api/hooks/sidebarData.ts";
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
} from "../api/hooks/useProjectMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { DeleteProjectDialog } from "./DeleteProjectDialog.tsx";
import { slugify, validateNewProject } from "./projectForm.ts";

/**
 * Settings → Projects (PRU-5, PRU-6, PRU-7, PRU-17, PRU-19, PRU-20,
 * PRU-32, PRU-33, PRU-35, PRU-36, PRU-45, PRU-46, XS-63).
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

function ProjectRow({
  project,
  taskCount,
  isOnlyProject,
  onDelete,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
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
      {/* PRU-6/PRU-20: slug and prefix are disabled, not merely
          unvalidated, and say why. */}
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
        <input
          readOnly
          disabled
          aria-label={`Prefix of project ${project.name}`}
          data-testid={`project-prefix-${project.id}`}
          title="Changing the prefix renames every task in the project."
          value={project.prefix}
          className="h-8 w-24 rounded-md bg-bg-muted px-2 font-mono text-[13px] text-text-secondary"
        />
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
  const pending = projects.data?.pending_prefix_rename;

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

      {/* PRU-46: a half-applied prefix rename is reported, not hidden
          behind a healthy-looking list. */}
      {pending !== undefined && (
        <div
          role="alert"
          data-testid="project-prefix-rename-pending"
          className="mb-4 rounded-md border border-warn-fg/40 bg-bg-muted p-3 text-[13px]"
        >
          <p className="mb-1 font-medium text-warn-fg">
            A prefix rename did not finish
          </p>
          <p className="text-text-secondary">
            This project was being moved from{" "}
            <code className="font-mono">{pending.from}</code> to{" "}
            <code className="font-mono">{pending.to}</code>. Some tasks may
            still carry the old prefix.
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
