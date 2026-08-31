import type { ProjectDef } from "@loctt/contracts";

/**
 * What the modal's project field should open as.
 *
 * ## The resolution chain is the server's, not this module's
 *
 * `explicit > per-user default > workspace default > sole project` is
 * implemented once, in core, as `resolveProjectIdForUser`
 * (`packages/core/src/projects/manage.ts`). `GET /api/projects` runs
 * it and reports the answer as `effective_default`; `POST /api/tasks`
 * runs it again to decide where the task actually lands. Both the CLI
 * and MCP go through the same function.
 *
 * So this module deliberately implements **none** of that precedence.
 * It reads the answer the server already computed and decides only how
 * to *present* it. Reimplementing the chain client-side would give the
 * app a fourth opinion about where a task goes, and the one place it
 * disagreed would be a task filed in the wrong project — with the key
 * counter of the wrong project consumed to do it (NEW-14's second
 * bullet), which is not undoable.
 *
 * Measured against a real tracker while building this:
 *
 *   - one project + a `default:` line   -> effective_default = that id
 *   - three projects, no default at any
 *     level                             -> effective_default = null,
 *                                          and POST /api/tasks with no
 *                                          project returns 400 with
 *                                          field: "project"
 *
 * `null` is therefore not "missing data" — it is the server saying
 * there is no defensible answer, which is exactly NEW-19's ask state.
 */
export type ProjectChoice =
  /** Pre-fill this project; the field is editable. */
  | { readonly kind: "prefilled"; readonly id: string }
  /**
   * One project and nothing to choose. Still *shown* (NEW-18's second
   * bullet: the user must be able to see where their task lands), but
   * there is no alternative to pick.
   */
  | { readonly kind: "sole"; readonly id: string }
  /**
   * NEW-19: several projects and no default anywhere. The field opens
   * empty and is required. Picking "the first one" here is the exact
   * failure the case exists to catch.
   */
  | { readonly kind: "ask" };

export function resolveProjectChoice(
  projects: readonly ProjectDef[],
  effectiveDefault: string | null | undefined,
): ProjectChoice {
  // NEW-17: an archived project is not a valid destination, so it can
  // neither be pre-selected nor offered. Filtering here rather than at
  // each call site keeps "which projects exist" and "which projects
  // can receive a task" from drifting apart.
  const selectable = projects.filter(p => p.archived !== true);

  if (effectiveDefault !== null && effectiveDefault !== undefined) {
    // NEW-16 / NEW-17: the server resolved to something. Trust it only
    // if it is still a selectable project — a default naming a deleted
    // or archived project must fall through *silently* (NEW-16's
    // second bullet is explicit that no error is shown here), not
    // pre-fill a value the picker cannot show.
    if (selectable.some(p => p.id === effectiveDefault)) {
      return selectable.length === 1
        ? { kind: "sole", id: effectiveDefault }
        : { kind: "prefilled", id: effectiveDefault };
    }
  }

  // NEW-18: exactly one project and no default recorded anywhere. The
  // destination is not ambiguous, so asking would be busywork.
  if (selectable.length === 1) {
    const only = selectable[0];
    if (only !== undefined) return { kind: "sole", id: only.id };
  }

  return { kind: "ask" };
}

/**
 * The message shown when submit is attempted with no project chosen.
 *
 * NEW-19's third bullet asks for the reason, not a generic
 * "required" — the user is being asked because their workspace has no
 * default, and that is actionable (they can set one) in a way that
 * "This field is required" is not.
 */
export const NO_PROJECT_MESSAGE =
  "Pick a project — this workspace has no default.";
