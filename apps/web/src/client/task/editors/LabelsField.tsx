import type { LabelDef } from "@loctt/contracts";
import { useCallback, useRef, useState } from "react";

import { Combobox, type ComboboxOption } from "../../ui/Combobox.tsx";
import { resolveForMode, useColorMode } from "../../ui/entityColor.ts";
import { Icon } from "../../ui/Icon.tsx";

/**
 * The multi-tag label editor, with inline creation (TSK-11).
 *
 * The picker itself is the shared searchable `Combobox` in multi mode
 * (A211): server-side search (K90), keyboard model and Escape handling
 * are the primitive's. What is specific to labels lives here — the pill
 * row, the "+ Label" trigger, and the create offer in the list's footer.
 *
 * ## The two-step write, and why the order matters
 *
 * Creating a label and attaching it are two endpoints:
 * `POST /api/labels` then `POST /api/tasks/:ref/set` with the full
 * `labels` array. TSK-55 (M2.2b) turns on what happens when the first
 * fails, and the ordering here is what makes that case answerable:
 * **create first, attach only on success.** Attaching optimistically
 * and creating afterwards would leave a pill on a task for a label
 * that does not exist — the phantom TSK-55 forbids — and no amount of
 * error handling downstream removes a pill that should never have been
 * drawn.
 *
 * ## Removal detaches, it does not delete
 *
 * Removing a pill sends the `labels` array without that id. Nothing
 * touches `labels.yaml`, which is what keeps the label offered on
 * other tasks (TSK-11's third bullet). This is one `set`, not a
 * `DELETE /api/labels/:id`, and the distinction is the whole bullet.
 *
 * ## 25 labels (TSK-26)
 *
 * The pill container wraps (`flex-wrap`) inside the panel's own width
 * rather than scrolling sideways, and each pill carries its own remove
 * button, so the twenty-fifth is as removable as the first. The panel
 * is what scrolls, and it is the caller that owns that.
 */
export function LabelsField({
  attached,
  all,
  onChange,
  onCreate,
  searchLabels,
  createError,
  onDismissCreateError,
}: {
  /** The task's label ids, in stored order. */
  readonly attached: readonly string[];
  /**
   * Labels needed to render the *attached* pills by name. This can be a
   * bounded set (it no longer drives the candidate list — see
   * `searchLabels`), so a label attached but outside it renders the
   * "unresolved" fallback rather than being unresolvable.
   */
  readonly all: readonly LabelDef[];
  readonly onChange: (ids: readonly string[]) => void;
  /** Creates the label, then resolves with its new id. */
  readonly onCreate: (name: string) => Promise<string | undefined>;
  /**
   * K90: server-side label search. The picker queries this as the user
   * types instead of filtering `all` in memory, so a workspace past the
   * fetch window is fully searchable AND the "offer to create" decision
   * is made against the server's answer — never a truncated array, which
   * is what let the create button offer a duplicate of an existing
   * label (NEW-7, NEW-25). Returns labels whose name contains `q`
   * (case-insensitive), archived included (this component filters those).
   */
  readonly searchLabels: (q: string) => Promise<readonly LabelDef[]>;
  readonly createError?: string | undefined;
  readonly onDismissCreateError?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  // The server's LAST answer, unfiltered — archived labels included — for
  // the "does this name already exist" check that gates the create offer.
  // The candidates the list shows are the archived-filtered subset; the
  // exact-name check must see everything the server knows, or an archived
  // "bug" would let a second "bug" be created.
  const [raw, setRaw] = useState<readonly LabelDef[]>([]);
  const seq = useRef(0);
  // K103: the option dots need one hex each, so the mode is read once
  // here and the rows are resolved through core. It is a `useCallback`
  // dependency because a theme flip has to re-map the dots — a stale
  // closure would keep painting the previous theme's halves.
  const mode = useColorMode();

  const onQuery = useCallback(async (q: string): Promise<readonly ComboboxOption[]> => {
    const mine = ++seq.current;
    const rows = await searchLabels(q);
    // A superseded query's answer must not become the exact-name basis.
    if (mine === seq.current) setRaw(rows);
    return rows
      .filter(l => l.archived !== true)
      .map(l => ({
        key: l.id,
        label: l.name,
        // An unresolvable colour falls back to the same tertiary token a
        // colourless label already used, so the dot is still drawn.
        color: resolveForMode(l.color, mode) ?? "var(--color-text-tertiary)",
      }));
  }, [searchLabels, mode]);
  const search = { onQuery, placeholder: "Find or create…" };

  const byId = new Map(all.map(l => [l.id, l]));

  const attach = (id: string): void => {
    onChange([...attached, id]);
  };

  const nameTaken = (name: string): boolean =>
    raw.some(l => l.name.toLowerCase() === name.toLowerCase());

  const create = async (name: string, close: (returnFocus: boolean) => void): Promise<void> => {
    if (name === "" || nameTaken(name) || busy) return;
    setBusy(true);
    try {
      const id = await onCreate(name);
      // Undefined means the create failed. The caller has surfaced
      // why; attaching anything here would be the phantom pill.
      if (id !== undefined) {
        attach(id);
        close(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Combobox
        mode="multi"
        label="Labels"
        options={[]}
        selected={attached}
        hideSelected
        // `+ Label` is a toggle, so a picker left open turns the next click
        // into a close; attaching two labels in a row would then take
        // three clicks and look broken on the second. Close after each
        // pick, focus back on the trigger (TSK-41, P8).
        closeOnSelect
        onToggle={(id, on) => { if (on) attach(id); }}
        search={search}
        searchLabel="Find or create a label"
        searchTestId="meta-label-input"
        listTestId="meta-label-options"
        align="end"
        panelClassName="w-[220px] min-w-0"
        // The create offer is gated on the SERVER's answer, never a
        // truncated array. Case-insensitive, because "Bug" and "bug" are
        // the same label to a user. Until the answer is in we cannot prove
        // the name is free, so the offer stays suppressed (this is what
        // stops the duplicate-create hazard NEW-7/NEW-25 name).
        noMatchesText={q => (q !== "" && !nameTaken(q))
          ? null
          : (q === "" ? "Every label is attached." : "Already attached.")}
        footer={({ query, loaded, close }) =>
          query !== "" && loaded && !nameTaken(query) ? (
            <button
              type="button"
              data-testid="meta-create-label"
              disabled={busy}
              onClick={() => { void create(query, close); }}
              className="w-full px-3 py-1.5 text-left text-body text-text-primary hover:bg-bg-muted disabled:opacity-60"
            >
              Create label “{query}”
            </button>
          ) : null}
        // Enter with nothing to pick creates (the old "Enter attaches the
        // first match, else creates" — the first match is the active
        // option now, so Enter picks it before this is reached).
        onSubmitQuery={(q, close) => { void create(q, close); }}
        trigger={({ ref, toggle, ...aria }) => (
          <div data-testid="meta-labels" className="flex flex-wrap gap-1">
            {attached.map(id => {
              const def = byId.get(id);
              return (
                <span
                  key={id}
                  data-testid="label-pill"
                  className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.7857rem]"
                  style={pillStyle(resolveForMode(def?.color, mode))}
                >
                  <span className="truncate">
                    {def?.name ?? "unresolved, not in the current config"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove label ${def?.name ?? id}`}
                    onClick={() => { onChange(attached.filter(x => x !== id)); }}
                    // #15 (WCAG 2.5.8): the ✕ glyph stays 12px but the hit
                    // target is ≥24px — a grid-centred min-h/min-w square
                    // with the negative margin keeping the pill compact so
                    // the larger target does not inflate the chip's height.
                    className="-my-1 -mr-1 grid min-h-6 min-w-6 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              );
            })}
            <button
              ref={ref}
              type="button"
              data-testid="meta-add-label"
              aria-label="Add a label"
              {...aria}
              onClick={toggle}
              className="rounded-full border border-dashed border-border-subtle px-2 py-0.5 text-[0.7857rem] text-text-tertiary hover:text-text-primary"
            >
              + Label
            </button>
          </div>
        )}
      />

      {createError !== undefined && (
        <p role="alert" data-testid="meta-label-error" className="mt-1 text-[0.7857rem] text-danger-fg">
          {createError}
          {onDismissCreateError !== undefined && (
            <button type="button" onClick={onDismissCreateError} className="ml-1 underline">
              Dismiss
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * A pill tinted with the label's configured colour (TSK-11's first
 * bullet), falling back to the neutral surface when `labels.yaml`
 * declares none.
 *
 * The tint is the colour at low alpha with the colour as the text,
 * rather than the colour as a solid background — a solid arbitrary hex
 * from user config has no readable foreground the app can pick, in
 * either theme. Colour-mix keeps the pill legible whatever the user
 * chose without the app hardcoding a contrast decision, which is the
 * P3 trap: a hardcoded colour map is a violation, and so is silently
 * overriding the one the user configured.
 */
function pillStyle(color: string | undefined): React.CSSProperties {
  if (color === undefined) {
    return {
      backgroundColor: "var(--color-bg-muted)",
      color: "var(--color-text-secondary)",
    };
  }
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
    color,
  };
}
