/**
 * Settings → Personal → Keyboard (C.10.22).
 *
 * A reference, not a rebinding editor: nothing in the app reads a
 * user-defined keymap, and offering one that changed nothing would be
 * a control that lies (P4).
 *
 * **Every row here was read off a handler in the source.** The
 * temptation with a shortcut sheet is to write the shortcuts the app
 * *ought* to have — a reference that documents an unbuilt `n` is worse
 * than no reference, because the user presses it, nothing happens, and
 * they cannot tell a broken build from a wrong doc. Shortcuts that are
 * specified but not yet wired (A11Y-1's `n`, for one) are deliberately
 * absent rather than listed as pending.
 */

interface Shortcut {
  readonly keys: readonly string[];
  readonly action: string;
  /** Where it applies — the reference is useless without scope. */
  readonly scope: string;
}

const SHORTCUTS: readonly { group: string; items: readonly Shortcut[] }[] = [
  {
    group: "Navigation",
    items: [
      // apps/web/src/client/shell/useSidebarCollapse.ts:76
      { keys: ["["], action: "Collapse or expand the sidebar", scope: "Anywhere outside a text field" },
    ],
  },
  {
    group: "Board",
    items: [
      // apps/web/src/client/board/BoardCard.tsx:100-113 (BRD-38)
      {
        keys: ["Ctrl", "←"],
        action: "Move the focused card to the previous column",
        scope: "A focused board card",
      },
      {
        keys: ["Ctrl", "→"],
        action: "Move the focused card to the next column",
        scope: "A focused board card",
      },
      {
        keys: ["Ctrl", "↑"],
        action: "Move the focused card up within its column",
        scope: "A focused board card",
      },
      {
        keys: ["Ctrl", "↓"],
        action: "Move the focused card down within its column",
        scope: "A focused board card",
      },
      // apps/web/src/client/board/useBoardDrag.ts:157
      { keys: ["Esc"], action: "Cancel a drag in progress", scope: "While dragging a card" },
    ],
  },
  {
    group: "Editing",
    items: [
      // apps/web/src/client/editor/BodyEditor.tsx:95
      { keys: ["Ctrl", "S"], action: "Save the task body", scope: "The body editor" },
      // apps/web/src/client/settings/ReorderableRows.tsx:108-109
      {
        keys: ["↑", "/", "↓"],
        action: "Move the focused row up or down",
        scope: "A drag handle in a reorderable list",
      },
    ],
  },
  {
    group: "Dialogs",
    items: [
      // apps/web/src/client/ui/Modal.tsx:20, ui/Menu.tsx:56
      { keys: ["Esc"], action: "Close the dialog or menu", scope: "Any modal or menu" },
      // apps/web/src/client/list/SaveViewDialog.tsx:49
      { keys: ["Enter"], action: "Confirm", scope: "A single-field dialog" },
    ],
  },
];

/**
 * Cmd rather than Ctrl on Apple platforms.
 *
 * The handlers accept **either** modifier (`e.ctrlKey || e.metaKey`),
 * so this only decides which label to print. `navigator.platform` is
 * deprecated and `userAgent` sniffing is unreliable, so this asks the
 * question the browser can actually answer well: whether the primary
 * pointer is coarse is irrelevant, but `userAgentData.platform` is the
 * supported replacement where it exists, with a `userAgent` fallback.
 */
function modifierLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform ?? navigator.userAgent;
  return /mac|iphone|ipad/i.test(platform) ? "Cmd" : "Ctrl";
}

export function KeyboardPanel() {
  const mod = modifierLabel();
  return (
    <div className="p-8" data-testid="keyboard-panel">
      <h1 className="mb-1 text-lg font-semibold text-text-primary">Keyboard</h1>
      <p className="mb-6 max-w-prose text-[12px] text-text-secondary">
        The shortcuts this build actually has. Shortcuts are not
        rebindable.
      </p>

      {SHORTCUTS.map(group => (
        <section key={group.group} className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold text-text-primary">
            {group.group}
          </h2>
          <table className="w-full max-w-2xl border-collapse text-left">
            <tbody>
              {group.items.map(s => (
                <tr key={`${s.action}-${s.keys.join("+")}`} className="border-b border-border-subtle">
                  <td className="w-40 py-1.5 align-top">
                    {s.keys.map((k, i) => (
                      <span key={`${k}-${String(i)}`}>
                        {/* No separator before the "or", and none
                            after it either — otherwise "↑ / ↓" renders
                            as "↑ or + ↓". */}
                        {i > 0 && k !== "/" && s.keys[i - 1] !== "/" ? (
                          <span className="mx-0.5 text-text-tertiary">+</span>
                        ) : null}
                        {k === "/" ? (
                          <span className="mx-0.5 text-text-tertiary">or</span>
                        ) : (
                          <kbd className="rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
                            {k === "Ctrl" ? mod : k}
                          </kbd>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 text-[13px] text-text-primary">{s.action}</td>
                  <td className="py-1.5 text-right text-[12px] text-text-tertiary">
                    {s.scope}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
