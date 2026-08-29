import type { ProjectDef } from "@loctt/contracts";
import { useEffect, useState } from "react";

/**
 * Move one task to another project.
 *
 * No typed confirmation: a move is reversible (move it back), so the
 * friction delete carries would be misplaced. TSK-44 is what this
 * dialog owes — Cancel and `Esc` both dismiss, and dismissing changes
 * nothing, because the request only goes out on Move.
 *
 * The current project is offered but disabled: seeing where the task
 * is now is what makes the choice meaningful, and moving a task to the
 * project it is already in is a no-op the server would accept.
 */
export function MoveTaskDialog({
  taskKey,
  projects,
  currentProject,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly taskKey: string;
  readonly projects: readonly ProjectDef[];
  readonly currentProject: string | undefined;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (projectId: string) => void;
}) {
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  const choices = projects.filter(p => p.archived !== true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-task-title"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5 shadow-lg"
      >
        <h2 id="move-task-title" className="text-[15px] font-semibold text-text-primary">
          Move {taskKey} to another project
        </h2>

        {/* The key changes on a move, and a user who cannot find the
            task afterwards has effectively lost it. Say so before, not
            only in the result. */}
        <p className="mt-2 text-[13px] text-text-secondary">
          The task keeps its history, but takes a new key in the
          destination project. {taskKey} will keep working as a link.
        </p>

        <label className="mt-4 block text-[12px] font-medium text-text-secondary">
          Destination project
          <select
            value={selected}
            onChange={e => { setSelected(e.target.value); }}
            aria-label="Destination project"
            className="mt-1 w-full rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-1.5 text-[13px] text-text-primary"
          >
            <option value="">Choose a project…</option>
            {choices.map(p => (
              <option key={p.id} value={p.id} disabled={p.id === currentProject}>
                {p.name}
                {p.id === currentProject ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>

        {error !== undefined && (
          <p role="alert" className="mt-3 text-[13px] text-danger-fg">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(selected); }}
            disabled={selected === "" || pending}
            className="rounded-md border border-border-subtle bg-bg-muted px-3 py-1.5 text-[13px] font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Moving…" : "Move task"}
          </button>
        </div>
      </div>
    </div>
  );
}
