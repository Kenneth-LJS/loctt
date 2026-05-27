import { useTheme } from "./theme/useTheme.ts";

const BTN_BASE =
  "inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-(--radius-md) transition-colors";

export function App() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">LocTT</h1>
            <p className="text-text-tertiary text-sm">
              Design tokens preview · routing and the data layer land in T0.3+
            </p>
          </div>
          <div className="flex gap-1 p-1 rounded-(--radius-md) bg-bg-muted border border-border-subtle text-xs">
            {(["light", "dark", "system"] as const).map(pref => (
              <button
                key={pref}
                type="button"
                onClick={() => setPreference(pref)}
                className={`px-2.5 py-1 rounded-(--radius-sm) capitalize ${
                  preference === pref
                    ? "bg-bg-surface text-text-primary shadow-(--shadow-raised)"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {pref}
              </button>
            ))}
          </div>
        </header>

        <section className="rounded-(--radius-md) border border-border-subtle bg-bg-surface shadow-(--shadow-raised) p-5 flex flex-col gap-4">
          <h2 className="text-base font-semibold">Buttons</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${BTN_BASE} bg-accent text-accent-contrast hover:bg-accent-hover`}
            >
              Primary
            </button>
            <button
              type="button"
              className={`${BTN_BASE} bg-bg-muted text-text-primary hover:bg-bg-muted-hover border border-border-default`}
            >
              Secondary
            </button>
            <button
              type="button"
              className={`${BTN_BASE} text-danger-fg hover:bg-danger-bg`}
            >
              Danger
            </button>
            <button
              type="button"
              disabled
              className={`${BTN_BASE} bg-bg-muted text-text-disabled cursor-not-allowed`}
            >
              Disabled
            </button>
          </div>
        </section>

        <section className="rounded-(--radius-md) border border-border-subtle bg-bg-surface shadow-(--shadow-raised) p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold">Status &amp; priority swatches</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <span className="px-2 py-1 rounded-(--radius-sm) bg-status-pending-bg text-status-pending-fg">Pending</span>
            <span className="px-2 py-1 rounded-(--radius-sm) bg-status-active-bg text-status-active-fg">Active</span>
            <span className="px-2 py-1 rounded-(--radius-sm) bg-status-completed-bg text-status-completed-fg">Completed</span>
            <span className="px-2 py-1 rounded-(--radius-sm) bg-status-discarded-bg text-status-discarded-fg">Discarded</span>
            <span className="px-2 py-1 rounded-(--radius-sm) text-priority-low">Low priority</span>
            <span className="px-2 py-1 rounded-(--radius-sm) text-priority-medium">Medium</span>
            <span className="px-2 py-1 rounded-(--radius-sm) text-priority-high">High</span>
            <span className="px-2 py-1 rounded-(--radius-sm) text-priority-critical">Critical</span>
          </div>
        </section>

        <section className="rounded-(--radius-md) border border-border-subtle bg-bg-surface shadow-(--shadow-raised) p-5 flex flex-col gap-2">
          <h2 className="text-base font-semibold">Diagnostics</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-text-tertiary">Preference</dt>
            <dd className="font-mono">{preference}</dd>
            <dt className="text-text-tertiary">Resolved</dt>
            <dd className="font-mono">{resolved}</dd>
          </dl>
        </section>
      </div>
    </main>
  );
}
