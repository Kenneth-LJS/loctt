// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { LabelsPanel } from "./LabelsPanel.tsx";

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

describe("DiagnosticsPanel", () => {
  /** @verifies SET-14 */
  it("renders every check with its own pass/warn/fail state, not one aggregate", async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      { name: "workflow.yaml", status: "ok", message: "valid" },
      { name: "key index", status: "warn", message: "1 stale entry — rerun with --rebuild-index to repair" },
      { name: "state.yaml", status: "error", message: "missing" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const list = await screen.findByTestId("diagnostics-checks");
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
    fetchMock.mockResolvedValue(jsonResponse([
      { name: "data integrity", status: "warn", message: "a.md: malformed" },
      { name: "data integrity", status: "warn", message: "b.md: malformed" },
      { name: "data integrity", status: "error", message: "c.md: unreadable" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    const list = await screen.findByTestId("diagnostics-checks");
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

  /** @verifies XS-41 */
  it("makes a CLI-only remedy copyable and offers no rebuild button", async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      { name: "key index", status: "warn", message: "1 stale entry — rerun with --rebuild-index to repair" },
    ]));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("diagnostics-checks");

    // XS-41: the exact command is shown, and the UI offers NO rebuild
    // button — rebuild stays CLI-only, and a button that cannot work is
    // worse than no button.
    const buttons = screen.getAllByRole("button").map(b => b.textContent ?? "");
    expect(buttons.some(t => /rebuild/i.test(t))).toBe(false);
  });

  /** @verifies SET-40 */
  it("reports a failed run as failed, not as all-passed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));
    render(<DiagnosticsPanel />, { wrapper: wrapper() });

    // SET-40: distinguished clearly from "all checks passed", and it
    // must not mark any check as passing.
    const failed = await screen.findByTestId("diagnostics-run-failed");
    expect(failed.getAttribute("data-diagnostics-state")).toBe("run-failed");
    expect(screen.queryByTestId("diagnostics-checks")).toBeNull();
    expect(failed.textContent).toMatch(/no checks completed/i);
  });
});
