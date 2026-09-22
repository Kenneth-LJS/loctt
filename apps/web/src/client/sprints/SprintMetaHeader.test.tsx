// @vitest-environment jsdom
import type { SprintDef } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { SprintMetaHeader } from "./SprintMetaHeader.tsx";

/**
 * SprintMetaHeader — SPR-8's read-by-default / edit-behind-Edit gate.
 *
 * The behaviour under test is the one SPR-8 supersedes the old framing
 * with: the header no longer commits on blur / on change in place. It is
 * read-only until the Edit control is used, and a change is written only
 * when Save is pressed — one PUT per changed field. These assertions turn
 * on the *request* the header issues (whether a write happened at all),
 * not only what renders, because a commit-on-change regression would
 * still render the right value while writing at the wrong time.
 */

const SPRINT: SprintDef = {
  id: "sp_1",
  name: "Before",
  start_date: "2026-06-01",
  end_date: "2026-06-14",
  state: "active",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockResolvedValue(jsonResponse(SPRINT));
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

/** The request body of a fetch call, parsed as JSON. */
function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

/** PUT calls to the sprint endpoint, with their parsed bodies. */
function putBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(c => String(c[0]).includes("/api/sprints/") && (c[1] as RequestInit | undefined)?.method === "PUT")
    .map(c => parseBody(c[1] as RequestInit | undefined));
}

describe("SprintMetaHeader — SPR-8 read-by-default", () => {
  // @verifies SPR-8
  it("renders read-only until Edit is used — no input fields, and the value is text", () => {
    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    expect(screen.getByTestId("sprint-meta").getAttribute("data-sprint-meta-mode")).toBe("read");
    // The name is shown as text, not an editable field.
    expect(screen.getByTestId("sprint-meta-name-value").textContent).toBe("Before");
    expect(screen.queryByTestId("sprint-meta-name")).toBeNull();
    expect(screen.getByTestId("sprint-meta-edit")).toBeTruthy();
  });

  // @verifies SPR-8
  it("does NOT write on change — a field edited without Save issues no PUT", async () => {
    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    const name = await screen.findByTestId("sprint-meta-name");
    fireEvent.change(name, { target: { value: "After" } });
    // The old header committed on blur; the new one must not.
    fireEvent.blur(name);
    // And changing state must not commit on change either.
    pickCombo("sprint-meta-state", "completed");

    // Give any stray mutation a tick to fire.
    await Promise.resolve();
    expect(putBodies()).toEqual([]);
  });

  // @verifies SPR-8
  it("writes only the changed fields when Save is pressed, in ONE combined PUT", async () => {
    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    const name = await screen.findByTestId("sprint-meta-name");
    fireEvent.change(name, { target: { value: "After" } });
    // end_date left unchanged — it must not appear in the PUT.
    pickCombo("sprint-meta-state", "completed");

    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    // A147 option 2: a single combined request, not one PUT per field.
    await waitFor(() => { expect(putBodies().length).toBe(1); });
    const bodies = putBodies();
    expect(bodies[0]).toEqual({ name: "After", state: "completed" });
    // The unchanged fields were never sent.
    const hasEndDate = bodies.some(b => typeof b === "object" && b !== null && "end_date" in b);
    expect(hasEndDate).toBe(false);
  });

  // @verifies SPR-33 A147
  it("moving a sprint window FORWARD sends one combined PUT (no per-field cross-field reject)", async () => {
    // A147 regression: with per-field PUTs, PUT#1 {start_date} merges vs
    // the OLD end_date and core's end<start rule 400s a valid whole edit.
    // One combined PUT validates against the final record and succeeds.
    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    // Old window 2026-06-01 → 2026-06-14; move it wholly LATER.
    fireEvent.change(await screen.findByTestId("sprint-meta-start_date"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-meta-end_date"), { target: { value: "2026-07-14" } });
    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    await waitFor(() => { expect(putBodies().length).toBe(1); });
    // Both dates in one body — never a lone {start_date} that would merge
    // against the stale end and be rejected.
    expect(putBodies()[0]).toEqual({ start_date: "2026-07-01", end_date: "2026-07-14" });
    // Returned to read view: the combined save landed.
    await waitFor(() => {
      expect(screen.getByTestId("sprint-meta").getAttribute("data-sprint-meta-mode")).toBe("read");
    });
  });

  // @verifies SPR-37
  it("a state-transition rejection is NOT anchored under the End-date field", async () => {
    // The server attributes a genuine window error to end_date; a state
    // transition error must not borrow that anchor (it belongs to state).
    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            {
              message: "state transition 'active' -> 'future' is not allowed; pass force=true to override",
              code: "rejected_write",
              data_state: "unchanged",
              field: "state",
            },
            400,
          ),
        );
      }
      return Promise.resolve(jsonResponse(SPRINT));
    });

    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    pickCombo("sprint-meta-state", "future");
    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    // The generic Callout states the failure.
    const err = await screen.findByTestId("sprint-meta-error");
    expect(err.textContent).toContain("not allowed");
    // It must NOT be rendered under the End-date control.
    expect(screen.queryByTestId("sprint-meta-end_date-problem")).toBeNull();
    // It IS shown near the State control.
    expect(screen.getByTestId("sprint-meta-state-problem").textContent).toContain("not allowed");
  });

  // @verifies SPR-8
  it("Cancel discards the draft and writes nothing", async () => {
    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    const name = await screen.findByTestId("sprint-meta-name");
    fireEvent.change(name, { target: { value: "Discarded" } });
    fireEvent.click(screen.getByTestId("sprint-meta-cancel"));

    // Back to read mode, showing the server value, nothing written.
    expect(screen.getByTestId("sprint-meta").getAttribute("data-sprint-meta-mode")).toBe("read");
    expect(screen.getByTestId("sprint-meta-name-value").textContent).toBe("Before");
    expect(putBodies()).toEqual([]);
  });

  // @verifies SPR-28
  it("does NOT clobber a field changed on disk mid-edit — Save diffs against the open-time snapshot", async () => {
    // Fix-review finding 1 (HIGH): the single-PUT rework diffed the draft
    // against the LIVE prop at Save time. If the sprint refreshes underneath
    // an open editor (a concurrent CLI edit; refetchOnWindowFocus), an
    // *untouched* field's draft then differs from the refreshed prop and
    // gets sent, overwriting the external change. Save must diff against the
    // snapshot captured when Edit was opened, so an untouched field is never
    // in the PUT even after the prop changes.
    const { rerender } = render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });

    // Open the editor at goal=undefined / name="Before".
    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    await screen.findByTestId("sprint-meta-name");

    // A concurrent CLI edit sets a goal on the SAME sprint (same id), and a
    // window refocus refetch delivers it as a new prop while the editor is open.
    rerender(<SprintMetaHeader sprint={{ ...SPRINT, goal: "Set by CLI" }} />);

    // The user changes only the name and saves.
    fireEvent.change(screen.getByTestId("sprint-meta-name"), { target: { value: "After" } });
    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    await waitFor(() => { expect(putBodies().length).toBe(1); });
    // Only name is sent. `goal` (untouched by the user) must NOT be in the
    // PUT — sending goal:null here would wipe the CLI's "Set by CLI".
    expect(putBodies()[0]).toEqual({ name: "After" });
    const body = putBodies()[0] as Record<string, unknown>;
    expect("goal" in body).toBe(false);
  });

  // @verifies SPR-37
  it("anchors an invalid start_date error under Start date, not End date", async () => {
    // Fix-review finding 2: the server labels every SprintError field:end_date.
    // An invalid start_date must anchor under start_date, not be stapled to
    // End date by trusting the server's label.
    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            { message: "start_date must be YYYY-MM-DD, got: nope", code: "rejected_write", data_state: "unchanged", field: "end_date" },
            400,
          ),
        );
      }
      return Promise.resolve(jsonResponse(SPRINT));
    });

    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    fireEvent.change(await screen.findByTestId("sprint-meta-start_date"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    // The problem renders under Start date...
    const startProblem = await screen.findByTestId("sprint-meta-start_date-problem");
    expect(startProblem.textContent).toContain("YYYY-MM-DD");
    // ...and NOT under End date (the server's mislabel must not win).
    expect(screen.queryByTestId("sprint-meta-end_date-problem")).toBeNull();
  });

  // @verifies SPR-8
  it("a save failure keeps the editor open with an anchored error (SET-51/SPR-37)", async () => {
    // First PUT rejects; the envelope says it did not land.
    fetchMock.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            { message: "end_date must not be before start_date", code: "rejected_write", data_state: "unchanged", field: "end_date" },
            400,
          ),
        );
      }
      return Promise.resolve(jsonResponse(SPRINT));
    });

    render(<SprintMetaHeader sprint={SPRINT} />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("sprint-meta-edit"));
    fireEvent.change(await screen.findByTestId("sprint-meta-name"), { target: { value: "After" } });
    fireEvent.click(screen.getByTestId("sprint-meta-save"));

    const err = await screen.findByTestId("sprint-meta-error");
    expect(err.textContent).toContain("not saved");
    // Still in edit mode so the user can correct without reloading.
    expect(screen.getByTestId("sprint-meta").getAttribute("data-sprint-meta-mode")).toBe("edit");
    expect(screen.getByTestId<HTMLInputElement>("sprint-meta-name").value).toBe("After");
  });
});
