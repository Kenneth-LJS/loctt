/**
 * Settings → Personal → Keyboard (C.10.22, K133).
 *
 * Two parts:
 *
 * - **Single-key shortcuts**: the global keys, rendered by
 *   `ShortcutSettingsEditor` — the same component the `?` dialog's
 *   Customize view renders — with the master switch, one switch per
 *   shortcut, and Reset to default. The rows come from
 *   `GLOBAL_SHORTCUTS`, the table `useShortcuts` dispatches from, so
 *   they cannot drift (A11Y-4).
 * - **A read-only reference** for the context-scoped keys (board cards,
 *   reorder handles, the body editor, dialogs). Those carry a modifier
 *   or only act while their control has focus, so K133's switches do
 *   not cover them. They are read off their handlers by hand, because
 *   they are bound by whichever component owns focus and there is no
 *   single table to derive them from. Each carries the source it was
 *   read from; check it before editing.
 *
 * **No row here is aspirational.** A reference that documents an
 * unbuilt key is worse than no reference.
 */

import { ShortcutSettingsEditor } from "../shell/ShortcutSettingsEditor.tsx";

interface Shortcut {
  readonly keys: readonly string[];
  readonly action: string;
  /** Where it applies — the reference is useless without scope. */
  readonly scope: string;
}

const SHORTCUTS: readonly { group: string; items: readonly Shortcut[] }[] = [
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
      // apps/web/src/client/editor/BodyEditor.tsx (K124: Save and Cancel)
      { keys: ["Ctrl", "Enter"], action: "Save the description", scope: "Editing a description" },
      { keys: ["Ctrl", "S"], action: "Save the description", scope: "Editing a description" },
      { keys: ["Esc"], action: "Cancel editing the description", scope: "Editing a description" },
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
    <div data-testid="keyboard-panel">
      <h1 className="mb-4 text-lg font-semibold text-text-primary">Keyboard</h1>

      <section className="mb-8 max-w-2xl">
        <ShortcutSettingsEditor testIdPrefix="keyboard-shortcuts" headingLevel={2} />
      </section>

      {SHORTCUTS.map(group => (
        <section key={group.group} className="mb-6">
          <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">
            {group.group}
          </h2>
          <table className="w-full max-w-2xl border-collapse text-left">
            <tbody>
              {group.items.map(s => (
                <tr key={`${s.action}-${s.keys.join("+")}`} className="border-b border-border-subtle">
                  <td className="w-auto py-1.5 align-top sm:w-40">
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
                          <kbd className="rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 text-[0.7857rem] text-text-primary">
                            {k === "Ctrl" ? mod : k}
                          </kbd>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 pl-2 align-top text-[0.9286rem] text-text-primary">
                    {s.action}
                    {/* On a phone the context can't fit as a third column
                        without truncating to ~57px — show it under the
                        action instead (UX eval #11). Hidden here at >= sm
                        where the dedicated column carries it. */}
                    {s.scope !== undefined && s.scope !== "" && (
                      <span className="mt-0.5 block text-[0.7857rem] text-text-tertiary sm:hidden">
                        {s.scope}
                      </span>
                    )}
                  </td>
                  <td className="hidden py-1.5 text-right align-top text-[0.8571rem] text-text-tertiary sm:table-cell">
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
