// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedPanel, batchHeadline } from "./ArchivedPanel.tsx";

/**
 * Settings → Archived (K121 #1): the one web surface that lists archived
 * items. These assert the REQUESTS the panel sends (what a restore or a
 * delete actually does) and what it reports back per item, since "it
 * said restored" and "it restored" are different claims (SET-53/54).
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TASKS = [
  { id: "T1", key: "WEB-1", title: "First", project: "p", status: "done", archived: true, archived_at: "2026-09-20T10:00:00.000Z" },
  { id: "T2", key: "WEB-2", title: "Second", project: "p", status: "done", archived: true, archived_at: "2026-09-19T10:00:00.000Z" },
  { id: "T3", key: "WEB-3", title: "Third", project: "p", status: "done", archived: true, archived_at: "2026-09-18T10:00:00.000Z" },
];

interface Call { readonly url: string; readonly method: string; readonly body: unknown }

let calls: Call[];
/** Per-test override: return a Response to short-circuit the default route. */
let override: ((c: Call) => Response | Promise<Response> | undefined) | undefined;

function page<T>(items: readonly T[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, offset: 0, limit: 1000, ...extra };
}

function route(c: Call): Response {
  const u = c.url;
  if (c.method === "GET") {
    if (u.startsWith("/api/tasks?")) return json(page(TASKS));
    if (u.startsWith("/api/projects?")) {
      return u.includes("archived=archived")
        ? json(page([{ id: "P9", name: "Old project", prefix: "OLD", archived: true }], { default: null, task_counts: { P9: 4 } }))
        : json(page([{ id: "P1", name: "Live project", prefix: "LIV" }], { default: "P1", task_counts: { P1: 2 } }));
    }
    if (u.startsWith("/api/views?")) {
      return json({ queries: u.includes("archived=archived") ? [{ id: "V9", name: "Old view", filters: [], archived: true }] : [] });
    }
    if (u.startsWith("/api/labels?")) {
      return json(page(u.includes("archived=archived")
        ? [{ id: "L8", name: "stale", archived: true, taskCount: 2 }, { id: "L9", name: "unused", archived: true, taskCount: 0 }]
        : [{ id: "L1", name: "bug", taskCount: 1 }]));
    }
    if (u.startsWith("/api/milestones?")) {
      return json(page(u.includes("archived=archived")
        ? [{ id: "M9", name: "v0.1", archived: true, taskCount: 3 }]
        : [{ id: "M1", name: "v1.0", taskCount: 0 }]));
    }
    if (u.startsWith("/api/sprints?")) return json(page([]));
    if (u.startsWith("/api/users?")) {
      return json(page(u.includes("archived=archived")
        ? [{ id: "U9", name: "Gone", archived: true }]
        : [{ id: "U1", name: "Ada" }], { current: "U1" }));
    }
    if (u.startsWith("/api/users/U9/usage")) return json({ id: "U9", assignee: 0, reporter: 0 });
  }
  if (u === "/api/tasks/bulk/archive" || u === "/api/tasks/bulk/delete") {
    const refs = (c.body as { refs: string[] }).refs;
    return json({ bulk_op_id: "op", succeeded: refs, failed: [] });
  }
  return json({ ok: true });
}

beforeEach(() => {
  calls = [];
  override = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const c: Call = {
      url: input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined,
    };
    calls.push(c);
    const o = override?.(c);
    return o ?? route(c);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function writes(): Call[] {
  return calls.filter(c => c.method !== "GET");
}

function rowAction(itemId: string, action: "restore" | "delete"): void {
  const row = screen.getByTestId(`archived-row-${itemId}`);
  const kebab = row.querySelector<HTMLButtonElement>("[aria-label^='Actions for']");
  if (kebab === null) throw new Error("row has no actions kebab");
  fireEvent.click(kebab);
  fireEvent.click(screen.getByTestId(`archived-${action}-${itemId}`));
}

async function openKind(kind: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`archived-kind-${kind}`));
}

async function typeAndConfirm(word: string): Promise<void> {
  const dialog = await screen.findByTestId("archived-delete-dialog");
  const confirm = within(dialog).getByTestId("archived-delete-confirm");
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText(`Type ${word} to confirm`), { target: { value: word } });
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(confirm);
}

describe("Settings → Archived: listing (SET-52)", () => {
  // @verifies SET-52
  it("lists every archivable type with its archived count, fetched with the archived scope", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    const expected: Record<string, string> = {
      tasks: "3", projects: "1", views: "1", labels: "2", milestones: "1", sprints: "0", users: "1",
    };
    for (const [kind, count] of Object.entries(expected)) {
      await waitFor(() => { expect(screen.getByTestId(`archived-kind-${kind}`).getAttribute("data-count")).toBe(count); });
    }
    // Every list read asks the server for archived items only.
    const reads = calls.filter(c => c.method === "GET" && !c.url.includes("/usage"));
    const archivedReads = reads.filter(c => c.url.includes("archived=archived"));
    expect(archivedReads.map(c => c.url.split("?")[0]).sort()).toEqual(
      ["/api/labels", "/api/milestones", "/api/projects", "/api/sprints", "/api/tasks", "/api/users", "/api/views"],
    );
  });

  // @verifies SET-52
  it("shows a type's items as a plain list with when they were archived, and no search or filter", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    const row = await screen.findByTestId("archived-row-T1");
    expect(row.textContent).toContain("WEB-1");
    expect(row.textContent).toContain("First");
    expect(within(row).getByTestId("archived-at").textContent).toContain("Archived 2026-09-20");
    // SET-52: no search box and no filter — the only text input on the
    // page would be one.
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    await openKind("labels");
    expect((await screen.findByTestId("archived-row-L8")).textContent).toContain("stale");
    expect(screen.queryByTestId("archived-row-T1")).toBeNull();
  });

  it("says a type has nothing archived rather than rendering a blank list", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("sprints");
    expect((await screen.findByTestId("archived-empty")).textContent).toContain("No archived sprints.");
  });
});

describe("Settings → Archived: restore (SET-53)", () => {
  // @verifies SET-53
  it("restores one task from its row with a bulk unarchive of exactly that task", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await screen.findByTestId("archived-row-T2");
    rowAction("T2", "restore");
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]).toMatchObject({ url: "/api/tasks/bulk/archive", method: "POST", body: { refs: ["T2"], archive: false } });
    expect((await screen.findByTestId("archived-outcome")).textContent).toContain("Restored 1 task.");
  });

  // @verifies SET-53
  it("\"Restore selected\" restores exactly the selected rows", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("archived-select-T1"));
    fireEvent.click(screen.getByTestId("archived-select-T3"));
    fireEvent.click(screen.getByTestId("archived-restore-selected"));
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]?.body).toEqual({ refs: ["T1", "T3"], archive: false });
  });

  // @verifies SET-53
  it("\"Restore all\" restores every archived item of the type", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await screen.findByTestId("archived-row-T1");
    fireEvent.click(screen.getByTestId("archived-restore-all"));
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]?.body).toEqual({ refs: ["T1", "T2", "T3"], archive: false });
  });

  // @verifies SET-53
  it("restores config entities one request each, through each type's own unarchive route", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("labels");
    await screen.findByTestId("archived-row-L8");
    fireEvent.click(screen.getByTestId("archived-restore-all"));
    await waitFor(() => { expect(writes()).toHaveLength(2); });
    expect(writes().map(w => `${w.method} ${w.url}`)).toEqual([
      "POST /api/labels/L8/unarchive",
      "POST /api/labels/L9/unarchive",
    ]);

    await openKind("milestones");
    await screen.findByTestId("archived-row-M9");
    rowAction("M9", "restore");
    await waitFor(() => { expect(writes()).toHaveLength(3); });
    expect(writes()[2]).toMatchObject({ method: "PUT", url: "/api/milestones/M9", body: { archived: false } });
  });

  // @verifies SET-53
  it("reports a partial task restore per item and keeps the failed one selected", async () => {
    override = c => (c.url === "/api/tasks/bulk/archive"
      ? json({ bulk_op_id: "op", succeeded: ["T1"], failed: [{ taskId: "T2", error: "task file is locked" }] })
      : undefined);
    render(<ArchivedPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("archived-select-T1"));
    fireEvent.click(screen.getByTestId("archived-select-T2"));
    fireEvent.click(screen.getByTestId("archived-restore-selected"));

    const notice = await screen.findByTestId("archived-failure");
    expect(notice.textContent).toContain("Restored 1 of 2 tasks. 1 task wasn't restored.");
    expect(screen.getByTestId("archived-failure-item-T2").textContent).toContain("WEB-2 Second: task file is locked");
    expect(screen.queryByTestId("archived-failure-item-T1")).toBeNull();
    // Try again acts on exactly what failed.
    await waitFor(() => { expect(screen.getByTestId("archived-select-T2")).toHaveProperty("checked", true); });
    override = undefined;
    fireEvent.click(screen.getByTestId("archived-failure-retry"));
    await waitFor(() => { expect(writes()).toHaveLength(2); });
    expect(writes()[1]?.body).toEqual({ refs: ["T2"], archive: false });
  });

  // @verifies SET-53
  it("reports one failed config restore by name while the others succeed", async () => {
    override = c => (c.url === "/api/labels/L8/unarchive"
      ? json({ code: "validation_failed", message: "a label named stale already exists", data_state: "not_saved" }, 400)
      : undefined);
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("labels");
    await screen.findByTestId("archived-row-L8");
    fireEvent.click(screen.getByTestId("archived-restore-all"));
    const notice = await screen.findByTestId("archived-failure");
    expect(notice.textContent).toContain("Restored 1 of 2 labels. 1 label wasn't restored.");
    expect(notice.getAttribute("data-data-state")).toBe("not_saved");
    expect(screen.getByTestId("archived-failure-item-L8").textContent).toContain("stale: a label named stale already exists");
  });

  // @verifies SET-53
  it("says an unknown outcome is unknown and offers no retry (ERR-4)", async () => {
    override = c => (c.url === "/api/tasks/bulk/archive"
      ? json({ code: "unknown", message: "the server stopped responding", data_state: "unknown" }, 503)
      : undefined);
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await screen.findByTestId("archived-row-T1");
    rowAction("T1", "restore");
    const notice = await screen.findByTestId("archived-failure");
    expect(notice.textContent).toContain("Couldn't confirm 1 task was restored. Reload to check.");
    expect(notice.getAttribute("data-data-state")).toBe("unknown");
    expect(screen.queryByTestId("archived-failure-retry")).toBeNull();
  });
});

describe("Settings → Archived: delete (SET-54)", () => {
  // @verifies SET-54
  it("\"Delete all\" is a typed confirmation naming each item and saying it is permanent", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await screen.findByTestId("archived-row-T1");
    fireEvent.click(screen.getByTestId("archived-delete-all"));
    const dialog = await screen.findByTestId("archived-delete-dialog");
    expect(screen.getByRole("dialog", { name: "Permanently delete 3 tasks?" })).toBeTruthy();
    const names = within(dialog).getByTestId("archived-delete-names");
    expect(names.textContent).toContain("WEB-1 First");
    expect(names.textContent).toContain("WEB-3 Third");
    expect(dialog.textContent).toContain("Deleting is permanent.");
    // Nothing is sent before the word is typed.
    expect(writes()).toHaveLength(0);
    await typeAndConfirm("DELETE");
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]).toMatchObject({
      url: "/api/tasks/bulk/delete",
      body: { refs: ["T1", "T2", "T3"], confirm: "DELETE" },
    });
    expect((await screen.findByTestId("archived-outcome")).textContent).toContain("Deleted 3 tasks.");
  });

  // @verifies SET-54
  it("\"Delete selected\" on referenced labels says the tasks lose them, then clears (no remap)", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("labels");
    fireEvent.click(await screen.findByTestId("archived-select-L8"));
    fireEvent.click(screen.getByTestId("archived-delete-selected"));
    const dialog = await screen.findByTestId("archived-delete-dialog");
    expect(screen.getByRole("dialog", { name: "Permanently delete 1 label?" })).toBeTruthy();
    expect(within(dialog).getByTestId("archived-delete-consequence").textContent)
      .toBe("2 tasks still use it. Deleting removes it from those tasks.");
    await typeAndConfirm("DELETE");
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]).toMatchObject({ method: "DELETE", url: "/api/labels/L8" });
  });

  // @verifies SET-54
  it("a referenced milestone's row Delete follows the milestone remap-or-clear flow", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("milestones");
    await screen.findByTestId("archived-row-M9");
    rowAction("M9", "delete");
    // The shared RemapDeleteDialog: the count, the required choice, and
    // live milestones only as remap targets.
    expect((await screen.findByTestId("remap-refcount")).textContent).toContain("3 tasks currently use");
    expect(screen.getByTestId("remap-choice")).toBeTruthy();
    expect(screen.getByTestId("remap-permanent").textContent).toContain("Deleting is permanent.");
    expect(screen.getByTestId("remap-confirm")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("remap-clear"));
    fireEvent.click(screen.getByTestId("remap-confirm"));
    await waitFor(() => { expect(writes()).toHaveLength(1); });
    expect(writes()[0]).toMatchObject({ method: "DELETE", url: "/api/milestones/M9" });
  });

  // @verifies SET-54
  it("a project's row Delete opens the project delete dialog without offering archive again", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("projects");
    await screen.findByTestId("archived-row-P9");
    rowAction("P9", "delete");
    const dialog = await screen.findByTestId("project-delete-dialog");
    expect(dialog.textContent).toContain("4 tasks reference this project.");
    expect(dialog.textContent).toContain("Deleting is permanent.");
    expect(dialog.textContent).not.toContain("Archiving hides the project");
  });

  // @verifies SET-54
  it("a user's row Delete opens the user delete dialog without \"Archive instead\"", async () => {
    render(<ArchivedPanel />, { wrapper: wrapper() });
    await openKind("users");
    await screen.findByTestId("archived-row-U9");
    rowAction("U9", "delete");
    await screen.findByTestId("user-delete-dialog");
    expect(screen.queryByTestId("user-delete-archive-instead")).toBeNull();
  });

  // @verifies SET-54
  it("a failed delete is reported per item and the item is not shown as deleted", async () => {
    override = c => (c.url === "/api/tasks/bulk/delete"
      ? json({ bulk_op_id: "op", succeeded: ["T1"], failed: [{ taskId: "T3", error: "permission denied" }] })
      : undefined);
    render(<ArchivedPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("archived-select-T1"));
    fireEvent.click(screen.getByTestId("archived-select-T3"));
    fireEvent.click(screen.getByTestId("archived-delete-selected"));
    await typeAndConfirm("DELETE");
    const notice = await screen.findByTestId("archived-failure");
    expect(notice.textContent).toContain("Deleted 1 of 2 tasks. 1 task wasn't deleted.");
    expect(screen.getByTestId("archived-failure-item-T3").textContent).toContain("permission denied");
  });
});

describe("batchHeadline", () => {
  const item = (id: string) => ({ id, name: id });
  it("says the number, and says unknown when the outcome is unknown", () => {
    expect(batchHeadline({ kind: "labels", action: "delete", succeeded: [item("a"), item("b")], failed: [] }))
      .toBe("Deleted 2 labels.");
    expect(batchHeadline({
      kind: "users", action: "restore", succeeded: [],
      failed: [{ item: item("a"), message: "x", dataState: "not_saved" }],
    })).toBe("1 user wasn't restored.");
    expect(batchHeadline({
      kind: "views", action: "delete", succeeded: [item("a")],
      failed: [{ item: item("b"), message: "x", dataState: "unknown" }, { item: item("c"), message: "x", dataState: "unknown" }],
    })).toBe("Deleted 1 of 3 saved views. Couldn't confirm 2 saved views were deleted. Reload to check.");
  });
});
