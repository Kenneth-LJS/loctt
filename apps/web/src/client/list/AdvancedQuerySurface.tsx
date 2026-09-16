import type { WorkflowConfig } from "@loctt/contracts";
// Per-file subpath, NOT the barrel: the barrel drags node:path/sharp into
// the browser bundle (see dslToSearch.ts's parser.js import note, A37).
import type { BuilderTree } from "@loctt/core/query/builderTree.js";
import {
  builderTreeToQuery,
  queryToBuilderTree,
} from "@loctt/core/query/builderTree.js";
import { useMemo, useState } from "react";

import { useValidateQuery } from "../api/hooks/useValidateQuery.ts";
import { AdvancedQueryEditor } from "./AdvancedQueryEditor.tsx";
import {
  buildBuilderConfig,
  QueryBuilder,
  type ValueOption,
} from "./QueryBuilder.tsx";

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
    () => buildBuilderConfig({ workflow, projects, users, labels, milestones, sprints }),
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

  if (mode === "builder") {
    return (
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
    );
  }

  return (
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
function parseForBuilder(
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
function asGroupRoot(tree: BuilderTree): BuilderTree {
  return tree.kind === "group" ? tree : { kind: "group", op: "and", children: [tree] };
}

/** builderTreeToQuery throws on an empty group; the empty builder is "". */
function safeSerialize(tree: BuilderTree): string {
  try {
    return builderTreeToQuery(tree);
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

  return (
    <div data-testid="advanced-query-surface" data-mode="builder" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.9286rem] font-medium text-text-secondary">
          Query builder
        </span>
        <button
          type="button"
          data-testid="switch-to-text"
          onClick={onSwitchToText}
          className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] text-text-secondary"
        >
          Switch to text
        </button>
      </div>

      <QueryBuilder tree={tree} onChange={onTreeChange} config={config} />

      {/* Shared validation surface: the same classifier the text editor
          renders, so builder and text agree on what "invalid" means. */}
      <div
        data-testid="qb-validation"
        data-error-kind={invalid ? result.kind ?? "syntax" : "none"}
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem]"
      >
        {invalid && settled && (
          <p className="m-0 text-[0.8571rem] text-danger-fg">
            {result.message ?? "This query is not valid."}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="qb-apply"
          onClick={() => { onApply(liveQ); }}
          className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] text-text-primary"
        >
          Apply
        </button>
        <button
          type="button"
          data-testid="qb-close"
          onClick={onClose}
          className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] text-text-secondary"
        >
          Close
        </button>
      </div>
    </div>
  );
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
        <button
          type="button"
          data-testid="switch-to-visual"
          disabled={!renderable.ok}
          title={renderable.ok ? undefined : renderable.reason}
          onClick={() => { if (renderable.ok) onSwitchToVisual(); }}
          className="rounded border border-border-subtle px-2 py-1 text-[0.8571rem] disabled:opacity-50"
        >
          Switch to visual
        </button>
        {!renderable.ok && (
          <span data-testid="switch-to-visual-reason" className="text-[0.8571rem] text-text-tertiary">
            The visual builder cannot show this query: {renderable.reason}.
          </span>
        )}
      </div>
    </div>
  );
}
