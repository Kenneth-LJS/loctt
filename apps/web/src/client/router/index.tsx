import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { Stub } from "../routes/Stub.tsx";
import { listSearchSchema } from "./listSearch.ts";

// Root just renders <Outlet />. The real app shell lands with the
// first review milestone (see TEMP-WEB-TICKETS.md).
const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <Stub name="404" />,
});

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
  path: "/list",
  validateSearch: listSearchSchema,
  component: () => <Stub name="/list" />,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board",
  component: () => <Stub name="/board" />,
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/timeline",
  component: () => <Stub name="/timeline" />,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$key",
  component: () => <Stub name="/tasks/$key" />,
});

const sprintDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sprints/$key",
  component: () => <Stub name="/sprints/$key" />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: () => <Stub name="/settings/$section" />,
});

const initRoute = createRoute({
  getParentRoute: () => rootRoute,
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

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Augment the router-wide type so `useNavigate`, `<Link>`, etc. infer
// our route shape without a second import in every file.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
