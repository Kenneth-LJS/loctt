import { Link } from "@tanstack/react-router";

/**
 * The task-not-found state (TSK-45, ERR-7, ERR-8, SHL-44, XS-58).
 *
 * Four things this has to get right, each of which was a named
 * failure before it existed:
 *
 *  - It renders **in the main pane**, inside the shell. The route's
 *    error boundary would take the pane too, but a 404 is not a crash,
 *    and the two must not look alike (ERR-8). This is reached on a
 *    resolved 404 rather than by throwing, so the boundary never sees
 *    it.
 *  - It **names the key**, never a ULID (ERR-7's first bullet, P-4).
 *  - It says "no such key", which is a different claim from "not
 *    loaded" (SHL-44) and from "the server is unreachable" (TSK-53).
 *    An unreachable server never reaches this component — it has no
 *    `not_found` envelope — so the two states cannot collapse into
 *    one by accident.
 *  - It offers a way back rather than redirecting. A silent redirect
 *    hides that a shared link is dead, which is exactly what the
 *    person who was sent the link needs to know (SHL-44).
 *
 * The breadcrumb and meta panel are *not* rendered here: TSK-45
 * requires they not appear empty as though a task had loaded.
 */
export function TaskNotFound({ taskKey }: { readonly taskKey: string }) {
  return (
    <div role="alert" className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-lg font-semibold text-text-primary">
          No task with the key{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[1.0714rem]">
            {taskKey}
          </code>
        </h1>
        <p className="mb-1 text-[0.9286rem] text-text-secondary">
          Nothing in this tracker uses that key — not as a current key,
          and not as a retired one.
        </p>
        {/* "where the app can tell" (ERR-7): the app cannot distinguish
            a key that was never allocated from one deleted elsewhere,
            because both answer 404. Naming both possibilities is
            honest; asserting either would not be. */}
        <p className="mb-4 text-[0.9286rem] text-text-tertiary">
          The task may have been deleted from the CLI or another
          surface, or the link may have a typo.
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
