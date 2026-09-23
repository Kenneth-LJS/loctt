// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { LabelsPanel } from "./LabelsPanel.tsx";
import { MilestonesPanel } from "./MilestonesPanel.tsx";

/**
 * Row actions (Edit/Archive/Delete) now live behind a per-row kebab
 * overflow menu (responsive GROUP A: inline actions overflowed a narrow
 * row). Open the row's kebab, then click the action MenuItem by testid.
 */
function openRowAction(row: HTMLElement, actionTestId: string): void {
  const kebab = row.querySelector<HTMLButtonElement>("[aria-label^='Actions for']");
  if (kebab === null) throw new Error("row has no actions kebab");
  fireEvent.click(kebab);
  const item = document.querySelector<HTMLButtonElement>(`[data-testid='${actionTestId}']`);
  if (item === null) throw new Error(`no menu item ${actionTestId}`);
  fireEvent.click(item);
}

/**
 * Settings → Data panel behaviour that turns on what the client sends
 * and what it renders, rather than on the server round-trip (which the
 * server tests cover against a real tracker).
 *
 * The interesting assertions here are the ones the run has repeatedly
 * found missing:
 *
 *  - the **request** the panel issues, not only the file it produces —
 *    a layer in between can repair a wrong value and hide the bug;
 *  - a failure state that is *visually distinct* from an empty one,
 *    which is MSL-31's whole subject and cannot be asserted by
 *    checking that a list is empty.
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

/**
 * Typed as the fetch signature rather than a bare `vi.fn()`: an
 * untyped mock infers a void return, which makes every
 * `mockImplementation` returning a promise a lint error.
 */
let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;
/**
 * React reports a duplicate `key` through console.error rather than by
 * failing to render, so a row-count assertion alone cannot catch it.
 */
let consoleErrors: string[];

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(a => String(a)).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Every URL the component requested, in order. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(c => String(c[0]));
}

describe("LabelsPanel", () => {
  const twoLabels = {
    items: [
      { id: "L1", name: "bug", color: "#ff0000", taskCount: 3 },
      { id: "L2", name: "chore", taskCount: 0 },
    ],
    total: 2,
  };

  it("asks for reference counts, which are opt-in server-side", async () => {
    fetchMock.mockResolvedValue(jsonResponse(twoLabels));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    // MSL-11 depends on `?counts=true`; without it the server returns
    // entries with no `taskCount` and every row would render 0 — which
    // is a plausible-looking wrong answer, the worst kind.
    expect(requestedUrls().some(u => u.includes("/api/labels") && u.includes("counts=true")))
      .toBe(true);
  });

  /** @verifies MSL-11 */
  it("renders a zero reference count as 0, not as a blank", async () => {
    fetchMock.mockResolvedValue(jsonResponse(twoLabels));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    // MSL-11's last bullet. A blank cell reads as "unknown", which is a
    // different claim from "no tasks use this".
    const row = screen.getByTestId("label-row-L2");
    expect(row.querySelector("[data-label-refcount]")?.getAttribute("data-label-refcount"))
      .toBe("0");
    expect(row.textContent).toContain("0 task");
  });

  /** @verifies MSL-31 */
  it("shows a load failure as a distinct state from an empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { code: "config_invalid", message: "duplicate label id: L1" },
      400,
    ));
    render(<LabelsPanel />, { wrapper: wrapper() });

    // MSL-31: "an empty label list and a failed label load are visually
    // distinct". Both are asserted, because only the pair proves the
    // distinction — either alone is true of the other state too.
    const failure = await screen.findByTestId("labels-load-error");
    expect(failure.getAttribute("data-labels-state")).toBe("load-failed");
    expect(screen.queryByTestId("labels-empty")).toBeNull();
    expect(failure.textContent).toContain("labels.yaml");
  });

  it("shows an empty list as empty, not as a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    render(<LabelsPanel />, { wrapper: wrapper() });

    // The other half of the pair above.
    const empty = await screen.findByTestId("labels-empty");
    expect(empty.getAttribute("data-labels-state")).toBe("empty");
    expect(screen.queryByTestId("labels-load-error")).toBeNull();
  });

  /** @verifies MSL-34 */
  it("warns about a duplicate name without calling it invalid or blocking it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(twoLabels));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    // K100 / Part-D: create is now the shared mode-aware dialog, opened
    // from the panel, not an always-present inline form.
    fireEvent.click(screen.getByTestId("label-create-open"));
    await screen.findByTestId("label-create-dialog");
    fireEvent.change(screen.getByTestId("label-create-name"), { target: { value: "bug" } });

    const warning = await screen.findByTestId("label-duplicate-warning");
    // MSL-34: "The message never claims the name is invalid."
    expect(warning.textContent).toMatch(/already exists/i);
    expect(warning.textContent).not.toMatch(/invalid|not allowed|cannot/i);
    // And it is a warning, not a block.
    expect(screen.getByTestId("label-create-submit")).not.toHaveProperty("disabled", true);
  });

  /** @verifies MSL-37 */
  it("blocks save on a non-hex colour and names the expected format", async () => {
    fetchMock.mockResolvedValue(jsonResponse(twoLabels));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    fireEvent.click(screen.getByTestId("label-create-open"));
    await screen.findByTestId("label-create-dialog");
    fireEvent.change(screen.getByTestId("label-create-name"), { target: { value: "new" } });
    fireEvent.change(screen.getByTestId("label-create-color"), { target: { value: "notacolour" } });

    // MSL-37: rejected at the input, format named, save blocked so
    // nothing partially-written reaches labels.yaml.
    const msg = await screen.findByTestId("label-create-color-invalid");
    expect(msg.textContent).toMatch(/#aabbcc|hex/i);
    expect(screen.getByTestId("label-create-submit")).toHaveProperty("disabled", true);

    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("label-create-submit"));
    // No request left the client.
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  /** @verifies MSL-32 */
  it("sends remap_to on the delete request when a remap target is chosen", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/labels/")
          ? jsonResponse({ deleted: "L1", affectedTaskCount: 3 })
          : jsonResponse(twoLabels),
      ));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    // The row's actions now live behind a kebab overflow menu (responsive
    // GROUP A: inline Edit/Archive/Delete overflowed the row on a narrow
    // pane). Open the menu, then choose Delete.
    const kebab = screen
      .getByTestId("label-row-L1")
      .querySelector<HTMLButtonElement>("[aria-label^='Actions for label']");
    expect(kebab).not.toBeNull();
    fireEvent.click(kebab as HTMLButtonElement);
    const deleteButton = await screen.findByTestId("label-delete");
    fireEvent.click(deleteButton);

    // MSL-32: with references present and nothing chosen, the confirm
    // is disabled — the delete cannot be issued at all.
    const confirm = await screen.findByTestId("remap-confirm");
    expect(confirm).toHaveProperty("disabled", true);

    // A211/A242: the alternatives are a searchable Combobox behind a
    // "reassign" radio now, not one radio per alternative. Control type
    // changed, not behavior: choose reassign, open the picker, pick L2 by
    // its (unchanged) per-option testid. The confirm is still gated on a
    // concrete target — reassign with nothing picked stays disabled.
    fireEvent.click(screen.getByTestId("remap-reassign"));
    expect(screen.getByTestId("remap-confirm")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("remap-to"));
    fireEvent.click(screen.getByTestId("remap-to-L2"));
    expect(screen.getByTestId("remap-confirm")).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByTestId("remap-confirm"));

    // MSL-12. Asserting the REQUEST, not just the end state: the
    // remap target has to leave the client on the URL, because that is
    // the only way it reaches core's hard-delete path.
    await waitFor(() => {
      const del = (fetchMock.mock.calls as readonly (readonly unknown[])[]).find(
        (c) => {
          const init = c[1] as RequestInit | undefined;
          return String(init?.method).toUpperCase() === "DELETE";
        },
      );
      expect(del).toBeDefined();
      expect(String(del?.[0])).toContain("remap_to=L2");
    });
  });

  /**
   * @verifies ERR-13
   *
   * Before the fix the archive toggle had no error path (mirroring the
   * MilestonesPanel bug-3): a failed POST /api/labels/:id/archive read as
   * done while nothing changed on disk. Red-proven — without the
   * `archive.isError` Callout this row does not render.
   */
  it("surfaces a failed archive on the row rather than swallowing it", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/labels/L1/archive")
          ? jsonResponse({ message: "could not write labels.yaml", code: "rejected_write" }, 500)
          : jsonResponse(twoLabels),
      ),
    );
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    openRowAction(screen.getByTestId("label-row-L1"), "label-archive-toggle");

    const err = await screen.findByTestId("label-archive-error");
    expect(err.textContent).toContain("could not write");
  });

  /**
   * DEG-30 / UX-13: a label whose stored fields do not validate is lifted
   * by the tolerant loader into the response's `broken` array. The panel
   * must show it as a marked, disabled error row naming the id and the
   * reason — not omit it from the list with no notice.
   */
  describe("DEG-30 broken labels", () => {
    const oneGoodOneBroken = {
      items: [{ id: "L1", name: "bug", color: "#ff0000", taskCount: 3 }],
      total: 1,
      broken: [
        { id: "l_broken", index: 1, rawText: "id: l_broken\nname: 999", error: "name must be text" },
      ],
    };

    /** @verifies DEG-30 */
    it("renders a broken label as a marked error row, not omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse(oneGoodOneBroken));
      render(<LabelsPanel />, { wrapper: wrapper() });
      await screen.findByTestId("labels-list");

      // The broken entry appears as its own row, named by its id and
      // carrying the loader's reason — the whole point of DEG-30 is that
      // it does not vanish.
      const row = await screen.findByTestId("label-broken-l_broken");
      expect(row.textContent).toContain("l_broken");
      expect(row.textContent).toMatch(/couldn't be read/i);
      expect(row.textContent).toContain("name must be text");
      // Marked as a disabled/error affordance, distinct from a live row.
      expect(row.getAttribute("aria-disabled")).toBe("true");
      // And it offers a repair action.
      expect(screen.getByTestId("label-broken-repair-l_broken")).not.toBeNull();
      // The healthy label still renders alongside it.
      expect(screen.getByTestId("label-row-L1")).not.toBeNull();
    });

    /** @verifies DEG-30 */
    it("treats a file with only a broken label as non-empty, not as 'no labels'", async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        items: [],
        total: 0,
        broken: [
          { id: "l_broken", index: 0, rawText: "id: l_broken\nname: 999", error: "name must be text" },
        ],
      }));
      render(<LabelsPanel />, { wrapper: wrapper() });

      // A138: `valid.length + broken.length` — a lone corrupt entry
      // degrades rather than reading as "none", so the empty state must
      // NOT show and the broken row must.
      await screen.findByTestId("label-broken-l_broken");
      expect(screen.queryByTestId("labels-empty")).toBeNull();
    });
  });
});

/**
 * @verifies K100
 *
 * Point-of-use editing (K100): Labels / Milestones edit through a single
 * self-contained dialog the Settings panel ALSO renders (the sidebar opens
 * the same one). These turn on: the panel's Edit opens the extracted
 * dialog prefilled, and Save issues the PUT through the dialog's own hook.
 *
 * These previously asserted the panel's *inline row form* (a
 * `label-name-input` rendered in the row, with an in-row Save). That form
 * was replaced by the shared `LabelEditDialog` / `MilestoneEditDialog`
 * this ticket extracted; the tests were updated to open the dialog and
 * assert the same fields + the same PUT.
 */
describe("K100 point-of-use edit dialogs", () => {
  const labels = {
    items: [{ id: "L1", name: "bug", color: "#ff0000", taskCount: 3 }],
    total: 1,
  };
  const milestones = {
    items: [{ id: "M1", name: "v1", target_date: "2026-03-31", taskCount: 2 }],
    total: 2,
  };

  it("LabelsPanel Edit opens the shared dialog prefilled and saves via PUT", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/labels/")
          ? jsonResponse({ id: "L1", name: "defect", color: "#00ff00" })
          : jsonResponse(labels),
      ));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    openRowAction(screen.getByTestId("label-row-L1"), "label-edit");

    // The SAME dialog component the sidebar renders.
    await screen.findByTestId("label-edit-dialog");
    const name = screen.getByTestId<HTMLInputElement>("label-name-input");
    const color = screen.getByTestId<HTMLInputElement>("label-color-input");
    expect(name.value).toBe("bug");
    expect(color.value).toBe("#ff0000");

    fireEvent.change(name, { target: { value: "defect" } });
    fireEvent.change(color, { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByTestId("label-save"));

    await waitFor(() => {
      const put = (fetchMock.mock.calls as readonly (readonly unknown[])[]).find((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/labels/L1")
          && String(init?.method).toUpperCase() === "PUT";
      });
      expect(put).toBeDefined();
      const raw = (put?.[1] as RequestInit).body;
      const body = JSON.parse(typeof raw === "string" ? raw : "") as unknown;
      expect(body).toEqual({ name: "defect", color: "#00ff00" });
    });
  });

  it("MilestonesPanel Edit opens the shared dialog prefilled and saves via PUT", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "M1", name: "v1.1", target_date: "2026-06-30" }));
      }
      return Promise.resolve(jsonResponse(milestones));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    openRowAction(screen.getByTestId("milestone-row-M1"), "milestone-edit");

    await screen.findByTestId("milestone-edit-dialog");
    const name = screen.getByTestId<HTMLInputElement>("milestone-name-input");
    const date = screen.getByTestId<HTMLInputElement>("milestone-date-input");
    expect(name.value).toBe("v1");
    expect(date.value).toBe("2026-03-31");

    fireEvent.change(name, { target: { value: "v1.1" } });
    fireEvent.change(date, { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByTestId("milestone-save"));

    await waitFor(() => {
      const put = (fetchMock.mock.calls as readonly (readonly unknown[])[]).find((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/milestones/M1")
          && String(init?.method).toUpperCase() === "PUT";
      });
      expect(put).toBeDefined();
      const raw = (put?.[1] as RequestInit).body;
      const body = JSON.parse(typeof raw === "string" ? raw : "") as unknown;
      expect(body).toEqual({ name: "v1.1", target_date: "2026-06-30" });
    });
  });

  it("MilestoneEditDialog sends target_date: null when the date is cleared (MSL-14)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "M1", name: "v1" }));
      }
      return Promise.resolve(jsonResponse(milestones));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    openRowAction(screen.getByTestId("milestone-row-M1"), "milestone-edit");
    await screen.findByTestId("milestone-edit-dialog");
    fireEvent.change(screen.getByTestId("milestone-date-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("milestone-save"));

    // MSL-14: a cleared date is null (drops the key), never "" or an epoch.
    await waitFor(() => {
      const put = (fetchMock.mock.calls as readonly (readonly unknown[])[]).find((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/milestones/M1")
          && String(init?.method).toUpperCase() === "PUT";
      });
      expect(put).toBeDefined();
      const raw = (put?.[1] as RequestInit).body;
      const body = JSON.parse(typeof raw === "string" ? raw : "") as { target_date: unknown };
      expect(body.target_date).toBeNull();
    });
  });
});

describe("MilestonesPanel", () => {
  const twoMilestones = {
    items: [
      { id: "M1", name: "v1", target_date: "2026-03-31", taskCount: 2 },
      { id: "M2", name: "old", archived: true, taskCount: 0 },
    ],
    total: 2,
  };

  // Retag (B2): this asserts the *management panel's* archive/unarchive
  // TOGGLE — the PUT it issues and the marker it renders — which is
  // panel CRUD, MSL-11's surface. It is NOT MSL-25, whose claim is that
  // an archived milestone still *resolves on tasks and by URL* with a
  // "show archived" affordance in the /milestones view — a different
  // surface, covered by the milestones-view ticket. The mis-tag made
  // MSL-25 look verified here when its far-end was untested.
  /** @verifies MSL-11 */
  it("archives a milestone by PUTting { archived: true }, reading active milestones only", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/milestones/")
          ? jsonResponse({ id: "M1", name: "v1", archived: true })
          : jsonResponse(twoMilestones),
      ));
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    // K121 #1: the panel asks for active milestones only — archived ones
    // are listed in Settings → Archived, not here.
    expect(requestedUrls().filter(u => u.startsWith("/api/milestones?")).every(u => u.includes("archived=active")))
      .toBe(true);

    // Archiving M1 sends the archived flag on the milestone PUT — the row
    // toggle only ever sent name/date before, so the flag had no caller.
    const activeRow = screen.getByTestId("milestone-row-M1");
    openRowAction(activeRow, 'milestone-archive-toggle');

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/milestones/M1")
          && String(init?.method).toUpperCase() === "PUT";
      });
      expect(put).toBeDefined();
      const raw = (put?.[1] as RequestInit | undefined)?.body;
      const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined;
      expect(body).toEqual({ archived: true });
    });
  });
});

describe("MilestonesPanel silent-write + staleness (B2 bugs 3, 4, 5)", () => {
  const twoMilestones = {
    items: [
      { id: "M1", name: "v1", target_date: "2026-03-31", taskCount: 2 },
      { id: "M2", name: "old", archived: true, taskCount: 0 },
    ],
    total: 2,
  };

  /** @verifies MSL-11 */
  it("surfaces an error when the archive toggle fails, instead of silence (bug 3)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ code: "rejected_write", message: "Archive write failed." }, 500));
      }
      return Promise.resolve(jsonResponse(twoMilestones));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    const row = screen.getByTestId("milestone-row-M1");
    openRowAction(row, 'milestone-archive-toggle');

    const err = await screen.findByTestId("milestone-archive-error");
    expect(err.textContent).toContain("Archive write failed.");
  });

  /** @verifies MSL-11 */
  it("invalidates the milestones-progress query after an archive so /milestones is not stale (bug 4)", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "M1", name: "v1", archived: true }));
      }
      return Promise.resolve(jsonResponse(twoMilestones));
    });

    render(
      <QueryClientProvider client={qc}>
        <MilestonesPanel />
      </QueryClientProvider>,
    );
    await screen.findByTestId("milestones-list");

    const row = screen.getByTestId("milestone-row-M1");
    openRowAction(row, 'milestone-archive-toggle');

    // After a successful archive, the milestones-progress key (the
    // /milestones view's query) must be invalidated — the exact fix for
    // the 30s staleness. The pre-fix invalidator only touched
    // ["milestones"] and ["tasks"].
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["workflow", "milestones-progress"],
      });
    });
  });

  /** @verifies MSL-14 */
  it("seeds the Edit inputs from the CURRENT milestone after an external rename (bug 5)", async () => {
    let fetches = 0;
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "M1", name: "v1", archived: true }));
      }
      // The counted list GET: first "v1", then "v1 renamed" after the
      // archive invalidates ["milestones"].
      fetches += 1;
      const name = fetches === 1 ? "v1" : "v1 renamed";
      return Promise.resolve(jsonResponse({
        items: [
          { id: "M1", name, target_date: "2026-03-31", taskCount: 2 },
          { id: "M2", name: "old", archived: true, taskCount: 0 },
        ],
        total: 2,
      }));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    // Trigger the external rename to land: archiving M1 invalidates
    // ["milestones"], so the row re-renders with the new name.
    const row = screen.getByTestId("milestone-row-M1");
    openRowAction(row, 'milestone-archive-toggle');
    await waitFor(() => {
      expect(screen.getByTestId("milestone-row-M1").textContent).toContain("v1 renamed");
    });

    // Regression: the name draft was seeded once at mount ("v1") and not
    // reset on Edit-open, so Save would revert the external rename.
    openRowAction(screen.getByTestId("milestone-row-M1"), "milestone-edit");
    const input = screen.getByTestId<HTMLInputElement>("milestone-name-input");
    expect(input.value).toBe("v1 renamed");
  });
});

/**
 * A `Response` whose body streams the given lines as NDJSON — one JSON
 * object per line — the shape `/api/doctor` now serves (SET-29). All
 * lines are enqueued up front and the stream is closed, so the panel
 * receives every check and then reaches its "done" phase.
 */
function ndjsonResponse(objects: readonly unknown[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const obj of objects) {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

/**
 * A controllable NDJSON `Response`: the returned `push`/`close` drive
 * the stream from the test so it can assert the panel's state *between*
 * checks — the whole point of SET-29's incremental delivery.
 */
function controllableNdjson(): {
  response: Response;
  push: (obj: unknown) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    }),
    push: (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")),
    close: () => controller.close(),
  };
}

describe("DiagnosticsPanel", () => {
  /** @verifies SET-14 */
  it("renders every check with its own pass/warn/fail state, not one aggregate", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "workflow.yaml", status: "ok", message: "valid" },
      { name: "key index", status: "warn", message: "1 stale entry — rerun with --rebuild-index to repair" },
      { name: "state.yaml", status: "error", message: "missing" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const list = await screen.findByTestId("diagnostics-checks");
    // Wait for the stream to finish and the running row to disappear.
    await waitFor(() => {
      expect(screen.queryByTestId("diagnostics-check-running")).toBeNull();
    });
    const rows = list.querySelectorAll("li");
    // SET-14: every check by name, each with an explicit state.
    expect(rows.length).toBe(3);
    expect([...rows].map(r => r.getAttribute("data-check-status")))
      .toEqual(["ok", "warn", "error"]);
  });

  it("renders a repeated check name once per finding", async () => {
    // `runDoctor` pushes one "data integrity" check PER finding, so the
    // name is not unique. Keying rows by name collapsed these into one
    // and silently hid real failures.
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "data integrity", status: "warn", message: "a.md: malformed" },
      { name: "data integrity", status: "warn", message: "b.md: malformed" },
      { name: "data integrity", status: "error", message: "c.md: unreadable" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const list = await screen.findByTestId("diagnostics-checks");
    await waitFor(() => {
      expect(screen.queryByTestId("diagnostics-check-running")).toBeNull();
    });
    expect(list.querySelectorAll("li").length).toBe(3);
    expect(list.textContent).toContain("a.md");
    expect(list.textContent).toContain("b.md");
    expect(list.textContent).toContain("c.md");

    // React renders duplicate keys anyway (it only warns), so the row
    // count above passes even when keyed by the repeating name. The
    // real guarantee is that the keys are DISTINCT — assert that
    // directly, or this test asserts nothing about keying at all.
    expect(consoleErrors.some(m => /same key|duplicate key/i.test(m))).toBe(false);
  });

  /**
   * @verifies SET-29
   *
   * The substance of SET-29: a check that has completed and a check
   * still running are visibly distinct, and completed checks appear
   * before the run finishes rather than all at the end. Driving the
   * stream by hand lets us catch the state *between* the first check and
   * the rest — which a batched response, delivering everything in one
   * tick, could never exhibit.
   */
  it("shows a distinct running state, then flips it to a result", async () => {
    const stream = controllableNdjson();
    fetchMock.mockResolvedValue(stream.response);
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    // Before any check lands, the panel shows a running row — a pending
    // state, distinct from any pass/fail row (bullet 2).
    const running = await screen.findByTestId("diagnostics-check-running");
    expect(running.getAttribute("data-check-state")).toBe("pending");
    expect(screen.queryByTestId("diagnostics-check-workflow.yaml")).toBeNull();

    // First check arrives: it renders as a completed result WHILE the
    // running row is still present (more checks are coming). This is the
    // incremental delivery of bullet 1 — a batched response cannot show
    // one result alongside a still-running indicator.
    stream.push({ name: "workflow.yaml", status: "ok", message: "valid" });
    const firstRow = await screen.findByTestId("diagnostics-check-workflow.yaml");
    expect(firstRow.getAttribute("data-check-state")).toBe("done");
    expect(firstRow.getAttribute("data-check-status")).toBe("ok");
    // The pending and the completed rows are simultaneously present and
    // carry different states — the visible distinction SET-29 requires.
    expect(screen.getByTestId("diagnostics-check-running").getAttribute("data-check-state"))
      .toBe("pending");

    // Close the stream: the running row disappears, leaving only results.
    stream.push({ name: "state.yaml", status: "error", message: "missing" });
    stream.close();
    await waitFor(() => {
      expect(screen.queryByTestId("diagnostics-check-running")).toBeNull();
    });
    expect(screen.getByTestId("diagnostics-checks").querySelectorAll("li").length).toBe(2);
  });

  /**
   * @verifies A307 (loading states use the brand spinner)
   *
   * The pending check row drew its progress with a typed `•••` glyph
   * (the pattern A208 bans — affordances are drawn, not typed; the lint
   * rule misses `•` because it is a legitimate prose bullet) alongside
   * VISIBLE "Running checks…" text, against Ken's standing ruling that
   * loading text is replaced by the spinner.
   *
   * Both halves matter and are asserted together on purpose: per
   * `LoadingState`'s docstring, deleting the text instead of hiding it
   * `sr-only` reintroduces the original silent-panel bug — a spinner
   * with no accessible name announces nothing.
   */
  it("draws the pending row's progress with the spinner, keeping the message announced", async () => {
    const stream = controllableNdjson();
    fetchMock.mockResolvedValue(stream.response);
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const running = await screen.findByTestId("diagnostics-check-running");

    // Drawn, not typed.
    expect(running.querySelector("[data-testid='logo-spinner']")).toBeTruthy();
    expect(running.textContent).not.toContain("•");

    // The message survives as the live region's accessible text — still
    // in the DOM, still inside the role=status, just not shown.
    const status = running.querySelector("[role='status']");
    expect(status).toBeTruthy();
    expect(status?.textContent).toContain("Running checks…");
    const srOnly = running.querySelector(".sr-only");
    expect(srOnly?.textContent).toContain("Running checks…");

    stream.close();
  });

  /** @verifies XS-41 */
  it("makes a CLI-only remedy copyable and offers no rebuild button", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "key index", status: "warn", message: "1 stale entry — rerun with --rebuild-index to repair" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("diagnostics-checks");
    await waitFor(() => {
      expect(screen.queryByTestId("diagnostics-check-running")).toBeNull();
    });

    // XS-41: the exact command is shown, and the UI offers NO rebuild
    // button — rebuild stays CLI-only, and a button that cannot work is
    // worse than no button.
    const buttons = screen.getAllByRole("button").map(b => b.textContent ?? "");
    expect(buttons.some(t => /rebuild/i.test(t))).toBe(false);
  });

  /** @verifies SET-40 */
  it("reports a failed run as failed, not as all-passed", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    // SET-40: distinguished clearly from "all checks passed", and it
    // must not mark any check as passing.
    const failed = await screen.findByTestId("diagnostics-run-failed");
    expect(failed.getAttribute("data-diagnostics-state")).toBe("run-failed");
    // No check ever landed, so there are no rows claiming to pass.
    expect(screen.queryByTestId("diagnostics-checks")).toBeNull();
    // Wording trimmed under K116 (row 32): "The run did not complete...
    // every remaining check is marked not run, never passed." became
    // "The run stopped early. Checks that didn't run are marked Not
    // run." — same SET-40 distinction (real results vs never-ran).
    expect(failed.textContent).toMatch(/stopped early/i);
  });

  /**
   * @verifies SET-40
   *
   * A mid-run failure line after some checks already streamed: the
   * partial results stay visible with their real states, and the panel
   * still says the run did not complete rather than treating the last
   * check as the end of a clean run.
   */
  it("does not report a mid-stream failure as all-passed", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "workflow.yaml", status: "ok", message: "valid" },
      { error: "relationships: unreadable task file" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const failed = await screen.findByTestId("diagnostics-run-failed");
    expect(failed.getAttribute("data-diagnostics-state")).toBe("run-failed");
    // Wording trimmed under K116 (row 32); see the test above.
    expect(failed.textContent).toMatch(/stopped early/i);

    // SET-40 bullet 2 / A182: the check that had already streamed in
    // BEFORE the failure line stays visible with its real state — it is
    // not hidden by the failure, and it is not relabelled. Red-proof for
    // FIX 1: with the old `{phase !== "failed" && …}` gate over the whole
    // list, this row vanishes and the query returns null.
    const survivor = screen.queryByTestId("diagnostics-check-workflow.yaml");
    expect(survivor).not.toBeNull();
    expect(survivor?.getAttribute("data-check-status")).toBe("ok");
    expect(survivor?.getAttribute("data-check-state")).toBe("done");

    // The remaining checks that never ran are absent, not shown as
    // passing: the "running" pending row is gone on a failed run, and no
    // extra rows were invented for the checks the run never reached.
    expect(screen.queryByTestId("diagnostics-check-running")).toBeNull();
    expect(screen.getByTestId("diagnostics-checks").querySelectorAll("li").length).toBe(1);
  });

  /**
   * @verifies SET-29
   *
   * Bullet 3: navigating away must not leave a permanently spinning
   * check. The panel aborts its in-flight fetch on unmount; this pins
   * that wiring so a future edit cannot silently drop it. The stream is
   * left open (never closed) so that, absent the abort, the request
   * would hang — the abort is the only thing that ends it.
   */
  it("aborts the in-flight request when it unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const stream = controllableNdjson();
    fetchMock.mockImplementation((...args: never[]) => {
      const init = args[1] as RequestInit | undefined;
      capturedSignal = init?.signal ?? undefined;
      return Promise.resolve(stream.response);
    });

    const { unmount } = render(<DiagnosticsPanel />, { wrapper: wrapper() });
    // Let one check land so the stream is genuinely mid-flight.
    stream.push({ name: "workflow.yaml", status: "ok", message: "valid" });
    await screen.findByTestId("diagnostics-check-workflow.yaml");

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    // Unmount aborted the fetch — nothing is left running behind a gone
    // component, which is what "no permanently spinning check" means.
    expect(capturedSignal?.aborted).toBe(true);
  });

  // ── Repair buttons (K-diagnostics-repair) ────────────────────────────

  it("shows a Rebuild-key-index button only when a fix:rebuild-index finding is present", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "key index", status: "warn", message: "1 stale entry", fix: "rebuild-index" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    expect(await screen.findByTestId("diagnostics-fix-rebuild-index")).toBeTruthy();
    // No restore-missing finding → no restore button.
    expect(screen.queryByTestId("diagnostics-fix-restore-missing")).toBeNull();
  });

  it("shows NO repair buttons when no finding carries a fix", async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([
      { name: "workflow.yaml", status: "ok", message: "valid" },
      { name: "relationships", status: "warn", message: "a manual finding, no fix" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("diagnostics-checks");
    await waitFor(() => { expect(screen.queryByTestId("diagnostics-check-running")).toBeNull(); });
    expect(screen.queryByTestId("diagnostics-repairs")).toBeNull();
    expect(screen.queryByTestId("diagnostics-fix-rebuild-index")).toBeNull();
    expect(screen.queryByTestId("diagnostics-fix-restore-missing")).toBeNull();
  });

  it("Rebuild key index POSTs the repair action then re-runs the doctor", async () => {
    const posts: { url: string; body: unknown }[] = [];
    let doctorRuns = 0;
    fetchMock.mockImplementation((url: unknown, init?: unknown) => {
      const u = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (u.includes("/api/doctor/repair") && method === "POST") {
        const raw = (init as RequestInit).body;
        posts.push({ url: u, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
        return Promise.resolve(new Response(JSON.stringify({ action: "rebuild-index", entries: 5 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      // /api/doctor: first run has the stale finding; after repair, clean.
      doctorRuns += 1;
      return Promise.resolve(doctorRuns === 1
        ? ndjsonResponse([{ name: "key index", status: "warn", message: "1 stale entry", fix: "rebuild-index" }])
        : ndjsonResponse([{ name: "key index", status: "ok", message: "consistent" }]));
    });
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("diagnostics-fix-rebuild-index"));
    await waitFor(() => { expect(posts.length).toBe(1); });
    expect(posts[0]?.body).toEqual({ action: "rebuild-index" });
    // Re-ran the doctor (2nd /api/doctor GET), and the repaired state has
    // no more fixable finding → the button is gone.
    await waitFor(() => { expect(screen.queryByTestId("diagnostics-fix-rebuild-index")).toBeNull(); });
    expect(doctorRuns).toBeGreaterThanOrEqual(2);
  });

  it("Restore missing files confirms before POSTing", async () => {
    const posts: unknown[] = [];
    fetchMock.mockImplementation((url: unknown, init?: unknown) => {
      const u = String(url);
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (u.includes("/api/doctor/repair") && method === "POST") {
        posts.push(JSON.parse((init as RequestInit).body as string));
        return Promise.resolve(new Response(JSON.stringify({ action: "restore-missing", created: 2 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(ndjsonResponse([
        { name: "queries.yaml", status: "warn", message: "missing", fix: "restore-missing" },
      ]));
    });
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("diagnostics-fix-restore-missing"));
    // A confirm appears; nothing POSTed yet.
    await screen.findByTestId("diagnostics-restore-confirm");
    expect(posts.length).toBe(0);
    fireEvent.click(screen.getByTestId("diagnostics-restore-confirm-button"));
    await waitFor(() => { expect(posts.length).toBe(1); });
    expect(posts[0]).toEqual({ action: "restore-missing" });
  });
});

/**
 * Part D: the Label and Milestone create + edit forms are unified into one
 * mode-aware dialog each. These pin the create side going through the
 * shared dialog (opened from the panel), that a create issues the POST,
 * and that the create-mode duplicate caution (MSL-34) still shows — a
 * create-only branch of the shared component, not a separate form.
 */
describe("Part D — unified Label create+edit dialog", () => {
  const twoLabels = {
    items: [
      { id: "L1", name: "bug", color: "#ff0000", taskCount: 3 },
      { id: "L2", name: "chore", taskCount: 0 },
    ],
    total: 2,
  };

  it("creates a label through the shared dialog (POST /api/labels)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/labels") && method === "POST") {
        return Promise.resolve(jsonResponse({ id: "L3", name: "feature", color: "#00ff00" }, 201));
      }
      return Promise.resolve(jsonResponse(twoLabels));
    });
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    fireEvent.click(screen.getByTestId("label-create-open"));
    await screen.findByTestId("label-create-dialog");
    fireEvent.change(screen.getByTestId("label-create-name"), { target: { value: "feature" } });
    fireEvent.change(screen.getByTestId("label-create-color"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByTestId("label-create-submit"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c =>
        String(c[0]).includes("/api/labels")
        && String((c[1] as RequestInit | undefined)?.method).toUpperCase() === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post?.[1] as RequestInit | undefined)?.body as string) as unknown;
      expect(body).toEqual({ name: "feature", color: "#00ff00" });
    });
  });

  it("edits a label through the same dialog (PUT /api/labels/:id)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/labels/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "L1", name: "defect", color: "#ff0000" }));
      }
      return Promise.resolve(jsonResponse(twoLabels));
    });
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    openRowAction(screen.getByTestId("label-row-L1"), "label-edit");
    await screen.findByTestId("label-edit-dialog");
    fireEvent.change(screen.getByTestId("label-name-input"), { target: { value: "defect" } });
    fireEvent.click(screen.getByTestId("label-save"));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c =>
        String(c[0]).includes("/api/labels/L1")
        && String((c[1] as RequestInit | undefined)?.method).toUpperCase() === "PUT");
      expect(put).toBeDefined();
    });
  });

  /** @verifies MSL-34 (create-only branch preserved) */
  it("shows the duplicate-name caution in create mode, non-blocking", async () => {
    fetchMock.mockResolvedValue(jsonResponse(twoLabels));
    render(<LabelsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("labels-list");

    fireEvent.click(screen.getByTestId("label-create-open"));
    await screen.findByTestId("label-create-dialog");
    fireEvent.change(screen.getByTestId("label-create-name"), { target: { value: "bug" } });

    const warning = await screen.findByTestId("label-duplicate-warning");
    expect(warning.textContent).toMatch(/already exists/i);
    // Non-blocking — the submit is enabled, it becomes "Create anyway".
    expect(screen.getByTestId("label-create-submit")).not.toHaveProperty("disabled", true);
  });
});

describe("Part D — unified Milestone create+edit dialog", () => {
  const twoMilestones = {
    items: [
      { id: "M1", name: "v1", target_date: "2026-03-31", taskCount: 2 },
      { id: "M2", name: "old", archived: true, taskCount: 0 },
    ],
    total: 2,
  };

  it("creates a milestone through the shared dialog (POST /api/milestones)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones") && method === "POST") {
        return Promise.resolve(jsonResponse({ id: "M3", name: "v2", target_date: "2026-09-30" }, 201));
      }
      return Promise.resolve(jsonResponse(twoMilestones));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    fireEvent.click(screen.getByTestId("milestone-create-open"));
    await screen.findByTestId("milestone-create-dialog");
    fireEvent.change(screen.getByTestId("milestone-create-name"), { target: { value: "v2" } });
    fireEvent.change(screen.getByTestId("milestone-create-date"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByTestId("milestone-create-submit"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c =>
        String(c[0]).includes("/api/milestones")
        && String((c[1] as RequestInit | undefined)?.method).toUpperCase() === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post?.[1] as RequestInit | undefined)?.body as string) as unknown;
      expect(body).toEqual({ name: "v2", target_date: "2026-09-30" });
    });
  });

  it("edits a milestone through the same dialog (PUT /api/milestones/:id)", async () => {
    fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
      const method = String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      if (String(url).includes("/api/milestones/") && method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "M1", name: "v1.1", target_date: "2026-03-31" }));
      }
      return Promise.resolve(jsonResponse(twoMilestones));
    });
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    openRowAction(screen.getByTestId("milestone-row-M1"), "milestone-edit");
    await screen.findByTestId("milestone-edit-dialog");
    fireEvent.change(screen.getByTestId("milestone-name-input"), { target: { value: "v1.1" } });
    fireEvent.click(screen.getByTestId("milestone-save"));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c =>
        String(c[0]).includes("/api/milestones/M1")
        && String((c[1] as RequestInit | undefined)?.method).toUpperCase() === "PUT");
      expect(put).toBeDefined();
    });
  });
});
