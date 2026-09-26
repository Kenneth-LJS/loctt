import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { BoardView } from "../board/BoardView.tsx";
import { RegionErrorFallback } from "../error/RegionErrorBoundary.tsx";
import { ListView } from "../list/ListView.tsx";
import { MilestoneDetail } from "../milestones/MilestoneDetail.tsx";
import { MilestonesView } from "../milestones/MilestonesView.tsx";
import { NotFound } from "../routes/NotFound.tsx";
import { DEFAULT_SECTION } from "../settings/sections.ts";
import { SettingsShell } from "../settings/SettingsShell.tsx";
import { AppBootstrap } from "../shell/AppBootstrap.tsx";
import { SprintDetail } from "../sprints/SprintDetail.tsx";
import { SprintsView } from "../sprints/SprintsView.tsx";
import { TaskDetail } from "../task/TaskDetail.tsx";
import { TimelineView } from "../timeline/TimelineView.tsx";
import { listSearchSchema } from "./listSearch.ts";
import { taskDetailSearchSchema } from "./taskDetailSearch.ts";
import { timelineSearchSchema } from "./timelineSearch.ts";

// The root renders the app shell (header + sidebar + chrome) via
// AppBootstrap, which gates on tracker info + current user and renders
// the matched child route through its own <Outlet />. Child routes
// (list/board/…) render inside the main pane.
const rootRoute = createRootRoute({
  component: AppBootstrap,
  // SHL-16/SHL-30: a designed 404 *inside* the shell. The stub that
  // used to sit here read "Route stub: 404", which names neither the
  // problem nor the path and offers no way out.
  notFoundComponent: NotFound,
  // A320: previously deliberately omitted, on the reasoning that the
  // root route's component *is* the shell, so an error component here
  // replaces the shell — header and sidebar included — which is the
  // white page SHL-42 and ERR-34 both rule out.
  //
  // That reasoning covered a throw from a *child* route, which already
  // has its own `errorComponent` (`RouteError`, below) catching it
  // before it reaches here. It did not cover a throw from the shell
  // itself — `AppBootstrap`/`AppShell`/`Header`, which render *above*
  // the child outlet. Ken's screenshot: a throw from `Header.tsx`
  // (inside the shell, above the outlet) had no boundary above it at
  // all, so it escaped every boundary this app owns and hit TanStack
  // Router's own built-in fallback ("Something went wrong!" / "Hide
  // Error" / the raw error, full-span, top-left, unstyled).
  //
  // So this is the true last resort — the shell is already gone by
  // the time it renders, there being no shell left to preserve — and
  // it must not depend on anything the shell's own providers supply.
  // `RootError` is checked against exactly that: it renders below
  // `QueryClientProvider` (`App.tsx` puts that above `RouterProvider`)
  // and below `RouterProvider` itself, but above `AppShell`'s
  // `CreateTaskProvider`/`ToastProvider`/`AnnouncerProvider` and every
  // shell-local hook (`useTheme`, `useSidebarCollapse`, …) — it uses
  // none of those, only `window.location.reload()`, which is exactly
  // how a throw from `Header.tsx` escaped in the first place.
  errorComponent: RootError,
});

/**
 * The main pane's boundary. Named per-route so the message says "the
 * task list" rather than a component name (ERR-36).
 *
 * Exported for its own test: the two decisions it encodes — suppress
 * the back link on `/list`, suppress the narrow retry at every route —
 * live *here*, not in the fallback, so a test of `RegionErrorFallback`
 * alone proves the fallback can render both shapes without proving
 * this caller asks for the right one. Deleting `offerRetry={false}`
 * below was measured against the whole web suite and broke nothing.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const region = ROUTE_REGIONS[pathname] ?? "this page";
  return (
    <RegionErrorFallback
      region={region}
      error={error}
      componentStack={null}
      writeInFlight={false}
      // Not on `/list` itself: offering to navigate to the page the
      // user is already on is not a way out (SHL-42).
      offerListLink={pathname !== "/list"}
      // No narrow retry at route level (Ken's call). `reset` remounts
      // the route with the same props and the same data, and a
      // route-level render crash is rarely state-dependent — so the
      // button overwhelmingly refires the crash it claims to fix.
      // Reload, plus a way out, is what this scope can honestly offer.
      offerRetry={false}
      // A320: the whole main pane is gone, so the fallback reads as a
      // bounded, centered content box rather than a full-span block.
      fullPage
      onRetry={reset}
    />
  );
}

/** User-facing names for the routes, for the boundary's headline. */
const ROUTE_REGIONS: Record<string, string> = {
  "/list": "the task list",
  "/board": "the board",
  "/timeline": "the timeline",
  "/sprints": "the sprints view",
  "/milestones": "the milestones view",
};

/**
 * A320: the root route's `errorComponent` — the true last resort for a
 * throw escaping the app shell itself (`AppBootstrap`/`AppShell`/
 * `Header`), which render above the child outlet and so above every
 * other boundary this app owns.
 *
 * Deliberately independent of the shell it is standing in for: no
 * `useCreateTask`/`useAnnouncer`/`useTheme`/`useSidebarCollapse`, none
 * of `AppShell`'s own providers — a throw from inside the shell means
 * none of that is known to be safe to call. `RouterProvider` and
 * `QueryClientProvider` are still above this (`App.tsx`), so `Link`
 * resolves, but nothing shell-scoped is assumed.
 *
 * Reuses `RegionErrorFallback` in its `fullPage` shape rather than a
 * second hand-rolled screen — restyling the one full-page variant is
 * the point of A320, not growing a third look.
 */
export function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <RegionErrorFallback
      region="the app"
      error={error}
      componentStack={null}
      writeInFlight={false}
      // The shell (sidebar, header) is exactly what may be gone —
      // there is no list to point "back" to that is any more trustworthy
      // than the reload this already offers.
      offerListLink={false}
      offerRetry={false}
      fullPage
      onRetry={reset}
    />
  );
}

// `/` redirects to `/list`. TanStack Router uses `throw redirect(...)`
// to short-circuit the loader chain — the thrown value is a
// recognized signal, not an exception, hence the eslint suppression.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/list", replace: true });
  },
});

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/list",
  validateSearch: listSearchSchema,
  component: ListView,
});

// M3.1: the board reads the *same* search vocabulary as the list
// (BRD-1, BRD-14), so a filter means the same thing in both views and
// a `/board?assignee=…` URL reproduces the filtered board. Sharing the
// schema is what makes that true by construction rather than by two
// definitions agreeing for now.
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/board",
  validateSearch: listSearchSchema,
  component: BoardView,
});

// M3.3: the timeline extends the list's search vocabulary rather than
// forking it, for the same reason the board shares it outright — a
// filter must mean the same thing in every view. The three extra
// params (zoom, grouping, arrows) are in the URL because TML-1, TML-3,
// TML-8 and TML-15 each require that state to be shareable.
const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/timeline",
  validateSearch: timelineSearchSchema,
  component: TimelineView,
});

// M2.1: the real read shell. The `$key` param is a *ref* — a current
// key, a retired key, or a ULID — because the server resolves all
// three and TSK-2 needs the retired one to keep working.
//
// `errorComponent` stays, but a 404 must never reach it: the boundary
// replaces the main pane with a crash surface, and ERR-8 requires a
// designed not-found state that a user can tell apart from a crash.
// `TaskDetail` therefore renders its own not-found on a resolved 404
// rather than throwing.
const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/tasks/$key",
  // CMT-18: the open activity tab (Comments/Activity/All) records itself
  // in `?tab=`, so a link opens on that tab. Garbage → undefined → the
  // default tab, without throwing the route down.
  validateSearch: taskDetailSearchSchema,
  component: function TaskDetailRoute() {
    const { key } = taskDetailRoute.useParams();
    const { tab, rekeyedFrom, rekeyedWhileOpen } = taskDetailRoute.useSearch();
    // Keyed on the ref so navigating between tasks remounts rather
    // than reusing the previous task's component state — a stale
    // "Copied" toast or a half-open dialog carrying over to a
    // different task is state the URL does not describe.
    return (
      <TaskDetail
        key={key}
        taskRef={key}
        {...(tab !== undefined ? { activityTab: tab } : {})}
        {...(rekeyedFrom !== undefined ? { rekeyedFrom } : {})}
        {...(rekeyedWhileOpen === true ? { rekeyedWhileOpen } : {})}
      />
    );
  },
});

// M3.5: the sprints overview. `/sprints/$key` below is M4.7's detail
// and burndown, and is a separate route — a `$key` param cannot also
// match the bare path.
const sprintsRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/sprints",
  component: SprintsView,
});

// M4.7: the sprint detail. `$key` is the sprint's **ULID** (decision
// V3) — names are neither unique nor immutable, so a name in the path
// would break on rename and be ambiguous between two sprints sharing
// one. SPR-1's "never the ULID" is about the column header, which
// shows the name; it does not govern the address bar.
//
// It shares `listSearchSchema` with `/list` for the same reason the
// board does: SPR-13 requires the filter bar's vocabulary and query
// semantics to be the list's, with no sprint-only dialect. The sprint
// scope itself is *not* a search param — it is the route param, so no
// filter edit can drop it.
const sprintDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/sprints/$key",
  validateSearch: listSearchSchema,
  component: function SprintDetailRoute() {
    const { key } = sprintDetailRoute.useParams();
    // Keyed on the id so navigating between sprints remounts rather
    // than carrying the previous sprint's draft edits into the next
    // one's header.
    return <SprintDetail key={key} sprintId={key} />;
  },
});

// M4.9: the milestones progress view. Distinct from Settings →
// Milestones (M4.3), which manages the entries; this reads them.
const milestonesRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/milestones",
  component: MilestonesView,
});

// M4.9: the milestone detail. `$id` is the milestone's **ULID**
// (decision V3). `MilestoneDef` has no `key` at all, so unlike a task
// there is no user-facing identifier a route could carry instead — and
// a `name` is neither unique nor immutable. MSL-1's "never the ULID"
// governs the row's name, not the address bar (P-4 is scoped to UI
// content).
//
// It shares `listSearchSchema` with `/list` for the same reason the
// sprint detail does: the scoped task list must speak the list's
// filter vocabulary rather than a milestone-only dialect. The
// milestone scope is the route param, not a search param, so no filter
// edit can drop it.
const milestoneDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/milestones/$id",
  validateSearch: listSearchSchema,
  component: function MilestoneDetailRoute() {
    const { id } = milestoneDetailRoute.useParams();
    // Keyed on the id so navigating between milestones remounts
    // rather than carrying the previous one's state into the next.
    return <MilestoneDetail key={id} milestoneId={id} />;
  },
});

// SET-1's first bullet: "Landing on `/settings` redirects to a concrete
// section rather than rendering an empty pane." Without this route the
// bare path fell through to the app-level 404 — so `/settings/typo`
// rendered the settings shell with its nav intact while the canonical
// `/settings` did not. The typo'd URL was handled better than the real
// one, and SET-1's tagged test never requested the bare path.
const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/settings/$section",
      params: { section: DEFAULT_SECTION },
      replace: true,
    });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/settings/$section",
  component: function SettingsSection() {
    const { section } = settingsRoute.useParams();
    return <SettingsShell section={section} />;
  },
});

// `/init` is a real path so the address bar can say it (ONB-1) and so
// a deep link to it resolves — but nothing renders *here*.
//
// Both of its states are owned by `AppBootstrap`, above the outlet:
// when there is no tracker it renders the wizard, and when there is
// one it renders the shell, whose `RedirectFromInit` sends `/init` on
// to `/list` (ONB-27, ONB-35). Keeping the decision in one place is
// what stops the two answers disagreeing — a route-level check would
// need the same `initState` read and could reach a different verdict
// while the query is in flight.
const initRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/init",
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  listRoute,
  boardRoute,
  timelineRoute,
  taskDetailRoute,
  sprintsRoute,
  sprintDetailRoute,
  milestonesRoute,
  milestoneDetailRoute,
  settingsIndexRoute,
  settingsRoute,
  initRoute,
]);

/**
 * Search params are serialized as flat `key=value` pairs, with arrays
 * comma-joined — `?status=in_progress,done`, per LST-9.
 *
 * TanStack's default stringifier JSON-encodes anything non-primitive,
 * which turns a one-value filter into `?status=%5B%22done%22%5D`. That
 * round-trips through its own parser, so nothing breaks — but it is not
 * the documented format, it is unpleasant to share, and `listSearch.ts`
 * already defines the CSV form its `csv` schema parses. Wiring it here
 * rather than per-route keeps one format across the app.
 *
 * Parsing stays permissive: values arrive as plain strings and each
 * route's `validateSearch` splits and coerces them. A value that
 * happens to contain a comma survives, because splitting is the
 * schema's job, not the router's.
 */
function stringifySearch(search: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.map(String).join(","));
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sp.set(key, String(value));
    } else {
      // Objects have no useful flat form. JSON-encode rather than emit
      // "[object Object]", so an unexpected shape is at least
      // recoverable by the parser below.
      sp.set(key, JSON.stringify(value));
    }
  }
  // URLSearchParams percent-encodes commas (`%2C`), which round-trips
  // correctly but defeats the point: LST-9 asks for a URL a human can
  // read and share. A comma is legal unencoded in a query string
  // (RFC 3986 sub-delims), so restore it. Only the separator is
  // touched — a comma *inside* a value was encoded by the same call and
  // is indistinguishable here, which is why values containing commas
  // are not a supported filter shape.
  const qs = sp.toString().replace(/%2C/g, ",");
  return qs.length > 0 ? `?${qs}` : "";
}

function parseSearch(searchStr: string): Record<string, unknown> {
  const sp = new URLSearchParams(
    searchStr.startsWith("?") ? searchStr.slice(1) : searchStr,
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of sp.entries()) {
    // A JSON-encoded value from a previously-shared URL still parses,
    // so old links keep working.
    if (value.startsWith("[") || value.startsWith("{")) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        // Not JSON after all — fall through and keep the raw string.
      }
    }
    out[key] = value;
  }
  return out;
}

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  stringifySearch,
  parseSearch,
  // A320: the router-wide fallback for a route that ships without its
  // own `errorComponent` (every route above sets one, and the root's
  // own `errorComponent` — `RootError` — already covers a throw from
  // the shell). Belt and suspenders: TanStack's own built-in fallback
  // ("Something went wrong!" / "Hide Error") must never be what a user
  // sees, on *any* path this router owns, not only the ones a human
  // remembered to wire up.
  defaultErrorComponent: RootError,
  /**
   * Scroll restoration is *not* the router's here — see
   * `useMainScrollRestoration`. The option resolves the saved element
   * by selector at restore time, and the main pane's rows mount after
   * the route change, so the element it finds has no height yet and
   * the assignment is discarded. Enabling it as well would install a
   * second mechanism that silently loses to the first.
   */
});

// Augment the router-wide type so `useNavigate`, `<Link>`, etc. infer
// our route shape without a second import in every file.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
