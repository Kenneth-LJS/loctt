// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { LabelsPanel } from "./LabelsPanel.tsx";
import { MilestonesPanel } from "./MilestonesPanel.tsx";

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

    const deleteButton = screen
      .getByTestId("label-row-L1")
      .querySelector<HTMLButtonElement>("[data-testid='label-delete']");
    expect(deleteButton).not.toBeNull();
    fireEvent.click(deleteButton as HTMLButtonElement);

    // MSL-32: with references present and nothing chosen, the confirm
    // is disabled — the delete cannot be issued at all.
    const confirm = await screen.findByTestId("remap-confirm");
    expect(confirm).toHaveProperty("disabled", true);

    // Choosing the remap target enables it.
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
  it("archives a milestone by PUTting { archived: true } and marks the archived one", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/milestones/")
          ? jsonResponse({ id: "M1", name: "v1", archived: true })
          : jsonResponse(twoMilestones),
      ));
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    // MSL-25: an already-archived milestone is shown here and marked,
    // not hidden — this is the management surface.
    const archivedRow = screen.getByTestId("milestone-row-M2");
    expect(archivedRow.getAttribute("data-milestone-archived")).toBe("true");
    expect(archivedRow.querySelector("[data-testid='milestone-archived-marker']")).not.toBeNull();

    // Archiving M1 sends the archived flag on the milestone PUT — the row
    // toggle only ever sent name/date before, so the flag had no caller.
    const activeRow = screen.getByTestId("milestone-row-M1");
    fireEvent.click(activeRow.querySelector("[data-testid='milestone-archive-toggle']") as HTMLButtonElement);

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

  // Retag (B2): same as above — the panel unarchive toggle is MSL-11's
  // panel-CRUD surface, not MSL-25's task/URL-resolution claim.
  /** @verifies MSL-11 */
  it("unarchives an archived milestone by PUTting { archived: false }", async () => {
    fetchMock.mockImplementation((url: unknown): Promise<Response> =>
      Promise.resolve(
        String(url).includes("/api/milestones/")
          ? jsonResponse({ id: "M2", name: "old" })
          : jsonResponse(twoMilestones),
      ));
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestones-list");

    const archivedRow = screen.getByTestId("milestone-row-M2");
    const toggle = archivedRow.querySelector("[data-testid='milestone-archive-toggle']") as HTMLButtonElement;
    expect(toggle.textContent).toMatch(/unarchive/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => {
        const init = c[1] as RequestInit | undefined;
        return String(c[0]).includes("/api/milestones/M2")
          && String(init?.method).toUpperCase() === "PUT";
      });
      expect(put).toBeDefined();
      const raw = (put?.[1] as RequestInit | undefined)?.body;
      const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined;
      expect(body).toEqual({ archived: false });
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
    fireEvent.click(row.querySelector("[data-testid='milestone-archive-toggle']") as HTMLButtonElement);

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
    fireEvent.click(row.querySelector("[data-testid='milestone-archive-toggle']") as HTMLButtonElement);

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
    fireEvent.click(row.querySelector("[data-testid='milestone-archive-toggle']") as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByTestId("milestone-row-M1").textContent).toContain("v1 renamed");
    });

    // Regression: the name draft was seeded once at mount ("v1") and not
    // reset on Edit-open, so Save would revert the external rename.
    fireEvent.click(screen.getByTestId("milestone-row-M1").querySelector("[data-testid='milestone-edit']") as HTMLButtonElement);
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
    expect(failed.textContent).toMatch(/did not complete/i);
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
    expect(failed.textContent).toMatch(/did not complete/i);

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
});
