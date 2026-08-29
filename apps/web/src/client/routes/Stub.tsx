/**
 * Placeholder rendered by every route until the real view lands.
 * Intentionally bare — the app shell, sidebar, header, theme picker,
 * etc. are all part of the first review milestone (see
 * TEMP-WEB-TICKETS.md). Nothing here is reviewable UI.
 */
export function Stub({ name }: { name: string }) {
  return (
    // A `div`, not a `main`: this renders *inside* the shell's own
    // `<main>`, and two nested landmarks is invalid HTML that leaves a
    // screen reader with an ambiguous main region. `min-h-screen` goes
    // for the same reason — the shell owns the page height.
    <div className="grid h-full place-items-center bg-bg-canvas p-8 font-sans text-text-primary">
      <div className="text-text-tertiary text-sm">
        Route stub: <code className="font-mono">{name}</code>
      </div>
    </div>
  );
}
