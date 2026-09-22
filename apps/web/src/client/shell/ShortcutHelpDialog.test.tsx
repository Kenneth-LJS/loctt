// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutHelpDialog } from "./ShortcutHelpDialog.tsx";

/**
 * The `?` keyboard reference overlay (A11Y-4) and its CONFIG-5 footer
 * link into Settings → Keyboard.
 *
 * The dialog renders a TanStack `<Link>`, so it is mounted inside a
 * memory router; a route at `/settings/$section` renders the dialog so
 * the link resolves and the test can read where it points.
 */
function renderDialog(onClose: () => void = () => undefined) {
  const rootRoute = createRootRoute({ component: Outlet });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <ShortcutHelpDialog onClose={onClose} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings/keyboard"] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

afterEach(() => {
  cleanup();
});

describe("ShortcutHelpDialog", () => {
  /**
   * @verifies CONFIG-5
   *
   * P4/config-discoverability: the `?` overlay is a summary; the full,
   * rebindable reference lives in Settings → Keyboard. Without a link the
   * two are disconnected surfaces — the overlay must point at the panel.
   */
  it("links its footer to Settings → Keyboard", async () => {
    renderDialog();
    const link = (await screen.findByTestId("shortcut-help-keyboard-link")).closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("/settings/keyboard");
  });

  /**
   * @verifies CONFIG-5
   *
   * Following the link dismisses the overlay (it is a modal layer): a
   * stale dialog left open over the destination panel would trap focus.
   */
  it("closes the dialog when the Keyboard link is followed", async () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    (await screen.findByTestId("shortcut-help-keyboard-link")).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
