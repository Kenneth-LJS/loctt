import { useEffect, useRef } from "react";

import { Icon } from "../ui/Icon.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { GLOBAL_SHORTCUTS, type ShortcutSpec } from "./shortcuts.ts";

/**
 * The `?` keyboard reference (A11Y-4).
 *
 * Rendered from `GLOBAL_SHORTCUTS` — the same table `useShortcuts`
 * dispatches from. That is the whole point of the registry: A11Y-4's
 * second bullet ("a shortcut that exists but isn't listed, or listed
 * but not bound, is a defect") is only assertable if the two cannot
 * drift, and they cannot drift when there is one array.
 *
 * Chords render as separate keys with a "then" between them, because
 * `g` `l` is two keystrokes in sequence and printing `g + l` would
 * teach the user to hold them together, which does nothing.
 */
function groupsOf(shortcuts: readonly ShortcutSpec[]): { group: string; items: ShortcutSpec[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, ShortcutSpec[]>();
  for (const s of shortcuts) {
    let bucket = byGroup.get(s.group);
    if (bucket === undefined) {
      bucket = [];
      byGroup.set(s.group, bucket);
      order.push(s.group);
    }
    bucket.push(s);
  }
  return order.map(g => ({ group: g, items: byGroup.get(g) ?? [] }));
}

export function ShortcutHelpDialog({ onClose }: { readonly onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(panelRef, { initialFocus: closeRef });
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // A11Y-4's third bullet: the dialog closes on Esc. Bound here
      // rather than globally so it closes *this* layer only.
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        data-testid="shortcut-help"
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[1.0714rem] font-semibold text-text-primary">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            data-testid="shortcut-help-close"
            aria-label="Close keyboard shortcuts"
            className="shrink-0 rounded px-1 text-text-tertiary hover:text-text-primary"
          >
            <Icon name="close" />
          </button>
        </div>

        {groupsOf(GLOBAL_SHORTCUTS).map(({ group, items }) => (
          <section key={group} className="mb-4">
            <h3 className="mb-1.5 text-[0.8571rem] font-semibold uppercase tracking-wide text-text-tertiary">
              {group}
            </h3>
            <ul className="m-0 list-none p-0">
              {items.map(s => (
                <li
                  key={s.id}
                  data-testid={`shortcut-row-${s.id}`}
                  className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-1.5 last:border-b-0"
                >
                  <span className="text-[0.9286rem] text-text-primary">{s.action}</span>
                  <span className="shrink-0" data-testid={`shortcut-keys-${s.id}`}>
                    {s.keys.map((k, i) => (
                      <span key={`${k}-${String(i)}`}>
                        {i > 0 ? <span className="mx-1 text-[0.7857rem] text-text-tertiary">then</span> : null}
                        <kbd className="rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 font-mono text-[0.7857rem] text-text-primary">
                          {k}
                        </kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="m-0 text-[0.8571rem] text-text-secondary">
          {/* A11Y-43's third bullet: single-key shortcuts are
              documented as suppressed while typing, which is the
              mode-switch note the case asks for. */}
          Single-key shortcuts are ignored while a text field, editor,
          or dialog has focus, so they never shadow typing.
        </p>
      </div>
    </div>
  );
}
