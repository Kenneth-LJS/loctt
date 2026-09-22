/**
 * K107 + K100. A settings panel defaults to the `active` archived scope,
 * so the server does not return archived rows — but a deep link like
 * `/settings/milestones#row-<id>` may target an archived row, which
 * `useScrollToHash` then cannot find. When a `#row-…` hash is present on
 * load we widen the panel's fetch to `all` so the anchor resolves.
 *
 * Read from `window.location.hash` once (via a `useState` initializer at
 * the call site), not from the router: a deep link already carries its
 * hash on first render, so a single read at mount is enough, and it keeps
 * these panels free of a `RouterProvider` requirement in their unit tests.
 * SprintsPanel keeps the reactive `useRouterState` read instead, because
 * its own K100 test drives the hash through a memory history.
 */
export function hashDeepLinkPresent(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.location.hash.replace(/^#/, "");
  return raw !== "";
}
