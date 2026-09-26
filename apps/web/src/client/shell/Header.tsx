import type { UserProfile } from "@loctt/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { useUsers } from "../api/hooks/sidebarData.ts";
import { useSearch } from "../api/hooks/useSearch.ts";
import { useSwitchUser } from "../api/hooks/useSwitchUser.ts";
import { useCreateTask } from "../create/CreateTaskProvider.tsx";
import { useTheme } from "../theme/useTheme.ts";
import { avatarPalette, initials } from "../ui/avatar.ts";
import { LogoMark } from "../ui/brand/LogoMark.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { TextField } from "../ui/TextField.tsx";
import { SrOnly } from "../ui/Tooltip.tsx";
import { UserAvatar } from "../ui/UserAvatar.tsx";
import { IntegrityBadge } from "./IntegrityBadge.tsx";

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
  sidebarCollapsed = false,
  createBlocked,
  onOpenShortcutHelp,
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
   * Whether the sidebar is currently collapsed.
   *
   * Needed only so the toggle can announce its state (A11Y-21): a
   * button that says "Toggle sidebar" and nothing else leaves a
   * screen-reader user unable to tell whether pressing it will open or
   * close, and unable to tell what pressing it just did.
   */
  readonly sidebarCollapsed?: boolean;
  /**
   * Opens the `?` shortcut dialog from the user menu (K133). The menu is
   * the way in when `?` itself is switched off. Absent in isolated
   * renders, where the item is left out rather than shown dead.
   */
  readonly onOpenShortcutHelp?: () => void;
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
      <IconButton
        onClick={onToggleSidebar}
        disabled={!canToggleSidebar}
        // UI-23e: a disabled control's reason is its accessible
        // DESCRIPTION, not a hover tooltip and not its name. Wired
        // explicitly rather than left to the browser's
        // `title`-as-description fallback; the `sr-only` node it points
        // at is rendered below, outside the button so it cannot join the
        // name.
        {...(canToggleSidebar ? {} : { "aria-describedby": SIDEBAR_TOGGLE_REASON_ID })}
        aria-label="Toggle sidebar"
        // A11Y-21: the control exposes its *state*, not only its
        // label. `aria-expanded` is the right property for a
        // disclosure — the sidebar is shown or hidden, which is what
        // expanded/collapsed means; `aria-pressed` would describe the
        // button as a toggle that is "on", which reads backwards here
        // (the button is not pressed, the sidebar is open).
        aria-expanded={!sidebarCollapsed}
      >
        <HamburgerIcon />
      </IconButton>
      {!canToggleSidebar && (
        <SrOnly id={SIDEBAR_TOGGLE_REASON_ID}>
          The sidebar stays collapsed at this width
        </SrOnly>
      )}

      <div className="flex shrink-0 items-center gap-2 pr-1 text-[1rem] font-semibold text-text-primary sm:pr-2">
        <LogoMark size={22} />
        {/* The wordmark is the first thing to go: the logo already
            identifies the app, and the controls to its right are the
            ones the user needs to reach. */}
        <span className="hidden sm:inline">LocTT</span>
      </div>

      <div className="flex-1" />

      <HeaderSearch />

      {/* DEG-31: the global data-integrity badge. Renders itself only when
          there are problems; a clean tracker shows nothing here. Placed
          before the theme toggle so it sits with the app-state affordances
          rather than the per-task actions. */}
      <IntegrityBadge />

      <ThemeToggle />

      {/* NEW-1: one of the three entry points, and it goes through the
          same provider as the board's "+ Add task" and the `n`
          shortcut, so all three open the identical modal. */}
      <Button
        variant="primary"
        disabled={createBlocked !== undefined}
        // UI-23e: same rule as the sidebar toggle above — the reason why
        // creating is blocked is a description, so it never displaces
        // "New task" as the button's name.
        {...(createBlocked === undefined ? {} : { "aria-describedby": NEW_TASK_REASON_ID })}
        onClick={() => { createTask.open(); }}
        aria-label="New task"
        testId="header-new-task"
        className="shrink-0"
      >
        <PlusIcon />
        {/* The icon carries the meaning at narrow widths; the button
            keeps its accessible name via aria-label either way. */}
        <span className="hidden sm:inline">New task</span>
      </Button>
      {createBlocked !== undefined && (
        <SrOnly id={NEW_TASK_REASON_ID}>{createBlocked}</SrOnly>
      )}

      <UserMenu
        currentUser={currentUser}
        identityUnknown={identityUnknown}
        {...(onOpenShortcutHelp !== undefined ? { onOpenShortcutHelp } : {})}
      />
    </header>
  );
}

/**
 * Ids for the two disabled-reason description nodes above (UI-23e).
 *
 * Module constants rather than `useId()` because there is exactly one
 * header on the page, so there is nothing to collide with, and a stable
 * id is far easier to assert against than a generated one.
 */
const SIDEBAR_TOGGLE_REASON_ID = "header-sidebar-toggle-reason";
const NEW_TASK_REASON_ID = "header-new-task-reason";

/**
 * The global header search (SHL-46).
 *
 * The box was a dead input (`disabled`, no handler). Now typing debounces
 * a `GET /api/search?q=…` request (a real network call) and shows a
 * dropdown of matching tasks; clicking one navigates to it, and pressing
 * Enter navigates to the list view filtered by the query so the full
 * result set is browsable there. `/` focuses the box from anywhere
 * (A11Y-2), except while typing in another field.
 *
 * The request is debounced (250ms) so a fast typist fires one request
 * per pause, not one per keystroke; `useSearch` additionally keeps the
 * previous results on screen until the next land, so the dropdown does
 * not flicker empty between requests.
 */
const SEARCH_DEBOUNCE_MS = 250;

function HeaderSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Debounce the value the query actually runs on.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(value); }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(t); };
  }, [value]);

  const search = useSearch(debounced);
  const hits = search.data?.items ?? [];

  // `/` focuses this box from anywhere (A11Y-2). That binding is owned
  // by the shell's global shortcut registry (AppShell → useGlobalShort-
  // cuts → the `focus-search` shortcut, which finds this input by its
  // `type="search"`), NOT by a listener here. Header used to add a second
  // document `keydown` for `/` as well, which double-bound the key and
  // bypassed the registry's dialog guard (a `/` typed with a modal open
  // still stole focus). One owner: the global registry. See A150-adjacent
  // notes / the B2 fix-review (duplicate `/` binding).

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("mousedown", onClick); };
  }, [open]);

  const goToList = (): void => {
    const raw = value.trim();
    if (raw.length === 0) return;
    setOpen(false);
    // The list's `q` is a DSL expression, not free text — it is fed
    // straight to `/api/tasks?query=…` (via `tasksParamsFromSearch`) and
    // parsed by core's query DSL. Sending the raw words (`hello`, or
    // `(bug)`) produced a ParseError and the list showed "Could not load
    // tasks" — SHL-46's headline path was broken. Wrap the text in the
    // same `text ~ "<q>"` clause `/api/search` builds (server.ts uses
    // `JSON.stringify` for the quoting), so a plain-word search resolves
    // to the identical substring match the dropdown just ran.
    const q = `text ~ ${JSON.stringify(raw)}`;
    void navigate({ to: "/list", search: prev => ({ ...prev, q }) });
  };

  const goToTask = (key: string): void => {
    setOpen(false);
    setValue("");
    void navigate({ to: "/tasks/$key", params: { key } });
  };

  const showDropdown = open && value.trim().length > 0;

  return (
    <div
      ref={containerRef}
      className="relative hidden w-full min-w-0 max-w-[280px] sm:block"
    >
      <TextField
        ref={inputRef}
        type="search"
        value={value}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        data-testid="header-search"
        onChange={e => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); goToList(); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        className="h-8"
      />

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          data-testid="header-search-results"
          className="absolute left-0 right-0 top-9 z-30 max-h-80 overflow-y-auto rounded-md border border-border-default bg-bg-surface py-1 shadow-raised"
        >
          {search.isError ? (
            <div role="alert" className="px-3 py-2 text-[0.8571rem] text-danger-fg">
              Search failed. Try again.
            </div>
          ) : hits.length === 0 && !search.isFetching ? (
            <div className="px-3 py-2 text-[0.8571rem] text-text-tertiary">
              No tasks match “{value.trim()}”
            </div>
          ) : (
            <>
              {hits.map(h => (
                <button
                  key={h.key}
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-testid={`header-search-hit-${h.key}`}
                  onClick={() => { goToTask(h.key); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary hover:bg-bg-muted hover:text-text-primary"
                >
                  <span className="shrink-0 text-[0.7143rem] text-text-tertiary">{h.key}</span>
                  <span className="truncate">{h.title}</span>
                </button>
              ))}
              <button
                type="button"
                data-testid="header-search-all"
                onClick={goToList}
                className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-left text-[0.8571rem] font-medium text-accent hover:bg-bg-muted"
              >
                See all results for “{value.trim()}”
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
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
    { value: "light", label: "Light", icon: "sun" },
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "system", label: "System", icon: "monitor" },
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
            "inline-flex h-7 items-center justify-center rounded-[4px] px-2.5",
            preference === o.value
              ? "bg-bg-surface text-text-primary shadow-raised"
              : "text-text-secondary",
          ].join(" ")}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

function UserMenu({
  currentUser,
  identityUnknown,
  onOpenShortcutHelp,
}: {
  readonly currentUser: UserProfile | null;
  readonly identityUnknown: boolean;
  readonly onOpenShortcutHelp?: () => void;
}) {
  const users = useUsers();
  const switchUser = useSwitchUser();
  const others = (users.data?.items ?? []).filter(
    u => u.id !== currentUser?.id && u.archived !== true,
  );

  // PRU-24: the current user can be archived from the CLI while the UI
  // is open. The next `users`/`current` fetch carries `archived: true`,
  // and here it stops presenting the actor as a normal active user —
  // the chip is marked and the menu prompts a switch. `identityUnknown`
  // is the read-failed case and takes precedence: an unknown identity
  // is not an archived one.
  const currentArchived =
    !identityUnknown && currentUser !== null && currentUser.archived === true;

  return (
    <Menu
      align="end"
      aria-label="User menu"
      trigger={({ toggle, ...aria }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="user-menu-trigger"
          aria-label={
            identityUnknown
              ? "User menu, signed-in user unknown"
              : currentArchived
                ? `User menu, ${currentUser.name} is archived`
                : "User menu"
          }
          title={
            identityUnknown
              ? UNKNOWN_IDENTITY_REASON
              : currentArchived
                ? `${currentUser.name} is archived. Switch to an active user.`
                : undefined
          }
          className={[
            "grid h-[24px] w-[24px] place-items-center rounded-full text-[0.7857rem] font-semibold",
            // An explicit unknown mark, not a blank circle and not a
            // palette slot borrowed from an id we do not have. An
            // archived actor keeps their palette colour but gains a
            // dashed warning ring so the header itself signals it.
            identityUnknown
              ? "border border-dashed border-danger-fg/60 text-danger-fg"
              : currentArchived
                ? `${avatarPalette(currentUser.id)} ring-1 ring-warn-fg ring-offset-1 ring-offset-bg-surface`
                : avatarPalette(currentUser?.id ?? ""),
          ].join(" ")}
          {...aria}
        >
          {identityUnknown ? "?" : initials(currentUser?.name ?? currentUser?.id ?? "")}
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
              className="border-b border-border-subtle px-3 py-2.5 text-[0.8571rem] text-text-secondary"
            >
              <div className="font-medium text-danger-fg">Signed-in user unknown</div>
              <div className="mt-0.5">{UNKNOWN_IDENTITY_REASON}</div>
            </div>
          ) : (
            <div
              data-testid="user-menu-current"
              className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2.5"
            >
              {/* PRU-13: the stored avatar appears in the header menu,
                  reverting to initials on removal (PRU-31). */}
              <UserAvatar
                user={currentUser}
                sizeClass="h-[22px] w-[22px] text-[0.7857rem]"
                testId="user-menu-current-avatar"
              />
              <div className="min-w-0">
                <div className="truncate text-[0.9286rem] font-medium text-text-primary">
                  {currentUser.name ?? currentUser.id}
                  {currentArchived ? (
                    <span
                      data-testid="user-menu-current-archived"
                      className="ml-1.5 font-normal text-warn-fg"
                    >
                      (archived)
                    </span>
                  ) : null}
                </div>
                {currentUser.email ? (
                  <div className="truncate text-[0.7857rem] text-text-tertiary">
                    {currentUser.email}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {others.length > 0 ? (
            <div className="py-1">
              <div className="px-3 py-1 text-[0.7857rem] font-semibold uppercase tracking-wide text-text-tertiary">
                Switch user
              </div>
              {others.map(u => (
                <MenuItem
                  key={u.id}
                  testId={`user-switch-${u.id}`}
                  onSelect={() => {
                    switchUser.mutate(u.id);
                    close();
                  }}
                >
                  <span
                    className={[
                      "grid h-5 w-5 place-items-center rounded-full text-[0.7143rem] font-semibold",
                      avatarPalette(u.id),
                    ].join(" ")}
                  >
                    {initials(u.name ?? u.id)}
                  </span>
                  <span className="truncate">{u.name ?? u.id}</span>
                </MenuItem>
              ))}
            </div>
          ) : null}

          {/* CONFIG-5 / P4: the menu used to offer one generic "Settings"
              link, which taught the user nothing about *where* their own
              settings live. These are differentiated deep links to the
              exact section that owns each concept (K100), each labelled as
              navigation. "My profile" jumps to the current user's row via
              the `#row-<id>` anchor UsersPanel exposes; "Customize
              sidebar…" lands on the sidebar-groups section that owns the
              group order/visibility (and pins live one section over). The
              plain "Settings" link is kept as the catch-all landing. */}
          <div className="border-t border-border-subtle py-1">
            {currentUser ? (
              <Link
                to="/settings/$section"
                params={{ section: "users" }}
                hash={`row-${currentUser.id}`}
                onClick={close}
                data-testid="user-menu-profile"
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary"
              >
                My profile
              </Link>
            ) : null}
            <Link
              to="/settings/$section"
              params={{ section: "preferences" }}
              onClick={close}
              data-testid="user-menu-preferences"
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary"
            >
              My preferences
            </Link>
            <Link
              to="/settings/$section"
              params={{ section: "sidebar-groups" }}
              onClick={close}
              data-testid="user-menu-sidebar"
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary"
            >
              Customize sidebar
            </Link>
            {onOpenShortcutHelp !== undefined ? (
              <MenuItem
                testId="user-menu-shortcuts"
                onSelect={() => {
                  close();
                  onOpenShortcutHelp();
                }}
              >
                Keyboard shortcuts
              </MenuItem>
            ) : null}
            <Link
              to="/settings/$section"
              params={{ section: "users" }}
              onClick={close}
              data-testid="user-menu-settings"
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted hover:text-text-primary"
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
