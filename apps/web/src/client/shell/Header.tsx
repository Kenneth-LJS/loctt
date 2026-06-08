import type { UserProfile } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";

import { useUsers } from "../api/hooks/sidebarData.ts";
import { useSwitchUser } from "../api/hooks/useSwitchUser.ts";
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
export function Header({
  currentUser,
  onToggleSidebar,
}: {
  readonly currentUser: UserProfile;
  readonly onToggleSidebar: () => void;
}) {
  return (
    <header className="col-span-2 flex h-12 items-center gap-3 border-b border-border-subtle bg-bg-surface px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="grid h-8 w-8 place-items-center rounded-md text-text-secondary hover:bg-bg-muted hover:text-text-primary"
      >
        <HamburgerIcon />
      </button>

      <div className="flex items-center gap-2 pr-2 text-[14px] font-semibold text-text-primary">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-sm bg-accent text-[12px] font-bold text-accent-contrast">
          T
        </span>
        <span>TaskTracker</span>
      </div>

      <div className="flex-1" />

      <input
        type="search"
        placeholder="Search tasks…"
        aria-label="Search tasks"
        disabled
        title="Search arrives in a later milestone"
        className="h-8 w-[280px] rounded-md border border-border-default bg-bg-surface px-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-2 focus:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      />

      <ThemeToggle />

      <button
        type="button"
        disabled
        title="Create task arrives in a later milestone"
        className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        <PlusIcon />
        New task
      </button>

      <UserMenu currentUser={currentUser} />
    </header>
  );
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  return (
    <div className="inline-flex h-8 items-center rounded-md bg-bg-muted p-0.5" aria-label="Theme">
      <button
        type="button"
        aria-pressed={resolved === "light"}
        title="Light"
        onClick={() => setPreference("light")}
        className={[
          "h-7 rounded-[4px] px-2.5 text-[13px]",
          resolved === "light"
            ? "bg-bg-surface text-text-primary shadow-raised"
            : "text-text-secondary",
        ].join(" ")}
      >
        ☀
      </button>
      <button
        type="button"
        aria-pressed={resolved === "dark"}
        title="Dark"
        onClick={() => setPreference("dark")}
        className={[
          "h-7 rounded-[4px] px-2.5 text-[13px]",
          resolved === "dark"
            ? "bg-bg-surface text-text-primary shadow-raised"
            : "text-text-secondary",
        ].join(" ")}
      >
        ☾
      </button>
    </div>
  );
}

function UserMenu({ currentUser }: { readonly currentUser: UserProfile }) {
  const users = useUsers();
  const switchUser = useSwitchUser();
  const others = (users.data?.items ?? []).filter(
    u => u.id !== currentUser.id && u.archived !== true,
  );

  return (
    <Menu
      align="end"
      aria-label="User menu"
      trigger={({ toggle, ...aria }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="User menu"
          className={[
            "grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-semibold",
            avatarPalette(currentUser.id),
          ].join(" ")}
          {...aria}
        >
          {initials(currentUser.name)}
        </button>
      )}
    >
      {({ close }) => (
        <div className="min-w-[240px]">
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
