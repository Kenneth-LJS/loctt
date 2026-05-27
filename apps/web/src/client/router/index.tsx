import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { BoardView } from "../routes/BoardView.tsx";
import { InitView } from "../routes/InitView.tsx";
import { ListView } from "../routes/ListView.tsx";
import { NotFoundView } from "../routes/NotFoundView.tsx";
import { SettingsView } from "../routes/SettingsView.tsx";
import { SprintDetailView } from "../routes/SprintDetailView.tsx";
import { TaskDetailView } from "../routes/TaskDetailView.tsx";
import { TimelineView } from "../routes/TimelineView.tsx";
import { listSearchSchema } from "./listSearch.ts";

// Root holds the app shell once T1.1 lands. For now it just renders
// <Outlet /> so child routes mount directly under <body>.
const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <NotFoundView />,
});

// `/` redirects to `/list` per spec (the list view is the default
// landing page). TanStack Router uses `throw redirect(...)` to short-
// circuit the loader chain — the thrown value is a recognized signal,
// not an exception, hence the eslint suppression.
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
  component: BoardView,
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/timeline",
  component: TimelineView,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$key",
  component: TaskDetailView,
});

const sprintDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sprints/$key",
  component: SprintDetailView,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: SettingsView,
});

const initRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/init",
  component: InitView,
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
