// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LabelsPanel } from "./LabelsPanel.tsx";

/**
 * @verifies N-4 / UI-10
 *
 * LabelsPanel already carried `settings-panel-title`, but its create
 * action sat in a `secondary`-variant row below the description,
 * alongside the archived-scope control, at a different vertical
 * position than the title. Converged via the shared
 * `SettingsPanelHeader` — no LabelsPanel test file existed before this,
 * so this file's only job is asserting that convergence.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LABELS = {
  items: [
    { id: "lbl_bug", name: "Bug", color: "#ff0000", taskCount: 2 },
  ],
  total: 1,
  offset: 0,
  limit: 500,
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(LABELS)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("LabelsPanel header convergence (N-4)", () => {
  it("renders the canonical title markup via SettingsPanelHeader", async () => {
    render(<LabelsPanel />, { wrapper: wrapper() });

    const title = await screen.findByTestId("settings-panel-title");
    expect(title.tagName).toBe("H1");
    expect(title.textContent).toBe("Labels");
    expect(title.className).toContain("text-text-primary");
  });

  it("puts the create action in the header row next to the title, not below it", async () => {
    render(<LabelsPanel />, { wrapper: wrapper() });

    const title = await screen.findByTestId("settings-panel-title");
    const createBtn = await screen.findByTestId("label-create-open");
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(header?.contains(createBtn)).toBe(true);
  });
});
