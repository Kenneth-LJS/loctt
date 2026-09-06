import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useProjects } from "../api/hooks/sidebarData.ts";
import { useInfoFresh } from "../api/hooks/useInfo.ts";
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useSetDefaultProject,
  useSetProjectPrefix,
  useUpdateProject,
} from "../api/hooks/useProjectMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Modal } from "../ui/Modal.tsx";
import { TextField } from "../ui/TextField.tsx";
import { DeleteProjectDialog } from "./DeleteProjectDialog.tsx";
import { slugify, validateNewProject } from "./projectForm.ts";

/**
 * Settings → Projects (PRU-5, PRU-6, PRU-7, PRU-17, PRU-19, PRU-20,
 * PRU-32, PRU-33, PRU-35, PRU-36, PRU-44, PRU-45, PRU-46, PRU-48,
 * XS-63).
 *
 * Edit-model (B2): a project row is read-by-default. The name is no
 * longer a bare input that saves on blur — it now sits behind a per-row
 * **Edit** control that opens an inline form (matching Milestones and
 * Labels, which already gate their field edits the same way). Only the
 * name is a free field; the slug stays read-only (links depend on it)
 * and the prefix keeps its own confirm dialog (PRU-44) inside the form,
 * since a prefix change rewrites every task key and must never ride a
 * blur or a stray Save. Low-risk, non-field affordances — Make default
 * (PRU-48), Archive, Delete — stay as row-level controls in view mode.
 *
 * PRU-48: "Make default" sets the *workspace* default. It rides the
 * existing `PUT /api/projects/:id` (`default: true` → core
 * `setDefaultProject`), so no server route was added in this lane. The
 * current default is marked in the row and its button is inert.
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
      <TextField
        size="sm"
        aria-label={`Prefix of project ${project.name}`}
        data-testid={`project-prefix-${project.id}`}
        value={draft}
        onChange={e => { setDraft(e.target.value); setPrefix.reset(); }}
        invalid={problem !== undefined}
        className="w-24 font-mono"
      />
      <Button
        size="sm"
        variant="ghost"
        testId={`project-prefix-save-${project.id}`}
        disabled={!changed || problem !== undefined}
        onClick={() => { setConfirming(true); }}
        className="ml-2"
      >
        Change
      </Button>
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
        <Dialog
          title={`Change ${project.name} prefix?`}
          onClose={reset}
          testId={`project-prefix-confirm-${project.id}`}
          actions={(
            <DialogActions>
              <Button
                variant="ghost"
                testId={`project-prefix-cancel-${project.id}`}
                onClick={reset}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                testId={`project-prefix-confirm-btn-${project.id}`}
                disabled={setPrefix.isPending}
                onClick={() => {
                  setPrefix.mutate(
                    { id: project.id, prefix: trimmed },
                    { onSuccess: () => { setConfirming(false); } },
                  );
                }}
              >
                {setPrefix.isPending ? "Renaming…" : `Rename ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
              </Button>
            </DialogActions>
          )}
        >
          <p className="text-[13px] text-text-secondary">
            Changing the prefix to{" "}
            <code className="font-mono">{trimmed}</code> renames{" "}
            {taskCount} {taskCount === 1 ? "task" : "tasks"} in this
            project. Their numbers are preserved, and their old keys will
            keep resolving.
          </p>

          {setPrefix.isError && serverError !== undefined && (
            <p role="alert" data-testid={`project-prefix-confirm-error-${project.id}`} className="mt-3 text-[12px] text-danger-fg">
              {serverError} Nothing was renamed.
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}

function ProjectRow({
  project,
  taskCount,
  others,
  isOnlyProject,
  isDefault,
  onDelete,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  readonly others: readonly ProjectDef[];
  readonly isOnlyProject: boolean;
  readonly isDefault: boolean;
  readonly onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const setDefault = useSetDefaultProject();

  const archived = project.archived === true;
  const trimmed = name.trim();
  const nameOk = trimmed.length > 0;

  const commitName = () => {
    // PRU-6: the name is the only free field, saved on an explicit Save
    // rather than on blur (edit-model). An unchanged or empty value is a
    // no-op — the form just closes without a write.
    if (!nameOk || trimmed === project.name) {
      setName(project.name);
      setEditing(false);
      return;
    }
    update.mutate(
      { id: project.id, name: trimmed },
      { onSuccess: () => { setEditing(false); } },
    );
  };

  const cancelEdit = () => {
    setName(project.name);
    update.reset();
    setEditing(false);
  };

  return (
    <tr data-testid={`project-row-${project.id}`} data-archived={archived ? "true" : "false"}>
      <td className="py-2 pr-3 align-top">
        {editing
          ? (
              <div className="flex flex-col gap-1">
                <TextField
                  size="sm"
                  aria-label={`Name of project ${project.name}`}
                  data-testid={`project-name-input-${project.id}`}
                  value={name}
                  onChange={e => { setName(e.target.value); }}
                />
                {update.isError && (
                  <p role="alert" data-testid={`project-name-error-${project.id}`} className="text-[12px] text-danger-fg">
                    {update.error instanceof ApiError ? update.error.message : "Could not save."}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    testId={`project-name-save-${project.id}`}
                    disabled={!nameOk || update.isPending}
                    onClick={commitName}
                  >
                    {update.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    testId={`project-edit-cancel-${project.id}`}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )
          : (
              <div className="flex items-center gap-2">
                <span data-testid={`project-name-${project.id}`} className="text-[13px] text-text-primary">
                  {project.name}
                </span>
                {isDefault && (
                  <span
                    data-testid={`project-default-marker-${project.id}`}
                    className="rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
                  >
                    Default
                  </span>
                )}
                {archived && (
                  <span data-testid={`project-archived-marker-${project.id}`} className="text-[11px] text-text-tertiary">
                    (archived)
                  </span>
                )}
              </div>
            )}
      </td>
      {/* PRU-6/PRU-20: the slug is fixed — links depend on it — so it
          stays disabled and says why. The prefix, unlike the slug, IS
          editable (PRU-44), through its own confirm dialog: a change
          rewrites every task key, so it does not save on blur. Both are
          only reachable in the edit form, per the edit-model. */}
      <td className="py-2 pr-3 align-top">
        {editing
          ? (
              <TextField
                size="sm"
                readOnly
                disabled
                aria-label={`Slug of project ${project.name}`}
                data-testid={`project-slug-${project.id}`}
                title="A project's slug is fixed so existing links keep working."
                value={project.slug ?? ""}
                className="font-mono"
              />
            )
          : (
              <span data-testid={`project-slug-${project.id}`} className="font-mono text-[13px] text-text-secondary">
                {project.slug ?? ""}
              </span>
            )}
      </td>
      <td className="py-2 pr-3 align-top">
        {editing
          ? <PrefixEdit project={project} taskCount={taskCount} others={others} />
          : (
              <span data-testid={`project-prefix-display-${project.id}`} className="font-mono text-[13px] text-text-secondary">
                {project.prefix}
              </span>
            )}
      </td>
      <td className="py-2 pr-3 align-top text-[13px] text-text-secondary">
        {/* PRU-17: the count is visible before any dialog opens. */}
        <span data-testid={`project-refcount-${project.id}`}>{taskCount}</span>
      </td>
      <td className="py-2 text-right align-top">
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            testId={`project-edit-${project.id}`}
            onClick={() => {
              // B2 bug 5: re-seed the draft from the CURRENT prop when
              // opening Edit. `useState(project.name)` seeds once at
              // mount, so after an external rename the stale draft would
              // be written back on Save, silently reverting the rename.
              setName(project.name);
              update.reset();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
        {/* PRU-48: set the workspace default. The current default's
            button is inert and labelled, so the marker and the control
            cannot disagree. Archived projects cannot be made default —
            new tasks must not land in a hidden project. */}
        <Button
          size="sm"
          variant="ghost"
          testId={`project-set-default-${project.id}`}
          disabled={isDefault || archived || setDefault.isPending}
          title={archived
            ? "An archived project cannot be the default."
            : undefined}
          onClick={() => { setDefault.reset(); setDefault.mutate({ id: project.id }); }}
        >
          {isDefault ? "Default" : "Make default"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          testId={`project-archive-${project.id}`}
          onClick={() => {
            archive.reset();
            archive.mutate({ id: project.id, archived: !archived });
          }}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          testId={`project-delete-${project.id}`}
          disabled={isOnlyProject}
          title={isOnlyProject
            ? "A tracker must have at least one project. Create the replacement first."
            : undefined}
          onClick={onDelete}
          className="text-danger-fg hover:bg-danger-bg"
        >
          Delete
        </Button>
        {/* B2 bug 3: a failed Make-default or Archive must be visible —
            both mutations used to fail silently, leaving the marker and
            the on-disk state disagreeing with what the user saw. */}
        {setDefault.isError && (
          <p
            role="alert"
            data-testid={`project-set-default-error-${project.id}`}
            className="mt-1 text-[12px] text-danger-fg"
          >
            {setDefault.error instanceof ApiError ? setDefault.error.message : "Could not set the default project."}
          </p>
        )}
        {archive.isError && (
          <p
            role="alert"
            data-testid={`project-archive-error-${project.id}`}
            className="mt-1 text-[12px] text-danger-fg"
          >
            {archive.error instanceof ApiError ? archive.error.message : "Could not change the archived state."}
          </p>
        )}
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
  const defaultId = projects.data?.default ?? null;
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
              isDefault={defaultId === p.id}
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
