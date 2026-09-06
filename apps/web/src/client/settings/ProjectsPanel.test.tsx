// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsPanel } from "./ProjectsPanel.tsx";

/**
 * @verifies PRU-44, PRU-45 (K30)
 *
 * The editable project-prefix control. Previously the prefix field was
 * `readOnly disabled` and `useSetProjectPrefix` was dead, so PRU-44 was
 * unbuilt. These turn on the request the panel issues and the confirm
 * step in front of it, not the server round-trip (server.test.ts covers
 * that against a real tracker).
 */

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROJECTS = {
  items: [
    { id: "p-web", name: "Web", slug: "web", prefix: "T-" },
    { id: "p-api", name: "API", slug: "api", prefix: "API-" },
  ],
  total: 2,
  offset: 0,
  limit: 100,
  task_counts: { "p-web": 3, "p-api": 0 },
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/**
 * Reads the JSON body a request was made with. Bodies come from the
 * mock's recorded calls (init.body is a string here), so the caller
 * reads them after the fact rather than through a stringify in the
 * mock — which keeps eslint's no-base-to-string happy.
 */
function prefixPutBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(c => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return url.includes("/api/projects/") && url.endsWith("/prefix")
        && String(init?.method).toUpperCase() === "PUT";
    })
    .map(c => {
      const init = c[1] as RequestInit | undefined;
      const body = typeof init?.body === "string" ? init.body : undefined;
      return body !== undefined ? (JSON.parse(body) as unknown) : undefined;
    });
}

/** Default: projects + info both succeed; prefix PUT succeeds. */
function stubHappyPath(): void {
  fetchMock.mockImplementation((url: unknown): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("/api/projects/") && urlStr.endsWith("/prefix")) {
      return Promise.resolve(jsonResponse({ from: "T-", to: "WEB-", renamed: 3 }));
    }
    if (urlStr.includes("/api/projects")) {
      return Promise.resolve(jsonResponse(PROJECTS));
    }
    if (urlStr.includes("/api/info")) {
      return Promise.resolve(jsonResponse({ schemaVersion: 1 }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function saveButton(): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>("project-prefix-save-p-web");
}

describe("ProjectsPanel editable prefix (PRU-44/PRU-45)", () => {
  it("renders the prefix field editable, not disabled", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const input = await screen.findByTestId<HTMLInputElement>("project-prefix-p-web");
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
  });

  it("confirms the blast radius before renaming, then PUTs the new prefix", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const input = await screen.findByTestId("project-prefix-p-web");
    fireEvent.change(input, { target: { value: "WEB-" } });
    fireEvent.click(screen.getByTestId("project-prefix-save-p-web"));

    // The confirm dialog states the count (3 tasks) before anything is
    // written — and no PUT has fired yet.
    const dialog = await screen.findByTestId("project-prefix-confirm-p-web");
    expect(dialog.textContent).toMatch(/3 tasks/);
    expect(dialog.textContent).toMatch(/old keys will keep resolving/i);
    expect(prefixPutBodies()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("project-prefix-confirm-btn-p-web"));

    await waitFor(() => { expect(prefixPutBodies()).toHaveLength(1); });
    expect(prefixPutBodies()[0]).toEqual({ prefix: "WEB-" });
  });

  it("refuses a prefix already in use at the field, before any request", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const input = await screen.findByTestId("project-prefix-p-web");
    // API- belongs to the other project.
    fireEvent.change(input, { target: { value: "API-" } });

    const err = await screen.findByTestId("project-prefix-error-p-web");
    expect(err.textContent).toMatch(/API-/);
    expect(err.textContent).toMatch(/API/);
    // Save is blocked; no request went out.
    expect(saveButton().disabled).toBe(true);
    expect(prefixPutBodies()).toHaveLength(0);
  });

  it("accepts the project's own current prefix as a no-op (no Change enabled)", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    await screen.findByTestId("project-prefix-p-web");
    // Unchanged value: the Change button is disabled and no error shows.
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByTestId("project-prefix-error-p-web")).toBeNull();
  });
});
