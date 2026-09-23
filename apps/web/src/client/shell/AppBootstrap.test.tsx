// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppBootstrap } from "./AppBootstrap.tsx";

/**
 * Booting against a tracker the server refuses to serve.
 *
 * The schema guard 409s *every* `/api/` route, `/api/info` included.
 * That made `info.isError` true, which rendered a full-page error —
 * so the schema banner was unreachable in exactly the situation it
 * exists to explain. SHL-13, XS-34 and XS-35 all require the opposite:
 * shell and navigation up, banner visible, data views explained
 * rather than spinning.
 */

/** The envelope the guard sends, for a given schema state. */
let MISMATCH: Record<string, unknown> | null = null;

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (MISMATCH !== null) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: "schema_mismatch",
            message: "the tracker's schema does not match this build",
            error: "the tracker's schema does not match this build",
            recovery: { kind: "none" },
            schema_status: MISMATCH,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    const body = path.startsWith("/api/views") ? { queries: [] } : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount() {
  stubFetch();
  mountBare();
}

/** Mounts without installing the shared fetch stub. */
function mountBare() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({ component: AppBootstrap });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <div>list pane</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MISMATCH = null;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppBootstrap against a refused schema", () => {
  /**
   * @verifies SHL-13, XS-34
   *
   * "The app shell and navigation still render; the banner is always
   * visible." Not a full-page error, which is what this did.
   */
  it("renders the shell with the banner rather than a fatal error page", async () => {
    MISMATCH = { kind: "future", on_disk: 5, current: 3 };
    mount();

    const banner = await screen.findByRole("alert");
    expect(banner.getAttribute("data-kind")).toBe("future");
    expect(banner.textContent).toContain("v5");
    expect(banner.textContent).toContain("v3");

    // The shell is up: navigation is present and the route rendered.
    expect(screen.getByLabelText("Toggle sidebar")).toBeTruthy();
    expect(screen.getByText("list pane")).toBeTruthy();
    // Not the fatal page.
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  /**
   * @verifies XS-33
   *
   * The kind comes from the envelope, so the four states stay
   * distinct. An earlier cut recovered it from the message text, which
   * makes a copy edit a behaviour change.
   */
  it("renders each schema kind distinctly, from the envelope", async () => {
    for (const kind of ["missing", "unknown"] as const) {
      MISMATCH = kind === "missing" ? { kind } : { kind, message: "abc" };
      mount();
      const banner = await screen.findByRole("alert");
      expect(banner.getAttribute("data-kind")).toBe(kind);
      cleanup();
    }
  });

  /**
   * @verifies SHL-13
   *
   * A guard that refused without saying which state it is in leaves
   * the surface genuinely unable to say — which is `unknown`, the one
   * kind whose copy admits that. It must not fall back to `outdated`
   * and suggest a migration for a state nobody understood.
   */
  it("falls back to `unknown` when the guard sent no status", async () => {
    // A 409 with no schema_status at all. Installed directly rather
    // than through `stubFetch`, whose spy would already own `fetch`.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "schema_mismatch",
          message: "something is off with the schema",
          error: "something is off with the schema",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    mountBare();

    const banner = await screen.findByRole("alert");
    expect(banner.getAttribute("data-kind")).toBe("unknown");
    expect(banner.textContent).toContain("something is off with the schema");
    expect(banner.textContent).not.toContain("loctt migrate");
  });
});

/**
 * XS-38: schema state is re-evaluated on refetch, not cached from the
 * first page load — in both directions. `useInfo()`'s `/api/info` read
 * is what the banner keys off; a `queryClient.invalidateQueries` here
 * stands in for whatever wakes that query in the app (the `Migrate now`
 * mutation's own `invalidateQueries`, a window-focus refetch, or the
 * background poll `queryClient.ts` runs while a query is in error).
 */
describe("AppBootstrap re-evaluates schema state on refetch (XS-38)", () => {
  function stubHealthyInfoFetch() {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (MISMATCH !== null) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: "schema_mismatch",
              message: "the tracker's schema does not match this build",
              error: "the tracker's schema does not match this build",
              recovery: { kind: "none" },
              schema_status: MISMATCH,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (path.startsWith("/api/info")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exists: true,
              initState: "ready",
              taskCount: 0,
              keyPrefix: "WEB-",
              nextKey: "WEB-1",
              schemaStatus: { kind: "current", version: 3 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      const body = path.startsWith("/api/views") ? { queries: [] } : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    });
  }

  function mountWithClient() {
    stubHealthyInfoFetch();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute({ component: AppBootstrap });
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: (s: Record<string, unknown>) => s,
      component: () => <div>list pane</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute]),
      history: createMemoryHistory({ initialEntries: ["/list"] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    return qc;
  }

  /** The schema banner specifically — `data-kind` is unique to it among
   * this shell's several `role="alert"` elements (a sidebar data-load
   * failure carries the same role). */
  const findSchemaBanner = () => screen.findByText("Schema out of date.").then(el => el.closest("[data-kind]"));

  // @verifies XS-38
  it("the banner clears on refetch once the on-disk schema is fixed, without remounting", async () => {
    MISMATCH = { kind: "outdated", on_disk: 2, current: 3 };
    const qc = mountWithClient();
    await findSchemaBanner();

    // Equivalent of `loctt migrate` having fixed it in a terminal while
    // this tab sat on the banner.
    MISMATCH = null;
    await qc.invalidateQueries({ queryKey: ["info"] });

    await screen.findByText("list pane");
    expect(screen.queryByText("Schema out of date.")).toBeNull();
  });

  // @verifies XS-38
  it("the banner appears on refetch when drift appears under a healthy session, rather than the app carrying on regardless", async () => {
    MISMATCH = null;
    const qc = mountWithClient();
    await screen.findByText("list pane");
    expect(screen.queryByText("Schema out of date.")).toBeNull();

    // Equivalent of another process (CLI/MCP) bumping the schema, or the
    // build changing, while this session was already open and healthy.
    MISMATCH = { kind: "outdated", on_disk: 2, current: 3 };
    await qc.invalidateQueries({ queryKey: ["info"] });

    const banner = await findSchemaBanner();
    expect(banner?.getAttribute("data-kind")).toBe("outdated");
  });
});

/**
 * @verifies XS-37, SHL-37
 *
 * A crashed migration is the one schema state where the app must not
 * stay browsable — the tracker may be half-rewritten, so there is
 * nothing safe to show and nothing safe to click.
 *
 * SHL-37 is the same condition stated from the shell's side: "a
 * distinct screen from SHL-34/35/36, not a variant of the banner",
 * reporting the sentinel's `from`, `to` and backup path, with no
 * one-click fix. The assertions below cover both readings.
 */
describe("AppBootstrap with an interrupted migration", () => {
  const SENTINEL = "/tmp/tracker/.loctt/.schema-migration-in-progress";
  const BACKUP = "/tmp/tracker/.loctt.backup-v1-20260828-abc123";

  it("renders its own blocking screen, not the schema banner", async () => {
    MISMATCH = {
      kind: "interrupted",
      from: 1,
      to: 2,
      backup: BACKUP,
      sentinel_path: SENTINEL,
    };
    mount();

    const screenEl = await screen.findByRole("alert");
    expect(screenEl.getAttribute("data-kind")).toBe("interrupted");
    expect(screenEl.textContent).toMatch(/did not finish/i);

    // A distinct screen, not a banner over a live shell: no navigation
    // and no route content behind it.
    expect(screen.queryByLabelText("Toggle sidebar")).toBeNull();
    expect(screen.queryByText("list pane")).toBeNull();
  });

  it("shows the recorded versions, the backup path, and the sentinel path", async () => {
    MISMATCH = {
      kind: "interrupted",
      from: 1,
      to: 2,
      backup: BACKUP,
      sentinel_path: SENTINEL,
    };
    mount();

    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).toContain("v1");
    expect(text).toContain("v2");
    expect(text).toContain(BACKUP);
    expect(text).toContain(SENTINEL);
  });

  it("offers no one-click fix at all", async () => {
    MISMATCH = {
      kind: "interrupted",
      from: 1,
      to: 2,
      backup: BACKUP,
      sentinel_path: SENTINEL,
    };
    mount();
    await screen.findByRole("alert");

    // No Retry, no Migrate now, no Continue anyway, no Dismiss — a
    // single click here would resume against a half-migrated tracker.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says what to do when the sentinel recorded no backup", async () => {
    MISMATCH = { kind: "interrupted", sentinel_path: SENTINEL };
    mount();

    const text = (await screen.findByRole("alert")).textContent ?? "";
    // It must not print "undefined" where the path would be.
    expect(text).not.toContain("undefined");
    expect(text).toMatch(/not recorded/i);
    expect(text).toContain(SENTINEL);
  });

  /**
   * @verifies SET-31
   *
   * The other three tests in this block cover "dedicated state, not
   * the schema banner over a working UI" and "no one-click fix". This
   * one covers the two bullets they don't: the screen states that the
   * user must investigate before continuing, and it gives the CLI
   * recovery path (`loctt migrate`, `loctt doctor`) rather than
   * leaving recovery to guesswork.
   */
  it("states that the user must investigate before continuing and gives the CLI recovery path", async () => {
    MISMATCH = {
      kind: "interrupted",
      from: 1,
      to: 2,
      backup: BACKUP,
      sentinel_path: SENTINEL,
    };
    mount();

    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).toMatch(/resolved by hand|by hand/i);
    expect(text).toContain("loctt migrate");
    expect(text).toContain("loctt doctor");
  });
});
