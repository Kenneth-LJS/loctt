// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MilestoneDetail } from "./MilestoneDetail.tsx";

/**
 * MilestoneDetail — the K100 in-place Edit affordance on the detail
 * header.
 *
 * The guarantee under test: `/milestones/$id` is no longer read-only —
 * its header carries an Edit control that opens the SAME shared
 * `MilestoneEditDialog` Settings uses, prefilled with the current
 * milestone, and Save issues `PUT /api/milestones/:id` through the
 * dialog's own `useUpdateMilestone` mutation.
 *
 * Harness mirrors MilestonesView.test.tsx: stub `fetch` so each hook
 * resolves with canned data, mount the detail inside a memory router at
 * `/milestones/$id`, assert DOM and the captured PUT.
 */

interface Milestone {
  readonly id: string;
  readonly name: string;
  readonly target_date?: string;
  readonly archived?: boolean;
  readonly progress?: { done: number; total: number; discarded: number; fraction: number };
}

let MILESTONES: Milestone[] = [];
const PUTS: { url: string; body: unknown }[] = [];

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/milestones")) {
    return { items: MILESTONES, total: MILESTONES.length, offset: 0, limit: 1000 };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: [], total: 0, offset: 0, limit: 1000 };
  }
  if (path.startsWith("/api/calendar")) {
    return { timezone: "UTC" };
  }
  if (path.startsWith("/api/workflow")) {
    return { status: [], priority: [], task_type: [], relationship_types: [] };
  }
  return {};
}

let priorQc: QueryClient | undefined;

async function renderDetail(id: string) {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  PUTS.length = 0;
  const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
  current.mockRestore?.();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" && path.startsWith("/api/milestones/")) {
      const raw = init?.body;
      const body: unknown = typeof raw === "string" ? JSON.parse(raw) : undefined;
      PUTS.push({ url: path, body });
      // Echo an updated MilestoneDef so the dialog's onSuccess fires.
      const b = body as { name?: string; target_date?: string | null };
      const id2 = decodeURIComponent(path.slice("/api/milestones/".length));
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: id2, name: b.name ?? "", target_date: b.target_date ?? undefined }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones/$id",
    component: () => <MilestoneDetail milestoneId={id} />,
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones",
    component: () => <div data-testid="list-stub">list</div>,
  });
  // K105: the kebab's "Manage milestones" navigates here; a stub route
  // keeps that navigation from erroring in the test router.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <div data-testid="settings-stub">settings</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, listRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [`/milestones/${id}`] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  MILESTONES = [];
  PUTS.length = 0;
});

describe("MilestoneDetail — header kebab affordance (K105)", () => {
  it("edit lives in a '⋯' kebab (not a text button) and opens the shared dialog prefilled; Save issues the update", async () => {
    MILESTONES = [
      { id: "ms_1", name: "Beta launch", target_date: "2026-07-01", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderDetail("ms_1");

    // K105: the point-of-use edit affordance is an icon kebab, whose
    // trigger carries the milestone-named aria-label — never a text
    // "Edit" button. Nothing is open yet, so the Edit MenuItem is not in
    // the DOM until the kebab is opened.
    const kebab = await screen.findByTestId("milestone-detail-actions");
    expect(kebab.getAttribute("aria-label")).toBe("Milestone actions for Beta launch");
    expect(kebab.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByTestId("milestone-detail-edit")).toBeNull();
    expect(screen.queryByTestId("milestone-edit-dialog")).toBeNull();

    // Open the kebab, click "Edit milestone" → the SHARED dialog opens
    // prefilled from the milestone.
    fireEvent.click(kebab);
    fireEvent.click(await screen.findByTestId("milestone-detail-edit"));
    const dialog = await screen.findByTestId("milestone-edit-dialog");
    expect(dialog).toBeTruthy();
    const nameInput = screen.getByTestId<HTMLInputElement>("milestone-name-input");
    const dateInput = screen.getByTestId<HTMLInputElement>("milestone-date-input");
    expect(nameInput.value).toBe("Beta launch");
    expect(dateInput.value).toBe("2026-07-01");

    // Rename and save → one PUT to this milestone through the dialog's
    // useUpdateMilestone mutation.
    fireEvent.change(nameInput, { target: { value: "GA launch" } });
    fireEvent.click(screen.getByTestId("milestone-save"));

    await waitFor(() => { expect(PUTS.length).toBe(1); });
    expect(PUTS[0]?.url).toBe("/api/milestones/ms_1");
    expect(PUTS[0]?.body).toMatchObject({ name: "GA launch", target_date: "2026-07-01" });

    // The dialog closes on success.
    await waitFor(() => { expect(screen.queryByTestId("milestone-edit-dialog")).toBeNull(); });
  });

  it("retires the standalone 'Manage all milestones…' prose link; reaching Settings is a kebab MenuItem", async () => {
    MILESTONES = [
      { id: "ms_1", name: "Beta launch", target_date: "2026-07-01", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderDetail("ms_1");

    // K105: the always-visible "Manage all milestones…" text link is
    // gone. The manage affordance exists only inside the kebab, and only
    // once it is opened.
    await screen.findByTestId("milestone-detail-actions");
    const manageBefore = screen.queryByTestId("milestone-detail-manage");
    expect(manageBefore).toBeNull();
    expect(screen.queryByText(/manage all milestones/i)).toBeNull();

    // The breadcrumb back to the list is navigation, not a settings link,
    // so it stays.
    expect(screen.getByTestId("milestone-detail-back")).toBeTruthy();

    // Open the kebab → "Manage milestones" is a MenuItem that navigates
    // to Settings → Milestones.
    fireEvent.click(screen.getByTestId("milestone-detail-actions"));
    const manage = await screen.findByTestId("milestone-detail-manage");
    fireEvent.click(manage);
    expect(await screen.findByTestId("settings-stub")).toBeTruthy();
  });
});
