import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { BoardView } from "../board/BoardView.tsx";
import { RegionErrorFallback } from "../error/RegionErrorBoundary.tsx";
import { ListView } from "../list/ListView.tsx";
import { NotFound } from "../routes/NotFound.tsx";
import { Stub } from "../routes/Stub.tsx";
import { AppBootstrap } from "../shell/AppBootstrap.tsx";
import { TaskDetail } from "../task/TaskDetail.tsx";
import { TimelineView } from "../timeline/TimelineView.tsx";
import { listSearchSchema } from "./listSearch.ts";
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
  // Deliberately no `errorComponent` here.
  //
  // The root route's component *is* the shell, so an error component
  // on it replaces the shell — header and sidebar included. That is
  // the white page SHL-42 and ERR-34 both rule out, and it is what
  // this did until the browser spec caught it: the boundary rendered
  // the right words with nothing around them.
  //
  // The boundary belongs on the child routes, which render inside the
  // root's outlet, so a throw takes the main pane and leaves the
  // chrome.
});

/**
 * The main pane's boundary. Named per-route so the message says "the
 * task list" rather than a component name (ERR-36).
 */
function RouteError({ error, reset }: { error: Error; reset: () => void }) {
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
      onRetry={reset}
    />
  );
}

/** User-facing names for the routes, for the boundary's headline. */
const ROUTE_REGIONS: Record<string, string> = {
  "/list": "the task list",
  "/board": "the board",
  "/timeline": "the timeline",
};

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
  component: function TaskDetailRoute() {
    const { key } = taskDetailRoute.useParams();
    // Keyed on the ref so navigating between tasks remounts rather
    // than reusing the previous task's component state — a stale
    // "Copied" toast or a half-open dialog carrying over to a
    // different task is state the URL does not describe.
    return <TaskDetail key={key} taskRef={key} />;
  },
});

const sprintDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/sprints/$key",
  component: function SprintDetailStub() {
    const { key } = sprintDetailRoute.useParams();
    return <Stub name={`/sprints/${key}`} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/settings/$section",
  component: () => <Stub name="/settings/$section" />,
});

const initRoute = createRoute({
  getParentRoute: () => rootRoute,
  errorComponent: RouteError,
  path: "/init",
  component: () => <Stub name="/init" />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  listRoute,
  boardRoute,
  timelineRoute,
  taskDetailRoute,
  sprintDetailRoute,
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
