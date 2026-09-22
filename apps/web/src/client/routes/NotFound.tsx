import { Link, useRouterState } from "@tanstack/react-router";

/**
 * The 404 state for an unmatched route (SHL-16).
 *
 * Renders *inside* the shell — the root route owns the header and
 * sidebar, and this is its `notFoundComponent`, so navigation stays
 * available. That matters more than the copy: a 404 that replaces the
 * whole page leaves the user with the browser's Back button as their
 * only exit, which SHL-30 also rules out.
 *
 * The requested path is named because a mistyped or stale link is the
 * usual cause, and the user cannot tell which without seeing what was
 * actually asked for.
 */
export function NotFound() {
  const pathname = useRouterState({ select: s => s.location.pathname });

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-lg font-semibold text-text-primary">
          That page doesn&rsquo;t exist
        </h1>
        <p className="mb-1 text-[0.9286rem] text-text-secondary">
          Nothing is routed at{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
            {pathname}
          </code>
          .
        </p>
        <p className="mb-4 text-[0.9286rem] text-text-tertiary">
          The link may be out of date, or the path may have a typo.
        </p>
        <Link
          to="/list"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast no-underline hover:bg-accent-hover"
        >
          Go to the task list
        </Link>
      </div>
    </div>
  );
}
