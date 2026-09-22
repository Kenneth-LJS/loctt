import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";

/**
 * A single row/card's secondary actions, collapsed into a kebab (⋯)
 * overflow menu. Shared by the settings collection panels (Sprints,
 * Milestones, Saved views, Labels, Projects, Relationships) so a row's
 * Edit / Archive / Delete / … never overflow or wrap raggedly on a narrow
 * pane — the desktop path used to lay them out inline and they ran off the
 * screen at phone width (Ken's report; responsive plan GROUP A).
 *
 * Wraps the existing `Menu`/`MenuItem`, which already provide roving
 * arrow-key focus, Esc/outside-click close, and correct
 * `aria-haspopup="menu"` semantics. The trigger is a >=44px button with an
 * accessible label naming the row it acts on (WCAG 2.5.5 tap target).
 *
 * A disabled action stays listed (so the menu's contents are stable) and
 * is genuinely `disabled` (A11Y-31): the native attribute, so it exposes
 * the `disabled` property and implicit `aria-disabled`, refuses focus, and
 * leaves the roving arrow-key order. Its reason rides on the button's own
 * `title`, which browsers surface as the accessible description — not on
 * an inner span, where it would be a pointer tooltip and nothing more.
 */

export interface RowAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /**
   * Reason shown on hover when disabled. Accepts `undefined` explicitly so
   * callers can pass a conditional `cond ? "reason" : undefined` inline
   * under exactOptionalPropertyTypes.
   */
  readonly title?: string | undefined;
  /** Destructive styling (e.g. Delete). */
  readonly danger?: boolean;
  readonly testId?: string;
}

export function RowActions({
  actions,
  label,
  align = "end",
  size = "touch",
}: {
  readonly actions: readonly RowAction[];
  /** Names what the menu acts on, e.g. `Actions for sprint "Sprint 12"`. */
  readonly label: string;
  readonly align?: "start" | "end";
  /**
   * Trigger footprint. `"touch"` (default) is the 44px WCAG 2.5.5 tap
   * target the settings collection panels use; `"sm"` is the compact 28px
   * kebab for dense rows like the sidebar's saved-filter list, where a
   * 44px control would tower over an 8-tall row. Both map straight onto
   * `IconButton`'s own sizes.
   */
  readonly size?: "sm" | "touch";
}) {
  return (
    <Menu
      align={align}
      aria-label={label}
      trigger={t => (
        <IconButton
          id={t.id}
          aria-haspopup={t["aria-haspopup"]}
          aria-expanded={t["aria-expanded"]}
          aria-label={label}
          onClick={t.toggle}
          size={size}
        >
          <Icon name="more" />
        </IconButton>
      )}
    >
      {({ close }) => (
        <>
          {actions.map((a, i) => (
            <MenuItem
              key={a.testId ?? `${a.label}-${i}`}
              {...(a.testId !== undefined ? { testId: a.testId } : {})}
              // A disabled action is genuinely disabled (A11Y-31): the
              // native attribute, so it carries the `disabled` property
              // and implicit `aria-disabled`, refuses focus, and drops out
              // of the menu's roving arrow-key order. Dropping `onSelect`
              // and dimming it — what this did before — left a control
              // that announced as actionable and did nothing.
              disabled={a.disabled ?? false}
              // The reason goes on the BUTTON, so it is the item's
              // accessible description rather than a pointer tooltip on an
              // inner span that assistive tech never reads.
              {...(a.disabled === true && a.title !== undefined ? { title: a.title } : {})}
              onSelect={() => { close(); a.onSelect(); }}
              className={
                // Danger tint only while the item is live — a disabled row
                // is greyed, and `MenuItem` already owns that treatment.
                // These are separate branches because the class list is
                // concatenated, not conflict-resolved (see `cn`): emitting
                // both would leave CSS order to pick a colour.
                a.danger === true && a.disabled !== true
                  ? "text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                  : ""
              }
            >
              {a.label}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
