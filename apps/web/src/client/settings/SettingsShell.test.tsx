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
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsShell } from "./SettingsShell.tsx";

/**
 * SettingsShell responsive layout (R1, the responsive-remainder lane).
 *
 * jsdom has no layout engine, so we cannot measure that nothing
 * overflows at a phone width. What we *can* pin is the class contract
 * that makes the two-pane rail degrade gracefully: below Tailwind's
 * `md` breakpoint the shell stacks (nav bar above the pane) and the nav
 * is a full-width bar rather than a fixed 224px side rail that would
 * swallow half a 375px screen. The pre-R1 layout was an unconditional
 * horizontal `flex` with a `w-56 shrink-0` rail at every width; these
 * assertions fail against it.
 *
 * We render at an unknown section so no panel `fetch` is needed — the
 * nav and the shell container render regardless (SET-32), which is
 * exactly what these assertions target.
 */

function renderShell(section: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rootRoute = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <SettingsShell section={section} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({
      initialEntries: [`/settings/${section}`],
    }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider> as ReactNode,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsShell responsive layout (R1)", () => {
  it("stacks the section nav above the pane below the md breakpoint", async () => {
    // Unknown section: nav + shell render, no panel fetch needed.
    renderShell("__does-not-exist__");
    const nav = await screen.findByTestId("settings-nav");

    // The outer flex container is the nav's parent.
    const shell = nav.parentElement;
    expect(shell).not.toBeNull();
    const shellClass = shell?.className ?? "";

    // Below md the layout is a column (nav bar over pane); md+ restores
    // the side-by-side rail. Pre-R1 was a bare `flex` — no `flex-col`.
    expect(shellClass).toContain("flex-col");
    expect(shellClass).toContain("md:flex-row");
  });

  it("does not force horizontal body scroll from the shell", async () => {
    renderShell("__does-not-exist__");
    const nav = await screen.findByTestId("settings-nav");
    const shellClass = nav.parentElement?.className ?? "";
    // The shell clips its own overflow; scrolling lives inside the panes.
    // Pre-R1 the shell had no overflow control.
    expect(shellClass).toContain("overflow-hidden");
  });

  it("makes the nav a full-width bar on mobile, a fixed rail at md+", async () => {
    renderShell("__does-not-exist__");
    const nav = await screen.findByTestId("settings-nav");
    const navClass = nav.className;

    // Full width on a narrow viewport rather than a permanent 224px rail
    // that would crush the pane on a phone.
    expect(navClass).toContain("w-full");
    // Restored to the fixed side rail at md and up.
    expect(navClass).toContain("md:w-56");
    // Pre-R1 the rail was `w-56 shrink-0` at every width; `shrink-0` is
    // now gated behind md so the mobile bar can be full width.
    expect(navClass).toContain("md:shrink-0");
  });
});
