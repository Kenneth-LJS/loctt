import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { groupsOf, ShortcutKeys } from "./ShortcutKeys.tsx";
import { ShortcutSettingsEditor } from "./ShortcutSettingsEditor.tsx";
import { useKeyboardShortcutSettings } from "./useKeyboardShortcutSettings.ts";

/**
 * The `?` keyboard reference (A11Y-4), with its in-dialog settings view
 * (K133).
 *
 * Rendered from `GLOBAL_SHORTCUTS` — the same table `useShortcuts`
 * dispatches from — so the list and the bindings cannot drift.
 *
 * ## Two views
 *
 * - **The list**: every shortcut with its keys. A shortcut switched off
 *   on its own shows a muted "Off". With the master switch off, every
 *   row is disabled and a notice at the top says so, with a "Turn on"
 *   button right there (K133: "should show all the shortcuts but
 *   disabled and a message that says about re-enabling it").
 * - **Customize**: the same `ShortcutSettingsEditor` Settings → Keyboard
 *   renders, with "Done" back to the list.
 *
 * Opened by `?` or from the user menu's "Keyboard shortcuts" item, which
 * is how a user reaches it with `?` itself switched off.
 */
export function ShortcutHelpDialog({ onClose }: { readonly onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"list" | "customize">("list");
  const { state, change } = useKeyboardShortcutSettings();
  useFocusTrap(panelRef, { initialFocus: closeRef });
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // A dialog opened from inside this one (the Reset confirm) owns
      // Esc while it is open. Both listen on `document`, so without
      // this one Esc would close the confirm and this dialog together.
      if (panelRef.current?.querySelector('[role="dialog"]') !== null) return;
      // A11Y-4's third bullet: the dialog closes on Esc.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const switchView = (next: "list" | "customize"): void => {
    setView(next);
    // The button that was pressed unmounts with its view. Land focus on
    // the close button, which is in both, rather than on `body`.
    closeRef.current?.focus();
  };

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
        data-view={view}
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[1.0714rem] font-semibold text-text-primary">Keyboard shortcuts</h2>
          <div className="flex shrink-0 items-center gap-2">
            {view === "list" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { switchView("customize"); }}
                testId="shortcut-help-customize"
              >
                Customize
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { switchView("list"); }}
                testId="shortcut-help-done"
              >
                Done
              </Button>
            )}
            <IconButton
              ref={closeRef}
              onClick={onClose}
              testId="shortcut-help-close"
              aria-label="Close keyboard shortcuts"
            >
              <Icon name="close" />
            </IconButton>
          </div>
        </div>

        {view === "customize" ? (
          <ShortcutSettingsEditor testIdPrefix="shortcut-help-settings" />
        ) : (
          <>
            {!state.singleKey ? (
              <div
                role="status"
                data-testid="shortcut-help-off-notice"
                className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-muted px-3 py-2"
              >
                <span className="text-[0.9286rem] text-text-primary">Single-key shortcuts are off.</span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => { change({ singleKey: true }); }}
                  testId="shortcut-help-turn-on"
                >
                  Turn on
                </Button>
              </div>
            ) : null}

            {groupsOf(state.shortcuts).map(({ group, items }) => (
              <section key={group} className="mb-4">
                <h3 className="mb-1.5 text-[0.8571rem] font-semibold uppercase tracking-wide text-text-tertiary">
                  {group}
                </h3>
                <ul className="m-0 list-none p-0">
                  {items.map(s => (
                    <li
                      key={s.id}
                      data-testid={`shortcut-row-${s.id}`}
                      data-active={s.active ? "true" : "false"}
                      aria-disabled={s.active ? undefined : "true"}
                      className={[
                        "flex items-baseline justify-between gap-4 border-b border-border-subtle py-1.5 last:border-b-0",
                        s.active ? "" : "opacity-60",
                      ].join(" ")}
                    >
                      <span className="text-[0.9286rem] text-text-primary">
                        {s.action}
                        {state.singleKey && !s.on ? (
                          <span
                            data-testid={`shortcut-off-${s.id}`}
                            className="ml-2 text-[0.7857rem] text-text-tertiary"
                          >
                            Off
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0">
                        <ShortcutKeys spec={s} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {/* CONFIG-5 / P4: the fuller reference, which also covers the
                context-scoped keys, lives in Settings → Keyboard. Closes
                the dialog on the way. */}
            <p className="mt-3 text-[0.8571rem] text-text-secondary">
              <Link
                to="/settings/$section"
                params={{ section: "keyboard" }}
                onClick={onClose}
                data-testid="shortcut-help-keyboard-link"
                className="text-accent underline hover:text-text-primary"
              >
                Full reference in Settings → Keyboard
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
