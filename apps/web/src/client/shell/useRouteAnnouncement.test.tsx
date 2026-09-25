// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjects } from "../api/hooks/sidebarData.ts";
import { listSearchSchema } from "../router/listSearch.ts";
import { AnnouncerProvider } from "../ui/Announcer.tsx";
import { useRouteAnnouncement } from "./useRouteAnnouncement.ts";

/**
 * @verifies SHL-11, SHL-31
 *
 * The document title carries the project name, so a user with two
 * `loctt ui` windows open can tell them apart from the window title /
 * tab strip alone. These assert the *rendered* `document.title`, not
 * that the hook consulted the projects query — a title that is only
 * "computed" is a title nobody can read.
 */

/** Projects returned by the stubbed `/api/projects`, per-test. */
let PROJECTS: { id: string; name: string; prefix: string }[] = [];

/** `effective_default` from `/api/projects`, per-test. */
let EFFECTIVE_DEFAULT: string | null = null;

/**
 * When set, `/api/projects` does not resolve until this promise does —
 * so the late-resolve test can observe the pre-query title without
 * racing the response. `undefined` (the default) resolves immediately.
 */
let PROJECTS_GATE: Promise<void> | undefined;

function stubFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = raw.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/projects") && PROJECTS_GATE !== undefined) {
      await PROJECTS_GATE;
    }
    const body = path.startsWith("/api/projects")
      ? {
          items: PROJECTS,
          total: PROJECTS.length,
          offset: 0,
          limit: 1000,
          default: EFFECTIVE_DEFAULT,
          effective_default: EFFECTIVE_DEFAULT,
        }
      : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function Probe() {
  useRouteAnnouncement();
  const { isSuccess } = useProjects();
  // The projects query's settled state, exposed to the DOM. A fallback
  // assertion made before the query resolves passes against the
  // pre-query title and proves nothing — measured: the multi-filter
  // test stayed green with the multi-filter rule deliberately broken,
  // because `waitFor` matched on its first poll. Tests gate on this.
  return <main id="main-content" tabIndex={-1} data-projects-settled={String(isSuccess)} />;
}

/** Resolves once `/api/projects` has settled and the title reflects it. */
async function settled(): Promise<void> {
  await waitFor(() => {
    expect(
      document.querySelector('[data-projects-settled="true"]'),
    ).not.toBeNull();
  });
}

function renderAt(url: string): void {
  stubFetch();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rootRoute = createRootRoute();
  const anyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    // The app's real search schema, so `?project=a,b` arrives as the
    // array the hook reads rather than a raw string an identity
    // validator would hand it.
    validateSearch: listSearchSchema,
    component: Probe,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([anyRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <AnnouncerProvider>
        <RouterProvider router={router as never} />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
}

describe("document title names the project (SHL-11, SHL-31)", () => {
  beforeEach(() => {
    PROJECTS = [
      { id: "p_web", name: "Web", prefix: "WEB-" },
      { id: "p_api", name: "API", prefix: "API-" },
    ];
    EFFECTIVE_DEFAULT = "p_web";
    PROJECTS_GATE = undefined;
    document.title = "";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("names the sole filtered project on a board", async () => {
    renderAt("/board?project=p_api");
    await waitFor(() => {
      expect(document.title).toBe("LocTT · API · Board");
    });
  });

  it("names the workspace default when nothing is filtered", async () => {
    renderAt("/list");
    await waitFor(() => {
      expect(document.title).toBe("LocTT · Web · List");
    });
  });

  it("falls back to the view alone when two projects are filtered", async () => {
    renderAt("/list?project=p_web,p_api");
    await settled();
    expect(document.title).toBe("List · LocTT");
    // Specifically not a double separator or a placeholder segment.
    expect(document.title).not.toContain("—  —");
  });

  it("falls back to the view alone on a tracker with no projects", async () => {
    PROJECTS = [];
    EFFECTIVE_DEFAULT = null;
    renderAt("/list");
    await settled();
    expect(document.title).toBe("List · LocTT");
  });

  it("falls back to the view alone when the filtered id resolves to nothing", async () => {
    renderAt("/list?project=p_gone");
    await settled();
    expect(document.title).toBe("List · LocTT");
  });

  it("names the project alone on an unmatched route", async () => {
    renderAt("/nowhere");
    await waitFor(() => {
      expect(document.title).toBe("LocTT · Web");
    });
  });

  it("is the bare app name on an unmatched route with no project", async () => {
    PROJECTS = [];
    EFFECTIVE_DEFAULT = null;
    renderAt("/nowhere");
    await settled();
    expect(document.title).toBe("LocTT");
  });

  /**
   * The projects query resolves after the first paint. If the effect
   * did not depend on the resolved name, the title would stay at the
   * fallback for the life of the window — which is the whole defect
   * SHL-31 reports, arriving one tick late.
   */
  it("picks the name up when the projects query resolves late", async () => {
    let release = (): void => {};
    PROJECTS_GATE = new Promise<void>(resolve => { release = resolve; });

    renderAt("/board");
    // The first pass runs before the query settles, and already sets a
    // usable title rather than leaving the tab blank. The gate holds
    // the response open so this is observed, not raced.
    await waitFor(() => {
      expect(document.title).toBe("Board · LocTT");
    });

    release();
    await waitFor(() => {
      expect(document.title).toBe("LocTT · Web · Board");
    });
  });
});
