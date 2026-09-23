import type { ArchivedScope, ProjectDef } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useProjectsScoped } from "../api/hooks/sidebarData.ts";
import { useInfoFresh } from "../api/hooks/useInfo.ts";
import { useDeleteProject } from "../api/hooks/useProjectMutations.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { ArchivedScopeReveal } from "./ArchivedScopeReveal.tsx";
import { CreateProjectDialog } from "./CreateProjectDialog.tsx";
import { hashDeepLinkPresent } from "./deepLinkHash.ts";
import { DeleteProjectDialog } from "./DeleteProjectDialog.tsx";
import { ProjectEditDialog } from "./ProjectEditDialog.tsx";
import { RowActions } from "./RowActions.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";

/**
 * Settings → Projects (PRU-5, PRU-6, PRU-7, PRU-17, PRU-19, PRU-20,
 * PRU-32, PRU-33, PRU-35, PRU-36, PRU-44, PRU-45, PRU-46, PRU-48,
 * XS-63).
 *
 * Edit-model (B2) / K100: a project row is read-by-default. Editing runs
 * through the shared `ProjectEditDialog` (name / prefix / make-default /
 * archive), which the sidebar's project rows ALSO open — so an edit made
 * from Settings and one made from a point of use go through the *same*
 * component and cannot drift (K100). The row's kebab keeps only Edit…
 * (opens the dialog) and Delete (panel-owned: it needs the remap picker
 * and the "at least one project" guard). The slug is read-only text
 * (links depend on it).
 *
 * PRU-48: "Make default" (inside the dialog) sets the *workspace* default.
 * It rides the existing `PUT /api/projects/:id` (`default: true` → core
 * `setDefaultProject`), so no server route was added in this lane. The
 * current default is marked in the read-only row.
 *
 * PRU-44/PRU-45: the per-project prefix is an editable control
 * (`PrefixEdit`, now living in `ProjectEditDialog`) wired to
 * `useSetProjectPrefix`, with a confirm dialog stating how many tasks a
 * rename touches before it runs, and a field-level collision error. A
 * prefix change rewrites every task key, so it keeps its own confirm and
 * never rides the name Save (K30).
 *
 * The panel is not scoped by the top-bar project filter (PRU-32):
 * project *management* is about every project, so nothing here reads
 * the `?project=` search param.
 */

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
  // K100: name / prefix / make-default / archive editing now runs through
  // the shared ProjectEditDialog (which the sidebar also opens), rather
  // than an inline row form. The dialog is mounted fresh on open, so it
  // seeds from the CURRENT project prop — the B2 bug-5 stale-draft trap is
  // handled by mounting, not by resetting draft state here. Delete stays a
  // row action: it needs the panel's remap picker and the "at least one
  // project" guard, which are panel-owned.
  const [editing, setEditing] = useState(false);

  const archived = project.archived === true;

  return (
    <tr id={`row-${project.id}`} data-testid={`project-row-${project.id}`} data-archived={archived ? "true" : "false"}>
      <td className="py-2 pr-3 align-top">
        <div className="flex items-center gap-2">
          <span data-testid={`project-name-${project.id}`} className="text-[0.9286rem] text-text-primary">
            {project.name}
          </span>
          {isDefault && (
            <span
              data-testid={`project-default-marker-${project.id}`}
              className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.7857rem] font-medium text-text-secondary"
            >
              Default
            </span>
          )}
          {archived && (
            <span data-testid={`project-archived-marker-${project.id}`} className="text-[0.7857rem] text-text-tertiary">
              (archived)
            </span>
          )}
        </div>
      </td>
      {/* PRU-6/PRU-20: the slug is fixed — links depend on it — so it is
          shown read-only. The prefix, unlike the slug, IS editable
          (PRU-44), reached inside the Edit dialog through its own confirm
          flow. */}
      <td className="py-2 pr-3 align-top">
        <span data-testid={`project-slug-${project.id}`} className="text-[0.9286rem] text-text-secondary">
          {project.slug ?? ""}
        </span>
      </td>
      <td className="py-2 pr-3 align-top">
        <span data-testid={`project-prefix-display-${project.id}`} className="text-[0.9286rem] text-text-secondary">
          {project.prefix}
        </span>
      </td>
      <td className="py-2 pr-3 align-top text-[0.9286rem] text-text-secondary">
        {/* PRU-17: the count is visible before any dialog opens. */}
        <span data-testid={`project-refcount-${project.id}`}>{taskCount}</span>
      </td>
      <td className="py-2 text-right align-top">
        {/* Row actions in a kebab (like every other settings panel).
            Edit opens the shared dialog (name / prefix / make-default /
            archive); Delete stays here (panel-owned remap + last-project
            guard). */}
        <RowActions
          label={`Actions for project ${project.name}`}
          actions={[
            {
              label: "Edit…",
              testId: `project-edit-${project.id}`,
              onSelect: () => { setEditing(true); },
            },
            {
              label: "Delete",
              testId: `project-delete-${project.id}`,
              danger: true,
              disabled: isOnlyProject,
              title: isOnlyProject
                ? "A tracker must have at least one project. Create the replacement first."
                : undefined,
              onSelect: onDelete,
            },
          ]}
        />
        {/* The dialog lives inside this cell (not as a bare child of the
            <tr>): Modal is not portalled, so a <div> child of <tr> would
            be invalid HTML the browser hoists out of the table. Mounted
            fresh on open so it seeds from the current project. */}
        {editing && (
          <ProjectEditDialog
            project={project}
            taskCount={taskCount}
            others={others}
            isDefault={isDefault}
            onClose={() => { setEditing(false); }}
          />
        )}
      </td>
    </tr>
  );
}

export function ProjectsPanel() {
  // K107: this panel had NO archived control before — archived projects
  // rendered inline with an `(archived)` marker. It now defaults to the
  // `active` scope and reveals archived through the tri-state control. A
  // deep-link hash widens the fetch to `all` so a `#row-<id>` anchor to an
  // archived project still resolves (K100). `task_counts`/`default` stay
  // server-computed over the full config regardless of scope.
  const [scope, setScope] = useState<ArchivedScope>("active");
  const [hashPresent] = useState(hashDeepLinkPresent);
  const effectiveScope: ArchivedScope = hashPresent ? "all" : scope;
  const projects = useProjectsScoped(effectiveScope);
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
      <div>
        <ErrorState
          error={projects.error}
          onRetry={() => { void projects.refetch(); }}
          context="the projects list"
        />
      </div>
    );
  }
  if (projects.isLoading) {
    return <LoadingState>Loading projects…</LoadingState>;
  }

  const items = projects.data?.items ?? [];
  const counts = projects.data?.task_counts ?? {};
  const defaultId = projects.data?.default ?? null;
  const completed = info.data?.completedPrefixRename;

  return (
    <div data-testid="settings-projects">
      <SettingsPanelHeader
        title="Projects"
        actions={(
          <>
            {/* Ken's ruling, 2026-09-22 (decisions.md § 9): demoted behind
                an icon reveal rather than a permanently visible segmented
                control — see ArchivedScopeReveal. Used to sit in its own
                always-visible row above the table. */}
            <ArchivedScopeReveal
              testId="projects-archived-scope"
              panelLabel="projects"
              value={scope}
              onChange={setScope}
            />
            <Button
              variant="primary"
              testId="project-create-open"
              onClick={() => { setCreating(true); }}
            >
              New project
            </Button>
          </>
        )}
      />
      <p className="mb-1 text-[0.9286rem] text-text-secondary">
        Each project has its own key prefix and counter. Set the workspace
        default — where new tasks land for a user with no personal default —
        from a project row&rsquo;s actions.
      </p>
      {/* CONFIG-5 / P4: the row-level "Make default" here sets the
          *workspace* default; each user can also set a *personal* default
          that wins for them. Cross-link so the two "default project"
          concepts are not mistaken for one. */}
      <p className="mb-4 text-[0.7857rem] text-text-tertiary">
        Your personal default is in{" "}
        <Link
          to="/settings/$section"
          params={{ section: "preferences" }}
          data-testid="projects-personal-default-link"
          className="text-accent underline hover:text-text-primary"
        >
          Settings → My preferences
        </Link>
        .
      </p>

      {/* PRU-46 / K16: an interrupted rename is *already finished* by
          the time this renders — the server completes one ahead of
          every handler, so a mid-rename state cannot reach the client.
          What the user needs is to be told their keys changed, once.
          `role="status"`, not `alert`: nothing is wrong and there is
          nothing to do. The panel previously rendered a "did not
          finish" warning off a `pending_prefix_rename` field the
          middleware could never populate — that field and its banner
          were both removed as dead code (A-PRESCAN-1). */}
      {completed !== undefined && (
        <div
          role="status"
          data-testid="project-prefix-rename-completed"
          className="mb-4 rounded-md border border-border-default bg-bg-muted p-3 text-[0.9286rem]"
        >
          <p className="mb-1 font-medium">
            A prefix rename that was interrupted has been completed
          </p>
          <p className="text-text-secondary">
            <code>{completed.from}</code> →{" "}
            <code>{completed.to}</code>,{" "}
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
          className="mb-4 rounded-md border border-border-subtle bg-warn-bg p-3 text-[0.9286rem] text-warn-fg"
        >
          <p className="mb-1 font-medium">Your workspace default no longer exists</p>
          <p>
            <code>
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
          <tr className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
            <th className="py-1 pr-3 font-medium">Name</th>
            <th className="py-1 pr-3 font-medium">Slug</th>
            <th className="py-1 pr-3 font-medium">Prefix</th>
            <th className="py-1 pr-3 font-medium">Tasks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            // Ordering (ERR-1): error and loading are handled above, so
            // reaching here with no rows is a genuinely empty list — not a
            // failed load. Without this the table rendered header-only,
            // which reads as broken rather than as "nothing here yet".
            // A tracker normally keeps at least one project (the delete
            // guard), so this is the degraded/hand-edited case; it still
            // teaches and points at the same create control below.
            <tr>
              <td colSpan={5} className="py-8 text-center text-[0.9286rem] text-text-tertiary">
                {scope === "archived" ? (
                  <div data-testid="projects-empty">No archived projects.</div>
                ) : (
                  <div className="flex flex-col items-center gap-3" data-testid="projects-empty">
                    <span>No projects yet. Every task belongs to a project, so create one to get started.</span>
                    <Button
                      variant="primary"
                      size="sm"
                      testId="projects-empty-create"
                      onClick={() => { setCreating(true); }}
                    >
                      New project
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ) : (
            items.map(p => (
              <ProjectRow
                key={p.id}
                project={p}
                taskCount={counts[p.id] ?? 0}
                others={items.filter(o => o.id !== p.id)}
                isOnlyProject={items.length === 1}
                isDefault={defaultId === p.id}
                onDelete={() => { setDeleting(p); }}
              />
            ))
          )}
        </tbody>
      </table>

      {creating && (
        <CreateProjectDialog existing={items} onClose={() => { setCreating(false); }} />
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
