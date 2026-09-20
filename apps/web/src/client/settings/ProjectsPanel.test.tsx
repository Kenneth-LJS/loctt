// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsPanel } from "./ProjectsPanel.tsx";


/**
 * Row actions now live behind a per-row kebab overflow menu (responsive:
 * inline buttons clipped/overflowed the row on a narrow pane). Open the
 * row's kebab, then return the action MenuItem for `actionTestId` (which
 * the caller clicks or inspects).
 */
async function openProjectMenu(projectId: string): Promise<void> {
  const row = await screen.findByTestId(`project-row-${projectId}`);
  const kebab = row.querySelector<HTMLButtonElement>("[aria-label^='Actions for project']");
  if (kebab === null) throw new Error(`no actions kebab on project row ${projectId}`);
  fireEvent.click(kebab);
}

/**
 * K100: the row's edit affordances (name, prefix, Make default, Archive)
 * now live inside the shared `ProjectEditDialog`, which the sidebar also
 * renders — not inline in the row. Open the row kebab, click Edit…, and
 * the dialog with those controls is mounted. The tests below that used to
 * find `project-set-default-*` / `project-archive-*` / `project-name-*` as
 * row-kebab items or inline row markup now find them in the dialog; the
 * change is the K100 extraction, so those tests were updated to open the
 * dialog first (they previously asserted the in-row/in-kebab form).
 */
async function openProjectEdit(projectId: string): Promise<void> {
  await openProjectMenu(projectId);
  fireEvent.click(screen.getByTestId(`project-edit-${projectId}`));
  await screen.findByTestId(`project-edit-dialog-${projectId}`);
}

/**
 * @verifies PRU-6, PRU-44, PRU-45, PRU-48
 *
 * B2 edit-model: a project row is read-by-default. The name is no longer
 * a bare input that saves on blur — it is shown as text until an **Edit**
 * control opens an inline form, and the slug and prefix are only
 * reachable inside that form. The PRU-44/PRU-45 prefix tests below now
 * open Edit first (they previously found the prefix input directly,
 * because it was always rendered); that step is the behavioural change
 * this ticket introduces, so those tests were updated to reflect it.
 *
 * These turn on what the panel *sends* and *renders*, not the server
 * round-trip (server tests cover that against a real tracker).
 */

/**
 * The panel now renders a TanStack `<Link>` (the CONFIG-5 cross-link to
 * My preferences), so a bare render throws in `useLinkProps` — the panel
 * always lives under a router in the app. The wrapper therefore mounts a
 * memory router at `/settings/projects` whose route renders `children`,
 * in addition to the QueryClient the panel's fetches need.
 */
function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => {
    const rootRoute = createRootRoute({ component: Outlet });
    const settingsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings/$section",
      component: () => <>{children}</>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([settingsRoute]),
      history: createMemoryHistory({ initialEntries: ["/settings/projects"] }),
    });
    return (
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    );
  };
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
  default: "p-api",
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

/** JSON bodies of requests matching a URL/method predicate. */
function bodiesFor(pred: (url: string, method: string) => boolean): unknown[] {
  return fetchMock.mock.calls
    .filter((c) => {
      const url = String(c[0]);
      const init = c[1] as RequestInit | undefined;
      return pred(url, String(init?.method).toUpperCase());
    })
    .map((c) => {
      const init = c[1] as RequestInit | undefined;
      const body = typeof init?.body === "string" ? init.body : undefined;
      return body !== undefined ? (JSON.parse(body) as unknown) : undefined;
    });
}

function prefixPutBodies(): unknown[] {
  return bodiesFor((url, method) =>
    url.includes("/api/projects/") && url.endsWith("/prefix") && method === "PUT");
}

/** Default: projects + info both succeed; project PUT + prefix PUT succeed. */
function stubHappyPath(): void {
  fetchMock.mockImplementation((url: unknown): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("/api/projects/") && urlStr.endsWith("/prefix")) {
      return Promise.resolve(jsonResponse({ from: "T-", to: "WEB-", renamed: 3 }));
    }
    if (urlStr.includes("/api/projects/")) {
      // a single-project PUT (name / default) echoes a project back
      return Promise.resolve(jsonResponse({ id: "p-web", name: "Web", slug: "web", prefix: "T-" }));
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

/** Enter the Web row's edit form and return its prefix input. */
async function openWebEditPrefix(): Promise<HTMLInputElement> {
  await openProjectMenu("p-web");
    fireEvent.click(screen.getByTestId("project-edit-p-web"));
  return screen.findByTestId<HTMLInputElement>("project-prefix-p-web");
}

function saveButton(): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>("project-prefix-save-p-web");
}

describe("ProjectsPanel empty state", () => {
  // Before the fix the tbody mapped items with no length guard, so zero
  // projects rendered a header-only blank table (reads as broken, not as
  // "nothing here yet"). Red-proven: without the guard neither the teach
  // copy nor the create CTA render.
  it("shows a teach + create empty state at zero projects, not a blank table", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("/api/projects")) {
        return Promise.resolve(jsonResponse({ items: [], total: 0, offset: 0, limit: 100, default: null, task_counts: {} }));
      }
      if (urlStr.includes("/api/info")) return Promise.resolve(jsonResponse({ schemaVersion: 1 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const empty = await screen.findByTestId("projects-empty");
    expect(empty.textContent).toMatch(/No projects yet/i);
    // The CTA opens the same create dialog the panel's own button does.
    fireEvent.click(screen.getByTestId("projects-empty-create"));
    expect(await screen.findByTestId("project-create-name")).toBeTruthy();
  });
});

describe("ProjectsPanel edit-model (PRU-6)", () => {
  it("shows the name as read-only text by default, editable only after Edit", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // Read-by-default: the name is text, and there is no name input and
    // no prefix input until Edit is pressed.
    await screen.findByTestId("project-name-p-web");
    expect(screen.queryByTestId("project-name-input-p-web")).toBeNull();
    expect(screen.queryByTestId("project-prefix-p-web")).toBeNull();

    await openProjectMenu("p-web");
    fireEvent.click(screen.getByTestId("project-edit-p-web"));
    expect(screen.getByTestId("project-name-input-p-web")).toBeTruthy();
    // The prefix control is now reachable — inside the edit form only.
    expect(screen.getByTestId("project-prefix-p-web")).toBeTruthy();
  });

  it("PUTs the new name on Save, not on blur, then closes the form", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    await openProjectMenu("p-web");
    fireEvent.click(screen.getByTestId("project-edit-p-web"));
    const input = screen.getByTestId("project-name-input-p-web");
    fireEvent.change(input, { target: { value: "Web App" } });

    // Blur must NOT write (the whole point of the edit-model change).
    fireEvent.blur(input);
    const namePut = () => bodiesFor((url, method) =>
      /\/api\/projects\/p-web$/.test(url) && method === "PUT");
    expect(namePut()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("project-name-save-p-web"));
    await waitFor(() => { expect(namePut()).toHaveLength(1); });
    expect(namePut()[0]).toEqual({ name: "Web App" });
  });

  it("Cancel discards the edit without any request", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    await openProjectMenu("p-web");
    fireEvent.click(screen.getByTestId("project-edit-p-web"));
    fireEvent.change(screen.getByTestId("project-name-input-p-web"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByTestId("project-edit-cancel-p-web"));

    // Back to read mode, original name, and no PUT fired.
    await screen.findByTestId("project-name-p-web");
    expect(bodiesFor((url, method) => /\/api\/projects\/p-web$/.test(url) && method === "PUT"))
      .toHaveLength(0);
  });
});

describe("ProjectsPanel set-default (PRU-48)", () => {
  it("marks the current default and makes its Make-default control inert", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // p-api is the default in PROJECTS — the marker is in the read-only row.
    await screen.findByTestId("project-default-marker-p-api");
    expect(screen.queryByTestId("project-default-marker-p-web")).toBeNull();
    // K100: Make default now lives inside the edit dialog. For the current
    // default it is a disabled <button> labelled so marker and control
    // can't disagree.
    await openProjectEdit("p-api");
    const apiBtn = screen.getByTestId<HTMLButtonElement>("project-set-default-p-api");
    expect(apiBtn.disabled).toBe(true);
    expect(apiBtn.textContent).toMatch(/Default \(current\)/);
  });

  it("PUTs { default: true } for a non-default project", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // K100: Make default is inside the edit dialog now.
    await openProjectEdit("p-web");
    const webBtn = screen.getByTestId("project-set-default-p-web");
    expect(webBtn.textContent).toMatch(/Make default/);
    fireEvent.click(webBtn);

    // PRU-48: the marker moves by a plain project PUT carrying default:true.
    await waitFor(() => {
      const bodies = bodiesFor((url, method) =>
        /\/api\/projects\/p-web$/.test(url) && method === "PUT");
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toEqual({ default: true });
    });
  });
});

describe("ProjectsPanel silent-write surfacing (B2 bug 3)", () => {
  /** @verifies PRU-48 */
  it("shows an error when Make default fails, instead of failing silently", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/projects\/p-web$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(jsonResponse({ code: "rejected_write", message: "Default write failed." }, 500));
      }
      if (urlStr.includes("/api/projects")) return Promise.resolve(jsonResponse(PROJECTS));
      if (urlStr.includes("/api/info")) return Promise.resolve(jsonResponse({ schemaVersion: 1 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // K100: Make default is inside the edit dialog now.
    await openProjectEdit("p-web");
    fireEvent.click(screen.getByTestId("project-set-default-p-web"));

    const err = await screen.findByTestId("project-set-default-error-p-web");
    expect(err.textContent).toContain("Default write failed.");
  });

  it("shows an error when Archive fails, instead of failing silently", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/projects\/p-web$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(jsonResponse({ code: "rejected_write", message: "Archive write failed." }, 500));
      }
      if (urlStr.includes("/api/projects")) return Promise.resolve(jsonResponse(PROJECTS));
      if (urlStr.includes("/api/info")) return Promise.resolve(jsonResponse({ schemaVersion: 1 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // K100: Archive is inside the edit dialog now.
    await openProjectEdit("p-web");
    fireEvent.click(screen.getByTestId("project-archive-p-web"));

    const err = await screen.findByTestId("project-archive-error-p-web");
    expect(err.textContent).toContain("Archive write failed.");
  });
});

describe("ProjectsPanel stale name draft (B2 bug 5)", () => {
  /** @verifies PRU-6 */
  it("seeds the Edit input from the CURRENT name after an external rename, not the stale mount value", async () => {
    // First projects GET → "Web". After the set-default PUT invalidates
    // the projects query, the refetch returns the externally-renamed
    // "Web Renamed" — simulating a rename that happened elsewhere.
    let projectsFetches = 0;
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const urlStr = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (/\/api\/projects\/p-web$/.test(urlStr) && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "p-web", name: "Web Renamed", slug: "web", prefix: "T-" }));
      }
      if (urlStr.includes("/api/projects") && method === "GET") {
        projectsFetches += 1;
        const name = projectsFetches === 1 ? "Web" : "Web Renamed";
        return Promise.resolve(jsonResponse({
          ...PROJECTS,
          items: [
            { id: "p-web", name, slug: "web", prefix: "T-" },
            { id: "p-api", name: "API", slug: "api", prefix: "API-" },
          ],
        }));
      }
      if (urlStr.includes("/api/info")) return Promise.resolve(jsonResponse({ schemaVersion: 1 }));
      return Promise.resolve(jsonResponse({}));
    });
    render(<ProjectsPanel />, { wrapper: wrapper() });

    // Force the external rename to land: set-default (now inside the edit
    // dialog) invalidates projects, so the row re-renders with the new name
    // text. Close the dialog afterwards.
    await openProjectEdit("p-web");
    fireEvent.click(screen.getByTestId("project-set-default-p-web"));
    await waitFor(() => {
      expect(screen.getByTestId("project-name-p-web").textContent).toBe("Web Renamed");
    });
    fireEvent.click(screen.getByTestId("project-edit-cancel-p-web"));

    // K100: the dialog mounts fresh on open and seeds `useState(project.name)`
    // from the CURRENT prop, so re-opening Edit shows the renamed value — the
    // B2 bug-5 stale-draft trap (draft seeded once and never reset) cannot
    // recur. This previously asserted the inline row form's input value.
    await openProjectEdit("p-web");
    const input = screen.getByTestId<HTMLInputElement>("project-name-input-p-web");
    expect(input.value).toBe("Web Renamed");
  });
});

describe("ProjectsPanel editable prefix (PRU-44/PRU-45)", () => {
  it("renders the prefix field editable inside the edit form, not disabled", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const input = await openWebEditPrefix();
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
  });

  it("confirms the blast radius before renaming, then PUTs the new prefix", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const input = await openWebEditPrefix();
    fireEvent.change(input, { target: { value: "WEB-" } });
    fireEvent.click(screen.getByTestId("project-prefix-save-p-web"));

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

    const input = await openWebEditPrefix();
    // API- belongs to the other project.
    fireEvent.change(input, { target: { value: "API-" } });

    const err = await screen.findByTestId("project-prefix-error-p-web");
    expect(err.textContent).toMatch(/API-/);
    expect(err.textContent).toMatch(/API/);
    expect(saveButton().disabled).toBe(true);
    expect(prefixPutBodies()).toHaveLength(0);
  });

  it("accepts the project's own current prefix as a no-op (no Change enabled)", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    await openWebEditPrefix();
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByTestId("project-prefix-error-p-web")).toBeNull();
  });

  /**
   * @verifies CONFIG-5
   *
   * P4: the row-level "Make default" here sets the *workspace* default;
   * each user can also set a *personal* default. This panel cross-links to
   * My preferences so the two "default project" concepts are not conflated.
   */
  it("cross-links the workspace default to the personal default in My preferences", async () => {
    stubHappyPath();
    render(<ProjectsPanel />, { wrapper: wrapper() });

    const link = (await screen.findByTestId("projects-personal-default-link"))
      .closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("/settings/preferences");
  });
});
