// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar.tsx";
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_STEP } from "./useSidebarWidth.ts";

/**
 * The resize handle (drag-to-resize + keyboard) on the expanded, in-grid,
 * desktop sidebar. Kept in its own file rather than added to Sidebar.test
 * so the width fixture (viewport, localStorage) is isolated from the
 * group-rendering fixtures there.
 */

/** Empty-ish config for every sidebar query so groups render without noise. */
function routeFetch(path: string): unknown {
  if (path.startsWith("/api/projects")) return { items: [], total: 0, offset: 0, limit: 100, default: null };
  if (path.startsWith("/api/views")) return { queries: [] };
  if (path.startsWith("/api/milestones")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/sprints")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/labels")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/recents")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/user-settings")) return { user: "u_ken", settings: {} };
  if (path.startsWith("/api/workflow")) return { statuses: [], priorities: [], task_types: [] };
  if (path.startsWith("/api/tasks")) return { total: 0 };
  return {};
}

function setWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  setWidth(1400); // wide, so the sidebar is the in-grid column, not the overlay
  // useIsNarrow prefers matchMedia when present; jsdom has none, so it
  // falls back to innerWidth. Ensure matchMedia is absent for that path.
  // (Sidebar's useIsNarrow uses innerWidth directly.)
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function renderSidebar(collapsed: boolean): Promise<void> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <Sidebar collapsed={collapsed} currentUserId="u_ken" today="2026-06-08" />,
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
  await screen.findByRole("separator", { name: "Resize sidebar" }).catch(() => undefined);
}

describe("Sidebar resize handle", () => {
  it("renders when expanded and wide, with the persisted width applied", async () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    // The aside carries the persisted width as an inline style.
    const aside = handle.closest("aside");
    expect(aside).not.toBeNull();
    expect(aside?.style.width).toBe("320px");
  });

  it("is absent when collapsed", async () => {
    await renderSidebar(true);
    // Groups have rendered (fetch resolved); the handle is not present.
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  });

  it("nudges width on ArrowRight / ArrowLeft and persists", async () => {
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_SIDEBAR_WIDTH));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_SIDEBAR_WIDTH + SIDEBAR_WIDTH_STEP));
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(DEFAULT_SIDEBAR_WIDTH + SIDEBAR_WIDTH_STEP));
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_SIDEBAR_WIDTH));
  });

  it("jumps to max on End", async () => {
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(MAX_SIDEBAR_WIDTH));
  });

  it("jumps to min on Home", async () => {
    // End is covered above; Home (MIN_SIDEBAR_WIDTH) was not — the Home
    // branch of the handle's keydown had no test. Start above the min so
    // the jump is observable.
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, "320");
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle.getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(MIN_SIDEBAR_WIDTH));
  });

  it("does not render the handle in the mobile overlay (expanded + narrow)", async () => {
    // The `is absent when collapsed` test above covers the `!collapsed`
    // term of `inGridExpanded`; the `!overlay` term was untested. On a
    // narrow viewport an EXPANDED sidebar is the floating overlay drawer,
    // not the in-grid column — so it has no resize handle. NARROW_PX is
    // 900 in Sidebar; render below it and expanded to hit the overlay path.
    setWidth(700);
    await renderSidebar(false);
    // A positive control: the overlay drawer itself rendered (its close
    // button is unique to the overlay), so a missing handle is the
    // overlay branch, not an unrendered sidebar.
    expect(screen.getByTestId("sidebar-overlay-close")).toBeTruthy();
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  });

  it("suppresses the width transition during a drag and restores it after", async () => {
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    const aside = handle.closest("aside") as HTMLElement;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    // Before any drag the width animates the collapse/expand.
    expect(aside.className).toContain("transition-[width]");

    // While dragging the transition is removed so the column tracks the
    // pointer 1:1 instead of easing toward it.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: DEFAULT_SIDEBAR_WIDTH });
    expect(aside.className).not.toContain("transition-[width]");

    // Releasing ends the drag and the transition returns.
    fireEvent(handle, new PointerEvent("pointerup", { pointerId: 1 } as PointerEventInit));
    expect(aside.className).toContain("transition-[width]");
  });

  it("resizes from a pointer drag, clamped to the max", async () => {
    await renderSidebar(false);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    const aside = handle.closest("aside") as HTMLElement;
    // The sidebar's left edge is the resize origin. jsdom reports 0 for
    // getBoundingClientRect, so a pointer at clientX = N yields width N.
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: DEFAULT_SIDEBAR_WIDTH });
    // Drag right to 300px.
    fireEvent(handle, new PointerEvent("pointermove", { clientX: 300 } as PointerEventInit));
    expect(aside.style.width).toBe("300px");
    // Drag well past the max — clamped.
    fireEvent(handle, new PointerEvent("pointermove", { clientX: 9999 } as PointerEventInit));
    expect(aside.style.width).toBe(`${MAX_SIDEBAR_WIDTH}px`);
    fireEvent(handle, new PointerEvent("pointerup", { pointerId: 1 } as PointerEventInit));
    // Persisted at the clamped value.
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(MAX_SIDEBAR_WIDTH));
  });
});
