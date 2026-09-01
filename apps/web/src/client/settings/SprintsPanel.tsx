import { Link } from "@tanstack/react-router";

import { useCountedSprints } from "../api/hooks/useDataMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

/**
 * Settings → Data → Sprints.
 *
 * Read-and-navigate rather than full CRUD: the sprint *detail* route
 * (M4.7) owns editing metadata and shows the burndown, so this panel's
 * job is the management list — every sprint, its state, its reference
 * count, and the link through to the burndown.
 *
 * The link is the ticket's "sprint → burndown link". The route's
 * segment is named `$key`, but it is filled with the sprint's **ULID**:
 * `SprintDef` is `{id, name, start_date, end_date, state}` and has no
 * user-facing key, which is the same reason M4.9 settled the segment as
 * `/sprints/<ulid>`. The destination is M4.7's detail view and is a
 * stub until that ticket lands, so this link resolves to the stub
 * rather than to a 404.
 */

const STATE_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  future: "Future",
};

export function SprintsPanel() {
  const sprints = useCountedSprints();

  if (sprints.isError) {
    return (
      <div className="p-8" data-testid="sprints-panel">
        <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
          Sprints
        </h1>
        <div data-testid="sprints-load-error" data-sprints-state="load-failed">
          <ErrorState
            error={sprints.error}
            onRetry={() => { void sprints.refetch(); }}
            context="reading .loctt/config/sprints.yaml"
          />
          <p className="mt-2 text-[13px] text-text-secondary">
            This is a failure to read the file, not an empty sprint list.
          </p>
        </div>
      </div>
    );
  }

  if (sprints.isLoading || sprints.data === undefined) {
    return <div className="p-8 text-[13px] text-text-tertiary">Loading sprints…</div>;
  }

  const items = sprints.data.items;

  return (
    <div className="p-8" data-testid="sprints-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Sprints
      </h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Stored in{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
          .loctt/config/sprints.yaml
        </code>. Open a sprint to edit its dates and see its burndown.
      </p>

      {items.length === 0
        ? (
            <p data-testid="sprints-empty" data-sprints-state="empty" className="text-[13px] text-text-tertiary">
              No sprints yet.
            </p>
          )
        : (
            <ul className="m-0 list-none p-0" data-testid="sprints-list">
              {items.map(sprint => (
                <li
                  key={sprint.id}
                  data-testid={`sprint-row-${sprint.id}`}
                  data-sprint-state={sprint.state}
                  className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {sprint.name}
                  </span>
                  <span className="w-24 shrink-0 text-[12px] text-text-secondary">
                    {STATE_LABEL[sprint.state] ?? sprint.state}
                  </span>
                  <span className="w-48 shrink-0 text-[12px] text-text-secondary">
                    {sprint.start_date} → {sprint.end_date}
                  </span>
                  <span
                    data-testid="sprint-refcount"
                    data-sprint-refcount={String(sprint.taskCount ?? 0)}
                    className="w-24 shrink-0 text-right text-[12px] text-text-secondary"
                  >
                    {String(sprint.taskCount ?? 0)} task
                    {(sprint.taskCount ?? 0) === 1 ? "" : "s"}
                  </span>
                  {/*
                    The ticket's sprint → burndown link. Addressed by
                    ULID: SprintDef carries no user-facing key.
                  */}
                  <Link
                    to="/sprints/$key"
                    params={{ key: sprint.id }}
                    data-testid="sprint-burndown-link"
                    className="shrink-0 text-[12px] text-accent hover:underline"
                  >
                    Burndown
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
