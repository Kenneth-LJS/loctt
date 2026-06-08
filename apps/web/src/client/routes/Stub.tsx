/**
 * Placeholder rendered by every route until the real view lands.
 * Intentionally bare — the app shell, sidebar, header, theme picker,
 * etc. are all part of the first review milestone (see
 * TEMP-WEB-TICKETS.md). Nothing here is reviewable UI.
 */
export function Stub({ name }: { name: string }) {
  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary flex items-center justify-center p-8 font-sans">
      <div className="text-text-tertiary text-sm">
        Route stub: <code className="font-mono">{name}</code>
      </div>
    </main>
  );
}
