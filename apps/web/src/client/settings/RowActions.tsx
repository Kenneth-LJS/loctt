import { Icon } from "../ui/Icon.tsx";
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
 * A disabled action stays listed (so the menu's contents are stable) but
 * is inert and dimmed, carrying its reason as a `title` — matching how the
 * inline buttons communicated "you cannot archive yourself".
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
}: {
  readonly actions: readonly RowAction[];
  /** Names what the menu acts on, e.g. `Actions for sprint "Sprint 12"`. */
  readonly label: string;
  readonly align?: "start" | "end";
}) {
  return (
    <Menu
      align={align}
      aria-label={label}
      trigger={t => (
        <button
          type="button"
          id={t.id}
          aria-haspopup={t["aria-haspopup"]}
          aria-expanded={t["aria-expanded"]}
          aria-label={label}
          onClick={t.toggle}
          className="grid h-11 w-11 place-items-center rounded-md text-text-secondary hover:bg-bg-muted disabled:opacity-50"
        >
          <Icon name="more" />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {actions.map((a, i) => (
            <MenuItem
              key={a.testId ?? `${a.label}-${i}`}
              {...(a.testId !== undefined ? { testId: a.testId } : {})}
              // A disabled action is inert: no onSelect, dimmed, reason on
              // hover. Kept in the list so the menu's shape doesn't shift.
              {...(a.disabled ? {} : { onSelect: () => { close(); a.onSelect(); } })}
              className={[
                a.danger ? "text-danger-fg hover:bg-danger-bg hover:text-danger-fg" : "",
                a.disabled ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <span {...(a.disabled && a.title !== undefined ? { title: a.title } : {})}>{a.label}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
