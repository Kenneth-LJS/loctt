import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useInfo } from "../api/hooks/useInfo.ts";
import { useAppContext } from "../context/AppBootstrap.tsx";
import { useTheme } from "../theme/useTheme.ts";

interface PlaceholderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

const NAV: { to: string; label: string }[] = [
  { to: "/list", label: "List" },
  { to: "/board", label: "Board" },
  { to: "/timeline", label: "Timeline" },
  { to: "/tasks/T-1", label: "Task detail (sample)" },
  { to: "/sprints/S-12", label: "Sprint detail (sample)" },
  { to: "/settings/projects", label: "Settings" },
  { to: "/init", label: "Init" },
];

/**
 * Shared scaffold rendered by each stub route until its real
 * implementation lands. Renders a header, top nav, and any custom
 * content the route wants to expose (e.g. parsed search params).
 *
 * The app shell from T1.1 will replace this layout; until then the
 * nav lets us click through every route to verify the router wiring.
 */
export function Placeholder({ title, subtitle, children }: PlaceholderProps) {
  const { preference, resolved, setPreference } = useTheme();
  const info = useInfo();
  const { currentUser, schemaStatus, readOnly } = useAppContext();
  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary p-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">LocTT</h1>
            <p className="text-text-tertiary text-sm">
              {currentUser ? `Signed in as ${currentUser.name}` : "No user registered"}
              {info.data ? ` · ${info.data.taskCount} task(s) · schema ${schemaStatus.kind}` : null}
              {readOnly ? " · read-only" : null}
            </p>
          </div>
          <div className="flex gap-1 p-1 rounded-md bg-bg-muted border border-border-subtle text-xs">
            {(["light", "dark", "system"] as const).map(pref => (
              <button
                key={pref}
                type="button"
                onClick={() => setPreference(pref)}
                className={`px-2.5 py-1 rounded-sm capitalize ${
                  preference === pref
                    ? "bg-bg-surface text-text-primary shadow-raised"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                title={`Resolved: ${resolved}`}
              >
                {pref}
              </button>
            ))}
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 p-1 rounded-md bg-bg-muted border border-border-subtle text-xs">
          {NAV.map(n => (
            <Link
              key={n.to}
              to={n.to}
              className="px-2.5 py-1 rounded-sm text-text-secondary hover:text-text-primary hover:bg-bg-surface"
              activeProps={{ className: "px-2.5 py-1 rounded-sm bg-bg-surface text-text-primary shadow-raised" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <section className="rounded-md border border-border-subtle bg-bg-surface shadow-raised p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle ? <p className="text-text-tertiary text-sm">{subtitle}</p> : null}
          {children}
        </section>
      </div>
    </main>
  );
}
