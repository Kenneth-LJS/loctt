import type { WorkflowConfig } from "@loctt/contracts";
import { useMemo, useState } from "react";

import {
  searchLabels,
  searchMilestones,
  searchProjects,
  searchSprints,
  searchUsers,
} from "../api/hooks/sidebarData.ts";
import { useValidateQuery } from "../api/hooks/useValidateQuery.ts";
import { Button } from "../ui/Button.tsx";
import { AdvancedQueryEditor } from "./AdvancedQueryEditor.tsx";
// The builder's editing model. It was `@loctt/core/query/builderTree.js`
// until K102 removed the saved-view storage that shared the type; it is
// web-client-local now, because this surface edits the URL `q` and was
// never coupled to how a view is stored. See builderTree.ts's header.
import type { BuilderTree } from "./builderTree.ts";
import { builderTreeToQuery, queryToBuilderTree } from "./builderTree.ts";
import {
  buildBuilderConfig,
  QueryBuilder,
  type ValueOption,
} from "./QueryBuilder.tsx";

/**
 * K90 parity: the builder's entity value pickers search the server as the
 * user types, exactly as the task-meta pickers and the filter facets do,
 * rather than filtering the capped sidebar-fetch seed lists in memory
 * (A211). These adapters map each entity's server-search result to the
 * builder's `{ value, label }` option shape, carrying an archived entity's
 * disabled+suffix so it stays visible-but-unselectable — the same rule the
 * MetaPanel option mappers apply.
 *
 * The search functions are module-level constants (stable identity), so
 * this object is built once and never re-triggers the config `useMemo`.
 */
const named = (
  e: { readonly id: string; readonly name: string; readonly archived?: boolean | undefined },
): ValueOption => ({
  value: e.id,
  label: e.name,
  ...(e.archived === true ? { disabled: true, suffix: "(archived)" } : {}),
});

const BUILDER_ENTITY_SEARCH = {
  projects: (q: string) => searchProjects(q).then(rows => rows.map(named)),
  users: (q: string) =>
    searchUsers(q).then(rows =>
      rows.map(u => ({
        value: u.id,
        // A corrupt/absent profile name degrades to the id (O5), never blank.
        label: u.name ?? u.id,
        ...(u.archived === true ? { disabled: true, suffix: "(archived)" } : {}),
      })),
    ),
  labels: (q: string) => searchLabels(q).then(rows => rows.map(named)),
  milestones: (q: string) => searchMilestones(q).then(rows => rows.map(named)),
  sprints: (q: string) => searchSprints(q).then(rows => rows.map(named)),
} as const;

/**
 * The Advanced surface (K83, step 3) — the mode-switching shell around
 * the visual {@link QueryBuilder} and the text {@link AdvancedQueryEditor}.
 *
 * ## The three requirements this wraps
 *
 * - **(i) Refuse-on-unrenderable.** When the current `q` cannot be
 *   represented by the builder — a `not`, `has_link`, `link_count`, a
 *   date function, or a parse error — `queryToBuilderTree` returns
 *   `{ ok:false, reason }` and we open the TEXT box, never a visual
 *   builder that would silently misrepresent the query. A one-line note
 *   states the reason. The "Switch to visual" control is shown but
 *   DISABLED-WITH-REASON while the live text is unrenderable, mirroring
 *   AdvancedQueryEditor's own VUE-11 "Switch to basic" disabled+title
 *   pattern.
 * - **(ii) Coexist with chips.** This surface edits ONLY the `q` param.
 *   `onApply` writes `q` and nothing else, so the facet chip params
 *   (status=, labels=, …) that FilterBar owns are left untouched and
 *   compose with `q` as intersection in the URL (LST-40). An empty
 *   builder (no conditions) clears `q` — LST-41 parity — by applying an
 *   empty string.
 * - **(iii) NOT deferred.** A `q` with `not` is unrenderable, so it
 *   falls to the text box via (i); no separate handling is needed.
 *
 * ## Why the mode is local, seeded once from the incoming `q`
 *
 * FilterBar decides only *whether* the Advanced surface is open; this
 * component decides *which mode* to open it in and lets the user switch.
 * The initial mode is computed from the incoming `q` at mount — a
 * renderable `q` opens the builder, an unrenderable one the text box —
 * and thereafter the user drives it with the switch controls. The
 * builder's tree is local state too: the parent owns the URL `q`, but a
 * mid-edit tree that has not been applied yet is this surface's concern,
 * exactly as the text editor's `draft` is FilterBar's.
 */

/** The option sources the builder's field catalog is assembled from. */
export interface AdvancedQuerySurfaceProps {
  /** The current URL `q` (empty string when none). */
  readonly query: string;
  /** The in-progress text draft (FilterBar owns it, as it does today). */
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  /**
   * Apply a query to the URL. Writes ONLY `q` — the caller leaves the
   * facet params alone. An empty string clears `q` (LST-41).
   */
  readonly onApply: (q: string) => void;
  /** Switch back to the chip bar, reconstructing basic filters (VUE-11). */
  readonly onSwitchToBasic: (search: Record<string, unknown>) => void;
  /** Close the Advanced surface (Esc / explicit). */
  readonly onClose: () => void;

  // Config sources — the SAME ones FilterBar's buildFacetOptions reads.
  readonly workflow: WorkflowConfig | undefined;
  readonly projects: readonly ValueOption[];
  readonly users: readonly ValueOption[];
  readonly labels: readonly ValueOption[];
  readonly milestones: readonly ValueOption[];
  readonly sprints: readonly ValueOption[];
}

type Mode = "builder" | "text";

export function AdvancedQuerySurface({
  query,
  draft,
  onDraftChange,
  onApply,
  onSwitchToBasic,
  onClose,
  workflow,
  projects,
  users,
  labels,
  milestones,
  sprints,
}: AdvancedQuerySurfaceProps) {
  const config = useMemo(
    () =>
      buildBuilderConfig({
        workflow, projects, users, labels, milestones, sprints,
        search: BUILDER_ENTITY_SEARCH,
      }),
    [workflow, projects, users, labels, milestones, sprints],
  );

  // Seed the mode and the tree ONCE from the incoming `q`. Refuse to open
  // the visual builder on an unrenderable query (K83-i): the initial parse
  // decides which mode we land in. A query that renders → the builder; one
  // that does not → the text box (with the reason, per (i)).
  //
  // An EMPTY `q` is the one exception, and it is a mode call, not a
  // parse-error call: an empty string does not parse, but "no query yet"
  // is not something to refuse over. It opens the TEXT box (so the
  // existing "open Advanced, type a query, run it" path — VUE-8 — is
  // unchanged) but WITHOUT a refuse note, and with "Switch to visual"
  // enabled so the empty builder is one click away.
  const [initial] = useState(() => queryToBuilderTree(query));
  const isEmpty = query.trim().length === 0;
  const [mode, setMode] = useState<Mode>(initial.ok ? "builder" : "text");
  const [tree, setTree] = useState<BuilderTree>(() =>
    initial.ok ? asGroupRoot(initial.tree) : { kind: "group", op: "and", children: [] },
  );

  // A right-sized panel (Ken's review, problem #3): a bordered card that
  // fills the available content width (`w-full`, `min-w-0` so the builder's
  // flex children wrap rather than forcing one word per line at narrow
  // widths) instead of a too-tall textarea floating in dead space. Both
  // modes render inside it.
  return (
    <div
      data-testid="advanced-query-panel"
      className="w-full min-w-0 rounded-lg border border-border-default bg-bg-surface p-4"
    >
      {mode === "builder" ? (
        <BuilderMode
          tree={tree}
          onTreeChange={setTree}
          config={config}
          onApply={onApply}
          onSwitchToText={() => {
            // Carry the builder's current q into the text draft so the two
            // modes show the same query across the switch, then edit as text.
            onDraftChange(safeSerialize(tree));
            setMode("text");
          }}
          onClose={onClose}
        />
      ) : (
        <TextMode
          value={draft}
          onChange={onDraftChange}
          onApply={onApply}
          onSwitchToBasic={onSwitchToBasic}
          onSwitchToVisual={() => {
            // Only reachable when the live text IS renderable (the control is
            // disabled otherwise). Re-parse the draft so the visual builder
            // opens on exactly what the text says — never an approximation.
            const parsed = parseForBuilder(draft);
            if (!parsed.ok) return; // defensive; the button is disabled here
            setTree(asGroupRoot(parsed.tree));
            setMode("builder");
          }}
          // The refuse note only appears when we LANDED in text because the
          // incoming query was unrenderable — not when the user chose text,
          // and NOT for an empty query (which is "no query yet", not an error).
          refuseReason={!initial.ok && !isEmpty ? initial.reason : undefined}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/**
 * The renderability verdict the surface acts on. An empty/whitespace `q`
 * is NOT a parse error to refuse over — it is "no query yet", which opens
 * the empty visual builder. Every other string goes to core's
 * `queryToBuilderTree`, so a `not`/`has_link`/`link_count`/`date_fn`/parse
 * error still refuses (K83-i). Used for the initial mode seed AND the
 * "Switch to visual" enablement, so both answer renderability identically.
 */
export function parseForBuilder(
  q: string,
): { ok: true; tree: BuilderTree } | { ok: false; reason: string } {
  if (q.trim().length === 0) {
    return { ok: true, tree: { kind: "group", op: "and", children: [] } };
  }
  return queryToBuilderTree(q);
}

/**
 * Guarantees a GROUP at the root of the builder's editable tree. A single
 * comparison parses to a bare `leaf`, and the builder's edit paths reach
 * into a group's children — a bare leaf root has no child slot to remove
 * or add beside, so removing the sole condition would no-op (LST-41) and
 * "+ Condition" would not attach. Wrapping a leaf in a one-child AND group
 * gives the same query (a single-child group serializes as just its child,
 * per builderTreeToQuery) with an editable structure. A group root passes
 * through unchanged.
 */
export function asGroupRoot(tree: BuilderTree): BuilderTree {
  return tree.kind === "group" ? tree : { kind: "group", op: "and", children: [tree] };
}

/**
 * Drops empty groups (a group with no children, recursively) from the
 * tree. An empty group carries no query meaning — `builderTreeToQuery`
 * throws on one — but a user mid-build routinely has one: "+ Group" adds
 * an empty group they have not filled yet. Left in place it makes the
 * WHOLE tree unserializable, so {@link safeSerialize} would swallow the
 * throw and return `""`, silently discarding every OTHER (completed)
 * condition alongside it (the text/visual toggle data-loss, A-toggle).
 * Pruning first lets the completed conditions survive serialization; the
 * dropped empty group held nothing, so nothing is lost.
 *
 * This edits ONLY the derived text — the live builder tree is untouched,
 * so an empty group the user is still building stays visible in the
 * builder and survives a round-trip when the tree itself is preserved.
 */
export function pruneEmptyGroups(tree: BuilderTree): BuilderTree {
  if (tree.kind !== "group") return tree;
  const children = tree.children
    .map(pruneEmptyGroups)
    .filter(c => !(c.kind === "group" && c.children.length === 0));
  return { ...tree, children };
}

/**
 * Serializes a builder tree to its DSL text, tolerating the in-progress
 * shapes the builder produces mid-edit. `builderTreeToQuery` throws on an
 * empty group; the empty builder is `""`, and an empty group nested beside
 * real conditions is pruned first ({@link pruneEmptyGroups}) so those
 * conditions are NOT lost when the query is shown as text.
 */
export function safeSerialize(tree: BuilderTree): string {
  try {
    return builderTreeToQuery(pruneEmptyGroups(tree));
  } catch {
    return "";
  }
}

// ── Builder mode ─────────────────────────────────────────────────────

function BuilderMode({
  tree,
  onTreeChange,
  config,
  onApply,
  onSwitchToText,
  onClose,
}: {
  readonly tree: BuilderTree;
  readonly onTreeChange: (tree: BuilderTree) => void;
  readonly config: ReturnType<typeof buildBuilderConfig>;
  readonly onApply: (q: string) => void;
  readonly onSwitchToText: () => void;
  readonly onClose: () => void;
}) {
  // The live q the builder currently describes. An empty builder yields
  // "" (LST-41 clears q on apply). Route it through the SAME validate
  // surface the text path uses, so an invalid in-progress state (e.g. a
  // free-text `~` value) surfaces the same error UI, not a private one.
  const liveQ = safeSerialize(tree);
  const { result, settled } = useValidateQuery(liveQ);
  const invalid = result !== null && !result.valid;

  // Ken's toolbar review, problem #4: the builder must NOT leak a premature
  // parse error. Adding a condition seeds an empty value (e.g. `status =
  // ""`), which the validator rejects as "unknown status value ''" the
  // instant the row appears — before the user has picked anything. So the
  // error BANNER is suppressed while any condition is still incomplete (an
  // empty/blank value on a non-presence op); Apply stays disabled either
  // way, so an incomplete or truly-invalid query still cannot be written,
  // but the user is not scolded for a value they have not yet supplied.
  // A settled *and complete* invalid query (a real error, e.g. a bad
  // free-text value) still surfaces.
  const incomplete = hasIncompleteLeaf(tree);
  const showError = invalid && settled && !incomplete;

  return (
    <div data-testid="advanced-query-surface" data-mode="builder" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.9286rem] font-medium text-text-secondary">
          Query builder
        </span>
        <Button
          variant="secondary"
          testId="switch-to-text"
          onClick={onSwitchToText}
        >
          Edit as text
        </Button>
      </div>

      <QueryBuilder tree={tree} onChange={onTreeChange} config={config} />

      {/* Shared validation surface: the same classifier the text editor
          renders, so builder and text agree on what "invalid" means. The
          message is scrubbed of any token/position tail so the builder UI
          never leaks parser coordinates (problem #4). */}
      <div
        data-testid="qb-validation"
        data-error-kind={showError ? result.kind ?? "syntax" : "none"}
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem]"
      >
        {showError && (
          <p className="m-0 text-[0.8571rem] text-danger-fg">
            {scrubPosition(result.message) ?? "This query is not valid."}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
        <Button
          variant="primary"
          testId="qb-apply"
          // F5: an invalid live query must not be applicable — applying it
          // would write a `q` the list then rejects. `invalid` reflects the
          // last settled validation; an empty builder (liveQ = "") is not
          // "invalid" (it clears q, LST-41), so Apply stays enabled for it.
          // An incomplete builder is not yet applicable either.
          disabled={invalid || incomplete}
          {...(incomplete
            ? { title: "Finish every condition before applying." }
            : invalid
              ? { title: scrubPosition(result.message) ?? "This query is not valid." }
              : {})}
          onClick={() => { if (!invalid && !incomplete) onApply(liveQ); }}
        >
          Apply
        </Button>
        <Button variant="secondary" testId="qb-close" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * True when the tree has any leaf whose value is still blank on an op that
 * requires one — a condition the user has added but not finished. Presence
 * ops (`is empty`/`is not empty`) carry no value and are always complete;
 * a list op is incomplete while its list is empty.
 */
export function hasIncompleteLeaf(tree: BuilderTree): boolean {
  if (tree.kind === "group") return tree.children.some(hasIncompleteLeaf);
  // `not`/`has_link` are stored-conditions node kinds the visual builder
  // never produces (queryToBuilderTree refuses them), so they cannot be
  // "incomplete" here — only a `leaf` carries an editable value.
  if (tree.kind !== "leaf") return false;
  const v = tree.value;
  switch (v.type) {
    case "empty":
      return false; // presence op, no value needed
    case "list":
      return v.values.length === 0;
    case "string":
    case "date":
      return v.value.trim().length === 0;
    default:
      // number/boolean/today/current_user always carry a concrete value.
      return false;
  }
}

/**
 * Strips a trailing "at position N" / "at character N" tail from a
 * validation message so the builder UI never shows token coordinates
 * (problem #4: "never leak token positions into the builder UI"). The
 * text editor keeps the caret + position, which makes sense over raw DSL;
 * the visual builder has no text offset to point at.
 */
export function scrubPosition(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return message.replace(/\s*at (?:position|character)\s+\d+\.?/gi, "").trim();
}

// ── Text mode ────────────────────────────────────────────────────────

function TextMode({
  value,
  onChange,
  onApply,
  onSwitchToBasic,
  onSwitchToVisual,
  refuseReason,
  onClose,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onApply: (q: string) => void;
  readonly onSwitchToBasic: (search: Record<string, unknown>) => void;
  readonly onSwitchToVisual: () => void;
  readonly refuseReason: string | undefined;
  readonly onClose: () => void;
}) {
  // Whether the CURRENT text can open the visual builder. The control
  // mirrors AdvancedQueryEditor's VUE-11 "Switch to basic": shown, but
  // disabled with the reason in its title, never silently rewriting the
  // query to fit. An empty box is renderable (an empty builder).
  const renderable = useMemo(() => parseForBuilder(value), [value]);

  return (
    <div data-testid="advanced-query-surface" data-mode="text" className="flex flex-col gap-2">
      {refuseReason !== undefined && (
        <p
          data-testid="advanced-refuse-note"
          role="status"
          className="m-0 rounded border border-border-subtle bg-bg-surface/60 px-2 py-1 text-[0.8571rem] text-text-secondary"
        >
          This query can't be shown in the visual builder: {refuseReason}. Editing as text.
        </p>
      )}

      <AdvancedQueryEditor
        value={value}
        onChange={onChange}
        onRun={() => { onApply(value); }}
        onSwitchToBasic={onSwitchToBasic}
        onClose={onClose}
        dirty={false}
      />

      {/* K83-i: the "Switch to visual" escape hatch, disabled-with-reason
          whenever the live text is not renderable — the visual builder
          must never open on a query it would misrepresent. */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          testId="switch-to-visual"
          disabled={!renderable.ok}
          {...(renderable.ok ? {} : { title: renderable.reason })}
          onClick={() => { if (renderable.ok) onSwitchToVisual(); }}
        >
          Switch to visual
        </Button>
        {!renderable.ok && (
          <span data-testid="switch-to-visual-reason" className="text-[0.8571rem] text-text-tertiary">
            The visual builder cannot show this query: {renderable.reason}.
          </span>
        )}
      </div>
    </div>
  );
}
