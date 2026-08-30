import type {
  SavedQuery,
  TimelineGrouping,
  TimelineZoom,
  WorkflowConfig,
} from "@loctt/contracts";

/**
 * Resolves the timeline's three display settings (M3.3a).
 *
 * ## The precedence chain
 *
 * TML-1, TML-2, TML-8 and TML-15 between them define one chain, and it
 * is the same for all three settings:
 *
 *   URL param → saved view's `display` → `workflow.timeline` → built-in
 *
 * The order is not arbitrary. TML-2 requires a saved view's
 * `display.zoom: day` to beat `workflow.timeline.default_zoom: month`,
 * and TML-1's last bullet requires a pasted URL to open "the same zoom
 * **regardless of the workspace default**" — which only holds if the
 * URL outranks both config layers. `query.ts`'s own docstring states
 * the same order ("view.display → workspace defaults → built-in"), so
 * this is implementing a documented contract rather than inventing one.
 *
 * ## The built-in fallbacks
 *
 * TML-1: "Removing `default_zoom` from `workflow.yaml` and reloading
 * opens at `week` (the documented built-in fallback), **not at day**."
 * TML-8: "With `default_grouping` absent, the view opens at `none`."
 * The contracts docstring for `TimelineConfigSchema` names all three:
 * "week / true / none".
 *
 * Kept in one module, and each returned alongside `source`, so the view
 * can render the chain's outcome without re-deriving it — and so a
 * regression in precedence shows up as a unit-test failure rather than
 * as a zoom that is subtly wrong only when a saved view is open.
 */

export const BUILTIN_ZOOM: TimelineZoom = "week";
export const BUILTIN_GROUPING: TimelineGrouping = "none";
export const BUILTIN_ARROWS = true;

/** Which layer supplied a resolved value. */
export type SettingSource = "url" | "view" | "workspace" | "builtin";

export interface Resolved<T> {
  readonly value: T;
  readonly source: SettingSource;
}

/** The inputs to the chain. `undefined` at a layer means "defer". */
export interface SettingsInput {
  readonly urlZoom?: TimelineZoom | undefined;
  readonly urlGrouping?: TimelineGrouping | undefined;
  readonly urlArrows?: boolean | undefined;
  readonly view?: SavedQuery | undefined;
  readonly workflow?: WorkflowConfig | undefined;
}

function resolve<T>(
  url: T | undefined,
  view: T | undefined,
  workspace: T | undefined,
  builtin: T,
): Resolved<T> {
  if (url !== undefined) return { value: url, source: "url" };
  if (view !== undefined) return { value: view, source: "view" };
  if (workspace !== undefined) return { value: workspace, source: "workspace" };
  return { value: builtin, source: "builtin" };
}

export function resolveZoom(input: SettingsInput): Resolved<TimelineZoom> {
  return resolve(
    input.urlZoom,
    input.view?.display?.zoom,
    input.workflow?.timeline?.default_zoom,
    BUILTIN_ZOOM,
  );
}

export function resolveGrouping(input: SettingsInput): Resolved<TimelineGrouping> {
  return resolve(
    input.urlGrouping,
    input.view?.display?.grouping,
    input.workflow?.timeline?.default_grouping,
    BUILTIN_GROUPING,
  );
}

export function resolveArrows(input: SettingsInput): Resolved<boolean> {
  return resolve(
    input.urlArrows,
    input.view?.display?.show_arrows,
    input.workflow?.timeline?.show_arrows,
    BUILTIN_ARROWS,
  );
}

/**
 * The relationship key whose links become arrows, or `undefined` when
 * no arrows should be drawn at all.
 *
 * TML-14's last bullet: "With `dependency_relationship` absent or
 * null, no arrows are drawn at all". `null` is a deliberate "arrows
 * off" (the schema allows it explicitly and distinguishes it from
 * absent), and both collapse to the same answer here.
 *
 * **The returned key may not exist in `relationships`.** Core no
 * longer auto-clears a dangling reference — it used to silently delete
 * the user's line, which erased the evidence of a typo. Resolving the
 * key against the config is therefore the *caller's* job, and
 * `dependencyRelationshipStatus` below is what does it.
 */
export function dependencyKey(workflow: WorkflowConfig | undefined): string | undefined {
  const dep = workflow?.timeline?.dependency_relationship;
  return dep === null || dep === undefined ? undefined : dep;
}

/**
 * Whether the configured dependency relationship actually resolves.
 *
 * Three outcomes, matching the three TML-14/TML-34 shapes:
 *  - `{ kind: "none" }` — not configured; no arrows, and that is
 *    correct rather than a problem.
 *  - `{ kind: "ok", key }` — resolves; draw arrows for this key.
 *  - `{ kind: "missing", key }` — configured but names a key that
 *    `relationships` does not define.
 *
 * The third is what the core fix made *possible to detect*. Rendering
 * the notice is M3.3b's (TML-34); this returns the fact and the key's
 * name so that notice has something to name.
 */
export type DependencyStatus =
  | { readonly kind: "none" }
  | { readonly kind: "ok"; readonly key: string }
  | { readonly kind: "missing"; readonly key: string };

export function dependencyRelationshipStatus(
  workflow: WorkflowConfig | undefined,
): DependencyStatus {
  const key = dependencyKey(workflow);
  if (key === undefined) return { kind: "none" };
  const defined = (workflow?.relationships ?? []).some(r => r.key === key);
  return defined ? { kind: "ok", key } : { kind: "missing", key };
}
