/**
 * Settings → Personal → Keyboard (C.10.22).
 *
 * A reference, not a rebinding editor: nothing in the app reads a
 * user-defined keymap, and offering one that changed nothing would be
 * a control that lies (P4).
 *
 * **No row here is aspirational.** A reference that documents an
 * unbuilt key is worse than no reference: the user presses it, nothing
 * happens, and they cannot tell a broken build from a wrong doc.
 *
 * The global keys come from `GLOBAL_SHORTCUTS`, the same table
 * `useShortcuts` dispatches from, so they cannot drift (A11Y-4). The
 * context-scoped groups below — board cards, reorder handles, the body
 * editor, dialogs — are still read off their handlers by hand, because
 * those keys are bound by whichever component owns focus and there is
 * no single table to derive them from. Each carries the source line it
 * was read from; check it before editing.
 *
 * `?` opens the same global list in a dialog from anywhere. This page
 * is the fuller reference, since it also covers the context keys.
 */

import { GLOBAL_SHORTCUTS } from "../shell/shortcuts.ts";

interface Shortcut {
  readonly keys: readonly string[];
  readonly action: string;
  /** Where it applies — the reference is useless without scope. */
  readonly scope: string;
}

/**
 * The global keys, derived from the registry rather than re-typed.
 *
 * `[` used to be hand-listed here with a source line number in a
 * comment. When the global bindings moved into `shell/shortcuts.ts`
 * (M4.8), that entry became a hand-maintained copy of a table the app
 * actually dispatches from — and it was already incomplete, listing
 * `[` while `n`, `/`, the `g` chords, `t` and `?` were bound and
 * undocumented here.
 *
 * That is precisely A11Y-4's defect ("listed but not bound, or bound
 * but not listed"). Deriving them removes the possibility.
 *
 * The scope line is uniform because it is a property of the shortcut
 * *system*, not of any one key: `useShortcuts` applies the typing
 * guard, the dialog guard and the modifier guard to every entry.
 */
const GLOBAL_ROWS: readonly Shortcut[] = GLOBAL_SHORTCUTS.map(s => ({
  keys: s.keys,
  action: s.action,
  scope: "Anywhere outside a text field or dialog",
}));

const SHORTCUTS: readonly { group: string; items: readonly Shortcut[] }[] = [
  {
    group: "Global",
    items: GLOBAL_ROWS,
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
      <p className="mb-6 max-w-prose text-[0.8571rem] text-text-secondary">
        The shortcuts this build actually has. Shortcuts are not
        rebindable.
      </p>

      {SHORTCUTS.map(group => (
        <section key={group.group} className="mb-6">
          <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">
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
                          <kbd className="rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 font-mono text-[0.7857rem] text-text-primary">
                            {k === "Ctrl" ? mod : k}
                          </kbd>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 text-[0.9286rem] text-text-primary">{s.action}</td>
                  <td className="py-1.5 text-right text-[0.8571rem] text-text-tertiary">
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
