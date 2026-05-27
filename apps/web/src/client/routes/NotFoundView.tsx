import { Link } from "@tanstack/react-router";

export function NotFoundView() {
  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary flex items-center justify-center p-8">
      <div className="rounded-md border border-border-subtle bg-bg-surface shadow-raised p-8 max-w-md flex flex-col gap-3 text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-text-tertiary text-sm">
          The URL you tried doesn't match any route in this LocTT tracker.
        </p>
        <Link
          to="/list"
          className="self-center mt-2 px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          Back to the list
        </Link>
      </div>
    </main>
  );
}
