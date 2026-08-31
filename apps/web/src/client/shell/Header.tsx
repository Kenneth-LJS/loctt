import type { UserProfile } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";

import { useUsers } from "../api/hooks/sidebarData.ts";
import { useSwitchUser } from "../api/hooks/useSwitchUser.ts";
import { useCreateTask } from "../create/CreateTaskProvider.tsx";
import { useTheme } from "../theme/useTheme.ts";
import { avatarPalette, initials } from "../ui/avatar.ts";
import { Menu, MenuItem } from "../ui/Menu.tsx";

/**
 * App header: sidebar toggle, brand, a (stub) search box, theme
 * toggle, the create-task button (stub in M1.1 — the modal lands in
 * M3.4), and the current-user avatar with its dropdown menu.
 *
 * The user menu lists the current user, lets you switch to any other
 * registered user, and links to Settings (the route is a stub until
 * M4). Search and create-task are visually present but inert here so
 * the chrome matches the mockup; their behaviour arrives with the
 * tickets that own them.
 */
/**
 * Why an attributed write is refused while the identity is unknown.
 *
 * SHL-40 requires the block to name its reason rather than fail
 * silently or, worse, write under a guessed identity.
 */
export const UNKNOWN_IDENTITY_REASON =
  "The current user could not be determined, so changes that record who made "
  + "them are blocked. Settings is still reachable.";

export function Header({
  currentUser,
  identityUnknown = false,
  onToggleSidebar,
  canToggleSidebar = true,
  createBlocked,
}: {
  /** Null when the current-user read failed (SHL-40). */
  readonly currentUser: UserProfile | null;
  /** True when the identity is unknown because the read failed. */
  readonly identityUnknown?: boolean;
  readonly onToggleSidebar: () => void;
  /**
   * False below the sidebar's breakpoint, where it cannot expand.
   * Disabled rather than silently inert: the click used to be stored
   * and surface later at a wide width, which reads as the app changing
   * state on its own.
   */
  readonly canToggleSidebar?: boolean;
  /**
   * NEW-41: a create started under a mismatched schema cannot land —
   * every `/api/` route 409s. The shell deliberately stays up in that
   * state (SHL-13, XS-34, XS-35), so the modal was reachable and its
   * Create button enabled, and submitting produced no error and no
   * POST: a working-looking button that silently did nothing.
   *
   * A45 recorded the opposite — "the shell never mounts and the modal
   * cannot open" — and wrote no test on that basis. Measured against a
   * live tracker at `.schema-version=9`: the button was visible and
   * enabled, `n` opened the modal, and submit enabled once a title was
   * typed.
   */
  readonly createBlocked?: string | undefined;
}) {
  const createTask = useCreateTask();
  return (
    // Responsive because it has to be: at 375px this header's contents
    // ran to x=561, so the *whole page* panned sideways and the theme
    // toggle and avatar sat off-screen (M1 gate, F5). The table's own
    // container was already correct — the header was the one thing on
    // the page that could not fit.
    //
    // `min-w-0` lets the flex children shrink below their content
    // width; the wordmark and the search stub (disabled until search
    // lands) drop below `sm`; the controls the user needs stay.
    <header className="col-span-2 flex h-12 min-w-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        disabled={!canToggleSidebar}
        title={canToggleSidebar ? undefined : "The sidebar stays collapsed at this width"}
        aria-label="Toggle sidebar"
        className="grid h-8 w-8 place-items-center rounded-md text-text-secondary hover:bg-bg-muted hover:text-text-primary"
      >
        <HamburgerIcon />
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-1 text-[14px] font-semibold text-text-primary sm:pr-2">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-sm bg-accent text-[12px] font-bold text-accent-contrast">
          T
        </span>
        {/* The wordmark is the first thing to go: the logo already
            identifies the app, and the controls to its right are the
            ones the user needs to reach. */}
        <span className="hidden sm:inline">TaskTracker</span>
      </div>

      <div className="flex-1" />

      <input
        type="search"
        placeholder="Search tasks…"
        aria-label="Search tasks"
        disabled
        title="Search arrives in a later milestone"
        className="hidden h-8 w-full min-w-0 max-w-[280px] rounded-md border border-border-default bg-bg-surface px-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-2 focus:outline-accent disabled:cursor-not-allowed disabled:opacity-60 sm:block"
      />

      <ThemeToggle />

      {/* NEW-1: one of the three entry points, and it goes through the
          same provider as the board's "+ Add task" and the `n`
          shortcut, so all three open the identical modal. */}
      <button
        type="button"
        disabled={createBlocked !== undefined}
        title={createBlocked}
        onClick={() => { createTask.open(); }}
        aria-label="New task"
        data-testid="header-new-task"
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
      >
        <PlusIcon />
        {/* The icon carries the meaning at narrow widths; the button
            keeps its accessible name via aria-label either way. */}
        <span className="hidden sm:inline">New task</span>
      </button>

      <UserMenu currentUser={currentUser} identityUnknown={identityUnknown} />
    </header>
  );
}

/**
 * Three-way theme control: Light, Dark, System.
 *
 * SHL-14 requires System to be reachable, and the pressed state to
 * reflect the *preference* rather than what it resolved to. Keying
 * `aria-pressed` on `resolved` (as this did) makes System indis-
 * tinguishable from an explicit Light on a light OS, so a user who
 * chose "follow the OS" is told they chose Light — and has no control
 * to get back.
 */
function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const options = [
    { value: "light", label: "Light", glyph: "\u2600" },
    { value: "dark", label: "Dark", glyph: "\u263e" },
    { value: "system", label: "System", glyph: "\u25d1" },
  ] as const;
  return (
    <div className="inline-flex h-8 shrink-0 items-center rounded-md bg-bg-muted p-0.5" aria-label="Theme">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={preference === o.value}
          title={o.label}
          aria-label={o.label}
          onClick={() => setPreference(o.value)}
          className={[
            "h-7 rounded-[4px] px-2.5 text-[13px]",
            preference === o.value
              ? "bg-bg-surface text-text-primary shadow-raised"
              : "text-text-secondary",
          ].join(" ")}
        >
          {o.glyph}
        </button>
      ))}
    </div>
  );
}

function UserMenu({
  currentUser,
  identityUnknown,
}: {
  readonly currentUser: UserProfile | null;
  readonly identityUnknown: boolean;
}) {
  const users = useUsers();
  const switchUser = useSwitchUser();
  const others = (users.data?.items ?? []).filter(
    u => u.id !== currentUser?.id && u.archived !== true,
  );

  return (
    <Menu
      align="end"
      aria-label="User menu"
      trigger={({ toggle, ...aria }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={identityUnknown ? "User menu — signed-in user unknown" : "User menu"}
          title={identityUnknown ? UNKNOWN_IDENTITY_REASON : undefined}
          className={[
            "grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-semibold",
            // An explicit unknown mark, not a blank circle and not a
            // palette slot borrowed from an id we do not have.
            identityUnknown
              ? "border border-dashed border-danger-fg/60 text-danger-fg"
              : avatarPalette(currentUser?.id ?? ""),
          ].join(" ")}
          {...aria}
        >
          {identityUnknown ? "?" : initials(currentUser?.name ?? "")}
        </button>
      )}
    >
      {({ close }) => (
        <div className="min-w-[240px]">
          {identityUnknown || !currentUser ? (
            // SHL-40: name the failure and its consequence. A blank
            // header would leave the user to discover the blocked
            // write later, with no explanation attached to it.
            <div
              role="alert"
              className="border-b border-border-subtle px-3 py-2.5 text-[12px] text-text-secondary"
            >
              <div className="font-medium text-danger-fg">Signed-in user unknown</div>
              <div className="mt-0.5">{UNKNOWN_IDENTITY_REASON}</div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2.5">
              <span
                className={[
                  "grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-semibold",
                  avatarPalette(currentUser.id),
                ].join(" ")}
              >
                {initials(currentUser.name)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text-primary">
                  {currentUser.name}
                </div>
                {currentUser.email ? (
                  <div className="truncate text-[11px] text-text-tertiary">
                    {currentUser.email}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {others.length > 0 ? (
            <div className="py-1">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                Switch user
              </div>
              {others.map(u => (
                <MenuItem
                  key={u.id}
                  onSelect={() => {
                    switchUser.mutate(u.id);
                    close();
                  }}
                >
                  <span
                    className={[
                      "grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold",
                      avatarPalette(u.id),
                    ].join(" ")}
                  >
                    {initials(u.name)}
                  </span>
                  <span className="truncate">{u.name}</span>
                </MenuItem>
              ))}
            </div>
          ) : null}

          <div className="border-t border-border-subtle py-1">
            <Link
              to="/settings/$section"
              params={{ section: "users" }}
              onClick={close}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary"
            >
              Settings
            </Link>
          </div>
        </div>
      )}
    </Menu>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
