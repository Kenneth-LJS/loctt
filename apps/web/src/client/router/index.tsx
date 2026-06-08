import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { ListView } from "../list/ListView.tsx";
import { Stub } from "../routes/Stub.tsx";
import { AppBootstrap } from "../shell/AppBootstrap.tsx";
import { listSearchSchema } from "./listSearch.ts";

// The root renders the app shell (header + sidebar + chrome) via
// AppBootstrap, which gates on tracker info + current user and renders
// the matched child route through its own <Outlet />. Child routes
// (list/board/…) render inside the main pane.
const rootRoute = createRootRoute({
  component: AppBootstrap,
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
  component: ListView,
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
