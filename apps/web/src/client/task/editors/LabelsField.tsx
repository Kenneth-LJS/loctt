import type { LabelDef } from "@loctt/contracts";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";

/**
 * The multi-tag label editor, with inline creation (TSK-11).
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // K90: server search results for the current (debounced) query. `null`
  // means "not yet loaded for this query" — distinct from an empty array,
  // which is a real "no matches" and is what gates the create offer.
  const [results, setResults] = useState<readonly LabelDef[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // K90: debounce the query and fetch matches from the server. A blank
  // query still fetches (the initial "browse" view shows the first page
  // of labels). `searchLabels` is called with the trimmed query; the
  // response replaces `results` unless a newer query superseded it.
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setResults(null);
    const t = setTimeout(() => {
      void searchLabels(trimmedQuery).then(rows => {
        if (!cancelled) setResults(rows);
      }).catch(() => {
        // A failed search leaves `results` null → no candidates, and the
        // create offer stays suppressed (we cannot prove the name is
        // free), which is the safe direction.
        if (!cancelled) setResults([]);
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, trimmedQuery, searchLabels]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        setQuery("");
        addRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current?.contains(e.target as Node) !== true) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const byId = new Map(all.map(l => [l.id, l]));
  const attachedSet = new Set(attached);
  const trimmed = trimmedQuery;
  // Candidates come from the SERVER (K90), not a filtered `all`: archived
  // and already-attached labels are dropped here. `results === null`
  // (still loading) shows no candidates yet.
  const candidates = (results ?? []).filter(
    l => !attachedSet.has(l.id) && l.archived !== true,
  );
  // The create offer is gated on the SERVER's answer, never a truncated
  // array. Case-insensitive, because "Bug" and "bug" are the same label
  // to a user. `results === null` means we have not heard back yet, so
  // we cannot prove the name is free — suppress the offer until we know
  // (this is what stops the duplicate-create hazard NEW-7/NEW-25 name:
  // a name whose match fell outside the old 1000-item window).
  const exact =
    results !== null && results.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed !== "" && results !== null && !exact;

  /**
   * Attaches one label and closes the picker.
   *
   * Closing is not cosmetic: `+ Label` is a *toggle*, so a picker left
   * open turns the user's next click on it into a close rather than an
   * open. Attaching two labels in a row then takes three clicks and
   * looks broken on the second.
   *
   * Focus goes back to the trigger for the same reason Escape returns
   * it (TSK-41, P8): the panel that had focus is gone, and dropping it
   * on the body strands a keyboard user.
   */
  const attach = (id: string): void => {
    onChange([...attached, id]);
    setQuery("");
    setOpen(false);
    addRef.current?.focus();
  };

  const create = async (): Promise<void> => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const id = await onCreate(trimmed);
      // Undefined means the create failed. The caller has surfaced
      // why; attaching anything here would be the phantom pill.
      if (id !== undefined) attach(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div data-testid="meta-labels" className="flex flex-wrap gap-1">
        {attached.map(id => {
          const def = byId.get(id);
          return (
            <span
              key={id}
              data-testid="label-pill"
              className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.7857rem]"
              style={pillStyle(def?.color)}
            >
              <span className="truncate">
                {def?.name ?? "unresolved — not in the current config"}
              </span>
              <button
                type="button"
                aria-label={`Remove label ${def?.name ?? id}`}
                onClick={() => { onChange(attached.filter(x => x !== id)); }}
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          );
        })}
        <button
          ref={addRef}
          type="button"
          data-testid="meta-add-label"
          aria-label="Add a label"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => { setOpen(o => !o); }}
          className="rounded-full border border-dashed border-border-subtle px-2 py-0.5 text-[0.7857rem] text-text-tertiary hover:text-text-primary"
        >
          + Label
        </button>
      </div>

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

      {open && (
        <div
          role="listbox"
          aria-label="Labels"
          data-testid="meta-label-options"
          className="absolute right-0 z-20 mt-1 max-h-64 w-[220px] overflow-auto rounded-md border border-border-subtle bg-bg-surface p-1 shadow-lg"
        >
          <input
            ref={inputRef}
            type="text"
            aria-label="Find or create a label"
            data-testid="meta-label-input"
            value={query}
            onChange={e => { setQuery(e.target.value); }}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = candidates[0];
              if (first !== undefined) attach(first.id);
              else void create();
            }}
            placeholder="Find or create…"
            className="mb-1 w-full rounded border border-border-subtle bg-bg-canvas px-1.5 py-1 text-[0.8571rem] text-text-primary"
          />
          {candidates.map(l => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { attach(l.id); }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[0.8571rem] text-text-primary hover:bg-bg-muted"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: l.color ?? "var(--color-text-tertiary)" }}
              />
              <span className="truncate">{l.name}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              data-testid="meta-create-label"
              disabled={busy}
              onClick={() => { void create(); }}
              className="w-full rounded px-2 py-1 text-left text-[0.8571rem] text-text-primary hover:bg-bg-muted disabled:opacity-60"
            >
              Create label “{trimmed}”
            </button>
          )}
          {results === null && (
            <p className="px-2 py-1 text-[0.8571rem] text-text-tertiary">Searching…</p>
          )}
          {results !== null && candidates.length === 0 && !canCreate && (
            <p className="px-2 py-1 text-[0.8571rem] text-text-tertiary">
              {trimmed === "" ? "Every label is attached." : "Already attached."}
            </p>
          )}
        </div>
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
