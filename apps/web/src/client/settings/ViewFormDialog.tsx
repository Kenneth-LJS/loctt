import type { SavedQuery } from "@loctt/contracts";
// Per-file subpath, NOT the barrel: the barrel drags node:path/sharp into
// the browser bundle (see AdvancedQuerySurface's note, A37).
import type { BuilderTree } from "@loctt/core/query/builderTree.js";
import {
  conditionsToDsl,
  queryToConditions,
  unrenderableTreeReason,
} from "@loctt/core/query/builderTree.js";
import { useEffect, useMemo, useState } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useCreateView } from "../api/hooks/useCreateView.ts";
import { useEditView } from "../api/hooks/useEditView.ts";
import { useValidateQuery } from "../api/hooks/useValidateQuery.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { AdvancedQueryEditor } from "../list/AdvancedQueryEditor.tsx";
import {
  asGroupRoot,
  hasIncompleteLeaf,
  parseForBuilder,
  safeSerialize,
  scrubPosition,
} from "../list/AdvancedQuerySurface.tsx";
import {
  buildBuilderConfig,
  QueryBuilder,
} from "../list/QueryBuilder.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The create / rename+edit-query dialog for saved views (VUE-40,
 * VUE-41), reworked as a VISUAL query builder (Ken's ruling, Stage 2).
 *
 * ## Why this stopped being a raw DSL box
 *
 * The dialog previously rendered only the `AdvancedQueryEditor` (a raw
 * DSL textarea) for BOTH create and edit. Ken: *"i can't use filters
 * unless i go through the learning curve of your query language. NO!"* —
 * so the DEFAULT is now the visual {@link QueryBuilder}, and the raw DSL
 * is an explicit "Advanced" toggle (kept, not removed — builder-first,
 * not builder-only).
 *
 * This reuses the SAME building blocks the inline FilterBar's
 * `AdvancedQuerySurface` is assembled from — `QueryBuilder` +
 * `buildBuilderConfig` for the visual rows, `AdvancedQueryEditor` for the
 * DSL text, and the surface's exported `parseForBuilder`/`asGroupRoot`/
 * `safeSerialize`/`hasIncompleteLeaf`/`scrubPosition` helpers for the
 * refuse-on-unrenderable rule — so builder and dialog answer
 * "renderable?" and "complete?" identically (no parity drift).
 *
 * ## What Save emits
 *
 * The dialog SAVES structured `conditions` (a {@link BuilderTree}), not a
 * DSL string:
 * - Builder mode → the live builder tree.
 * - Advanced mode → the DSL is parsed with core's total
 *   {@link queryToConditions}; the save is REFUSED if it does not parse
 *   (VUE-11 "refuse, don't approximate"), and the PARSED tree is sent so
 *   the stored `conditions` and derived `query` can never disagree.
 *
 * For EDIT, the builder is seeded from the existing view's `conditions`
 * (now on `SavedQuery` post-Stage-1) — not by re-parsing its `query`
 * string. A view whose conditions the visual builder cannot render (a
 * `has_link`/`not`/date function — e.g. the seeded `blocked` view) opens
 * in Advanced mode with a note, exactly as the inline surface falls back.
 *
 * A save failure keeps the dialog open with the server's message in an
 * anchored `Callout` (SET-51), so the poison-file guard is visible.
 */
export function ViewFormDialog({
  existing,
  onClose,
}: {
  /**
   * The view being edited; omit to create a new one. Widened (Stage 2)
   * with `conditions` so edit can seed the visual builder from the stored
   * structure rather than re-parsing the derived `query` string.
   *
   * `conditions` is OPTIONAL because a BROKEN view (VUE-22's fix path)
   * has no valid conditions — its `query` did not parse, so there is no
   * tree to seed. Such an edit opens directly in Advanced (raw DSL) mode
   * on the broken `query`, which is exactly what the user needs to fix it.
   */
  readonly existing?: Pick<SavedQuery, "id" | "name" | "query"> & {
    readonly conditions?: SavedQuery["conditions"];
  };
  readonly onClose: () => void;
}) {
  const isEdit = existing !== undefined;
  const [name, setName] = useState(existing?.name ?? "");

  const create = useCreateView();
  const edit = useEditView();
  const pending = create.isPending || edit.isPending;
  const failure = create.error ?? edit.error;

  // Config sources for the builder's field catalog — the SAME hooks
  // FilterBar feeds AdvancedQuerySurface, so the dialog cannot offer a
  // value the validator would reject.
  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const milestones = useMilestones();
  const sprints = useSprints();
  const workflow = useWorkflow();

  const config = useMemo(
    () => buildBuilderConfig({
      workflow: workflow.data,
      projects: (projects.data?.items ?? []).map(p => ({ value: p.id, label: p.name })),
      users: (users.data?.items ?? []).map(u => ({ value: u.id, label: u.name ?? u.id })),
      labels: (labels.data?.items ?? []).map(l => ({ value: l.id, label: l.name })),
      milestones: (milestones.data?.items ?? []).map(m => ({ value: m.id, label: m.name })),
      sprints: (sprints.data?.items ?? []).map(s => ({ value: s.id, label: s.name })),
    }),
    [workflow.data, projects.data, users.data, labels.data, milestones.data, sprints.data],
  );

  // Seed mode + tree ONCE. For edit, the existing conditions decide: a
  // renderable tree opens the builder, an unrenderable one (has_link/not/
  // date_fn) opens Advanced text with the reason — mirroring the inline
  // surface's initial-mode rule, but sourced from the STORED tree, not a
  // re-parse of the query string.
  const [seed] = useState(() => seedFromExisting(existing));
  const [mode, setMode] = useState<"builder" | "advanced">(seed.mode);
  const [tree, setTree] = useState<BuilderTree>(seed.tree);
  // The advanced (raw DSL) draft; seeded from the derived query so both
  // modes show the same query across the toggle.
  const [draft, setDraft] = useState(seed.draft);
  // The DSL text we last emitted FROM the builder tree, if any. It lets
  // advanced→builder restore the EXACT builder state — including
  // in-progress and empty groups that don't survive a text round-trip —
  // when the user only glanced at the text and did not edit it. Reset
  // whenever the switch is not tree-derived (a manual edit invalidates it).
  const [treeSnapshot, setTreeSnapshot] = useState<
    { draft: string; tree: BuilderTree } | undefined
  >(undefined);

  const nameEmpty = name.trim().length === 0;

  const doMutate = (conditions: BuilderTree): void => {
    if (isEdit) {
      edit.mutate(
        { id: existing.id, body: { name: name.trim(), conditions } },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        { name: name.trim(), conditions },
        { onSuccess: onClose },
      );
    }
  };

  // The active mode reports its Save state up here so a SINGLE primary
  // button can live in the footer aligned with Cancel (Ken: "Save changes"
  // sat on a different level from Cancel). Each mode still owns its own
  // enable/disable rules — the builder knows "incomplete", the advanced
  // DSL knows "unparseable" — and reports whether it can save plus the
  // CONDITIONS to save. The footer performs the mutation itself, reading
  // the CURRENT `name` at click time — the body must NOT close over `name`
  // (a stale closure would save the pre-rename name). `conditions` is
  // undefined while the mode cannot save (disabled) or before the body has
  // reported (first render), which keeps the footer Save disabled.
  const [saveState, setSaveState] = useState<
    { disabled: boolean; title?: string; conditions?: BuilderTree } | undefined
  >(undefined);
  const saveLabel = isEdit ? "Save" : "Create view";

  return (
    <ResponsiveDialog
      title={isEdit ? "Edit saved view" : "New saved view"}
      onClose={onClose}
      testId={isEdit ? "view-edit-dialog" : "view-create-dialog"}
      actions={
        <DialogActions>
          <Button variant="ghost" testId="view-form-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="view-form-save"
            disabled={saveState?.disabled ?? true}
            {...(saveState?.title !== undefined ? { title: saveState.title } : {})}
            onClick={() => {
              // Read the CURRENT name here (not from a captured closure) so
              // a rename typed just before clicking Save is honoured.
              if (saveState?.disabled !== false) return;
              if (saveState.conditions === undefined) return;
              doMutate(saveState.conditions);
            }}
          >
            {pending ? "Saving…" : saveLabel}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            data-testid="view-form-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. My open bugs"
          />
        </label>

        {mode === "builder" ? (
          <BuilderBody
            tree={tree}
            onTreeChange={setTree}
            config={config}
            nameEmpty={nameEmpty}
            pending={pending}
            onSaveStateChange={setSaveState}
            onSwitchToAdvanced={() => {
              // Carry the builder's query into the DSL draft so the two
              // modes show the same thing across the toggle. safeSerialize
              // prunes empty groups so a half-built "+ Group" does not
              // blank out every completed condition (the toggle data-loss).
              const text = safeSerialize(tree);
              setDraft(text);
              // Remember the exact tree behind this text so switching back
              // restores it verbatim (incl. in-progress/empty groups the
              // text can't express) as long as the user hasn't edited it.
              setTreeSnapshot({ draft: text, tree });
              setMode("advanced");
            }}
          />
        ) : (
          <AdvancedBody
            value={draft}
            onChange={setDraft}
            nameEmpty={nameEmpty}
            pending={pending}
            refuseReason={seed.refuseReason}
            onSaveStateChange={setSaveState}
            onSwitchToBuilder={() => {
              // Only reachable when the live draft is renderable (the
              // control is disabled otherwise).
              //
              // If the text is byte-identical to what we last serialized
              // out of the builder — the user switched to text and back
              // without editing — restore that EXACT tree. Re-parsing would
              // drop any in-progress or empty group the text can't express,
              // silently losing the builder state the user was mid-way
              // through. This is the lossless happy path.
              if (treeSnapshot !== undefined && treeSnapshot.draft === draft) {
                setTree(treeSnapshot.tree);
                setMode("builder");
                return;
              }
              // The text was edited: re-parse so the builder opens on
              // exactly what the text now says — never an approximation.
              const parsed = parseForBuilder(draft);
              if (!parsed.ok) return; // defensive; button disabled here
              setTree(asGroupRoot(parsed.tree));
              setMode("builder");
            }}
          />
        )}

        {failure !== undefined && failure !== null && (
          <Callout tone="danger" role="alert" testId="view-form-error">
            <span>
              {failure instanceof Error ? failure.message : "The view could not be saved."}
              {" "}Your saved views on disk were not changed.
            </span>
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}

/**
 * Decide the initial mode/tree/draft from the view being edited (or a
 * fresh create). A renderable conditions tree opens the builder; an
 * unrenderable one opens Advanced with the reason. A create opens an
 * empty builder.
 */
function seedFromExisting(
  existing:
    | (Pick<SavedQuery, "id" | "name" | "query"> & { conditions?: SavedQuery["conditions"] })
    | undefined,
): { mode: "builder" | "advanced"; tree: BuilderTree; draft: string; refuseReason?: string } {
  const emptyTree: BuilderTree = { kind: "group", op: "and", children: [] };
  if (existing === undefined) {
    return { mode: "builder", tree: emptyTree, draft: "" };
  }
  // A BROKEN view carries a raw `query` that did not parse and no
  // `conditions` — open Advanced on that raw text so it can be fixed
  // (VUE-22). No refuse-note: this is a parse error to repair, not an
  // exotic-but-valid query the builder merely can't show.
  if (existing.conditions === undefined) {
    return { mode: "advanced", tree: emptyTree, draft: existing.query };
  }
  const conditions = existing.conditions;
  const draft = conditionsToDsl(conditions);
  const reason = unrenderableTreeReason(conditions);
  if (reason !== null) {
    return { mode: "advanced", tree: emptyTree, draft, refuseReason: reason };
  }
  return { mode: "builder", tree: asGroupRoot(conditions), draft };
}

// ── Save state (lifted to the footer) ────────────────────────────────

/**
 * What a mode body reports up so the parent can render ONE footer Save
 * aligned with Cancel. `disabled`/`title` drive the footer button;
 * `conditions` is the tree to save (present only when saveable). The
 * footer performs the mutation with the CURRENT name — the body does not
 * close over `name`, so a rename typed just before Save is honoured.
 */
interface SaveState {
  readonly disabled: boolean;
  readonly title?: string;
  readonly conditions?: BuilderTree;
}

// ── Builder body ─────────────────────────────────────────────────────

function BuilderBody({
  tree,
  onTreeChange,
  config,
  nameEmpty,
  pending,
  onSwitchToAdvanced,
  onSaveStateChange,
}: {
  readonly tree: BuilderTree;
  readonly onTreeChange: (tree: BuilderTree) => void;
  readonly config: ReturnType<typeof buildBuilderConfig>;
  readonly nameEmpty: boolean;
  readonly pending: boolean;
  readonly onSwitchToAdvanced: () => void;
  readonly onSaveStateChange: (state: SaveState) => void;
}) {
  // The live query the builder describes, routed through the SAME
  // validate surface the inline builder uses so the error UI matches.
  const liveQ = safeSerialize(tree);
  const { result, settled } = useValidateQuery(liveQ);
  const invalid = result !== null && !result.valid;
  const incomplete = hasIncompleteLeaf(tree);
  // An empty builder (no conditions) is not a saveable view.
  const empty = tree.kind === "group" && tree.children.length === 0;
  const showError = invalid && settled && !incomplete;

  const disabled = nameEmpty || pending || invalid || incomplete || empty;

  const title = empty
    ? "Add at least one condition."
    : incomplete
      ? "Finish every condition before saving."
      : invalid
        ? scrubPosition(result.message) ?? "This query is not valid."
        : undefined;

  // Report the footer Save state up whenever the inputs to it change. The
  // conditions to save are just the current tree; the footer performs the
  // mutation, reading the live name at click time.
  useEffect(() => {
    onSaveStateChange({
      disabled,
      ...(title !== undefined ? { title } : {}),
      ...(disabled ? {} : { conditions: tree }),
    });
    // `tree` and the derived flags cover every input; onSaveStateChange is
    // a stable setState, so re-reporting on each change is cheap and correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, title, tree]);

  return (
    <div data-testid="view-builder" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.9286rem] font-medium text-text-secondary">
          Filter conditions
        </span>
        <Button variant="secondary" size="sm" testId="view-switch-to-advanced" onClick={onSwitchToAdvanced}>
          Advanced (edit as text)
        </Button>
      </div>

      <QueryBuilder tree={tree} onChange={onTreeChange} config={config} />

      <div
        data-testid="view-qb-validation"
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
    </div>
  );
}

// ── Advanced (raw DSL) body ──────────────────────────────────────────

function AdvancedBody({
  value,
  onChange,
  nameEmpty,
  pending,
  refuseReason,
  onSwitchToBuilder,
  onSaveStateChange,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly nameEmpty: boolean;
  readonly pending: boolean;
  readonly refuseReason: string | undefined;
  readonly onSwitchToBuilder: () => void;
  readonly onSaveStateChange: (state: SaveState) => void;
}) {
  // Whether the CURRENT text can open the visual builder (renderable),
  // and whether it parses at all (saveable). These are different: a
  // has_link parses but is not renderable — it can still be SAVED as
  // conditions, just not shown in the builder.
  const renderable = useMemo(() => parseForBuilder(value), [value]);
  const parsed = useMemo(() => queryToConditions(value.trim()), [value]);
  const empty = value.trim().length === 0;
  // VUE-11 "refuse, don't approximate": an unparseable DSL cannot be
  // saved — we will not store a stale tree with a disagreeing string.
  const unparseable = !empty && !parsed.ok;

  const disabled = nameEmpty || pending || empty || unparseable;

  const title = empty
    ? "Enter a query to save."
    : unparseable
      ? "This query can't be saved until it parses."
      : undefined;

  // Report the footer Save state up. The conditions to save are the parsed
  // tree, available only when `parsed.ok` and not disabled — so an
  // unparseable draft reports no conditions and the footer Save stays off.
  useEffect(() => {
    onSaveStateChange({
      disabled,
      ...(title !== undefined ? { title } : {}),
      ...(!disabled && parsed.ok ? { conditions: parsed.tree } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, title, parsed]);

  return (
    <div data-testid="view-advanced" className="flex flex-col gap-2">
      {refuseReason !== undefined && (
        <p
          data-testid="view-advanced-refuse-note"
          role="status"
          className="m-0 rounded border border-border-subtle bg-bg-surface/60 px-2 py-1 text-[0.8571rem] text-text-secondary"
        >
          This query can't be shown in the visual builder: {refuseReason}. Editing as text.
        </p>
      )}

      <AdvancedQueryEditor value={value} onChange={onChange} dirty={false} />

      {unparseable && (
        <p data-testid="view-advanced-parse-error" role="alert" className="m-0 text-[0.8571rem] text-danger-fg">
          This query can't be saved until it parses.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          testId="view-switch-to-builder"
          disabled={!renderable.ok}
          {...(renderable.ok ? {} : { title: renderable.reason })}
          onClick={() => { if (renderable.ok) onSwitchToBuilder(); }}
        >
          Switch to visual
        </Button>
      </div>
    </div>
  );
}
