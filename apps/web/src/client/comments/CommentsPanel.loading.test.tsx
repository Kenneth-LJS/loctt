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
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Comments section's loading indicator was a bare `<p aria-busy>` with
 * no `role="status"`, so a screen reader was never told the thread was
 * loading (design-review §A3). It now renders through `LoadingState`
 * (role=status + aria-busy).
 *
 * Red-proven: the pre-fix `<p aria-busy>` has no role, so
 * `getByRole("status")` finds nothing.
 */

vi.mock("../api/hooks/useComments.ts", () => ({
  useComments: () => ({ isPending: true, isError: false, data: undefined }),
  usePostComment: () => ({ mutate: () => {}, isPending: false }),
  useEditComment: () => ({ mutate: () => {}, isPending: false }),
  useDeleteComment: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../api/hooks/useAttachments.ts", () => ({
  useUploadAttachment: () => ({ mutateAsync: () => Promise.resolve({}) }),
}));

const { CommentsPanel } = await import("./CommentsPanel.tsx");

afterEach(() => { cleanup(); });

function renderPanel() {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <CommentsPanel taskRef="T-1" users={[]} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("CommentsPanel loading is announced", () => {
  it("renders the loading state with role=status", async () => {
    renderPanel();
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Loading comments/i);
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});
