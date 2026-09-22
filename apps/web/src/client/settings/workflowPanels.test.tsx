// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { CustomFieldsPanel } from "./CustomFieldsPanel.tsx";
import { EnumCollectionPanel } from "./EnumCollectionPanel.tsx";
import { RelationshipsSettingsPanel } from "./RelationshipsSettingsPanel.tsx";

/**
 * The B2 workflow settings panels: create affordances, custom-field
 * CRUD, and the edit-model (value edits behind an Edit dialog, reorder
 * still inline).
 *
 * The assertions turn on the **request** the panel issues — a create
 * adds the entry and PUTs the whole augmented document — and on the
 * dialog's behaviour on a save failure (stays open, error anchored).
 * The server round-trip against a real tracker is covered elsewhere; a
 * layer in between could repair a wrong value, so what the client sends
 * is pinned here directly.
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

const WORKFLOW: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [
    { key: "todo", label: "To do", category: "pending", default: true },
    { key: "doing", label: "Doing", category: "active" },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [
    { key: "low", label: "Low", value: 10 },
    { key: "high", label: "High", value: 20 },
  ],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [
    {
      key: "blocks", label: "Blocks", kind: "directional",
      inverse: "blocked_by", inverse_label: "Blocked by",
      icon: "ban", color: "#ff0000",
    },
  ],
  custom_fields: [
    { key: "story_points", label: "Story points", type: "number", multi: false, searchable: false },
    {
      key: "size", label: "Size", type: "enum", multi: false, searchable: true,
      values: [
        { key: "s", label: "Small", icon: "circle", color: "#00ff00" },
        { key: "l", label: "Large" },
      ],
    },
  ],
};

const USAGE = {
  path: "/abs/.loctt/config/workflow.yaml",
  statuses: { todo: 0, doing: 0, done: 0 },
  priorities: { low: 0, high: 0 },
  task_types: { task: 0 },
  relationships: { blocks: 2 },
  custom_field_values: { size: { s: 40, l: 0 } },
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

/**
 * Routes the three requests every workflow panel makes: GET
 * /api/workflow (twice — the query and the pre-PUT re-read), GET
 * /api/workflow/usage, and PUT /api/workflow. `putResult` lets a test
 * make the PUT fail. `putBodies` captures what was PUT so a create can
 * be asserted on the wire.
 */
function mockWorkflow(opts?: {
  workflow?: WorkflowConfig;
  putStatus?: number;
  putBody?: unknown;
  /** A different document returned by the pre-PUT re-read (SET-28). */
  freshOnReread?: WorkflowConfig;
}): { putBodies: unknown[] } {
  const putBodies: unknown[] = [];
  let workflowReads = 0;
  fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
    const u = String(url);
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (u.includes("/api/workflow/usage")) {
      return Promise.resolve(jsonResponse(USAGE));
    }
    if (u.includes("/api/workflow") && method === "PUT") {
      const body = (init as { body?: string }).body;
      putBodies.push(body !== undefined ? JSON.parse(body) : undefined);
      if (opts?.putStatus !== undefined && opts.putStatus >= 400) {
        return Promise.resolve(jsonResponse(
          opts.putBody ?? { code: "io_error", message: "EACCES: permission denied, open workflow.yaml" },
          opts.putStatus,
        ));
      }
      return Promise.resolve(jsonResponse(opts?.putBody ?? { rewrittenTaskCount: 0 }));
    }
    if (u.includes("/api/workflow")) {
      workflowReads += 1;
      // The first read is the query; a later read is the pre-PUT re-read
      // — which SET-28 needs to return a hand-edited document.
      if (workflowReads >= 2 && opts?.freshOnReread !== undefined) {
        return Promise.resolve(jsonResponse(opts.freshOnReread));
      }
      return Promise.resolve(jsonResponse(opts?.workflow ?? WORKFLOW));
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
  return { putBodies };
}

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("WorkflowPanelFrame — config path (SET-3)", () => {
  /** @verifies SET-3 — the panel names the file it reflects. This had
   * regressed to a vague "changes appear after you refresh" line that
   * dropped the path entirely; the frame now shows the usage path. */
  it("shows the config file path the panel reflects", async () => {
    mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    const foot = await screen.findByTestId("workflow-config-path");
    expect(foot.textContent).toContain("/abs/.loctt/config/workflow.yaml");
    // The old vague copy is gone.
    expect(foot.textContent).not.toMatch(/after you refresh/i);
  });
});

describe("EnumCollectionPanel — statuses (SET-46)", () => {
  /** @verifies SET-46 */
  it("creates a status: the Create dialog PUTs the augmented document in file order", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByTestId("statuses-create"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "Blocked" } });
    pickCombo("statuses-entry-category", "active");
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    // Added to the end (file order), key derived from the label.
    const keys = put.workflow.statuses.map(s => s.key);
    expect(keys).toEqual(["todo", "doing", "done", "blocked"]);
    const added = put.workflow.statuses.find(s => s.key === "blocked");
    expect(added).toMatchObject({ key: "blocked", label: "Blocked", category: "active" });
  });

  /** @verifies SET-46 */
  it("rejects a duplicate key before any PUT, naming the collision", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByTestId("statuses-create"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "To do" } });
    fireEvent.change(within(dialog).getByTestId("statuses-entry-key"), { target: { value: "todo" } });

    const err = await within(dialog).findByTestId("statuses-entry-key-error");
    expect(err.textContent).toContain("todo");
    expect(within(dialog).getByTestId("statuses-entry-save")).toHaveProperty("disabled", true);
    // No request left the client.
    expect(putBodies.length).toBe(0);
  });

  /**
   * The entry editor migrated from a fixed centered Dialog to the
   * responsive primitive (A273). At narrow width it renders as a bottom
   * sheet, but the SAME testids resolve and it still opens/edits/saves
   * through the same PUT — no forked state. jsdom lacks matchMedia, so
   * `useIsNarrow` reads innerWidth. Red-proof: the testids are the only
   * handle the spec has, so a broken switch that dropped them would fail
   * `findByTestId` here.
   */
  it("still opens, edits and saves at narrow (mobile-drawer) width, testids stable", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const { putBodies } = mockWorkflow();
      render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
      await screen.findByTestId("statuses-list");

      fireEvent.click(screen.getByTestId("statuses-create"));
      const dialog = await screen.findByTestId("statuses-entry-dialog");
      fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "Blocked" } });
      pickCombo("statuses-entry-category", "active");
      fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

      await waitFor(() => { expect(putBodies.length).toBe(1); });
      const put = putBodies[0] as { workflow: WorkflowConfig };
      expect(put.workflow.statuses.find(s => s.key === "blocked")).toMatchObject({ label: "Blocked" });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });
});

describe("EnumCollectionPanel — priorities/task-types (SET-47)", () => {
  /** @verifies SET-47 */
  it("creates a priority and lets the panel renumber value from position", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="priorities" />, { wrapper: wrapper() });
    await screen.findByTestId("priorities-list");

    fireEvent.click(screen.getByTestId("priorities-create"));
    const dialog = await screen.findByTestId("priorities-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("priorities-entry-label"), { target: { value: "Critical" } });
    fireEvent.click(within(dialog).getByTestId("priorities-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.priorities.map(p => p.key)).toEqual(["low", "high", "critical"]);
    // Renumbered from position, 10/20/30.
    expect(put.workflow.priorities.map(p => p.value)).toEqual([10, 20, 30]);
  });

  /** @verifies SET-47 */
  it("creates a task type with just key + label", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="task_types" />, { wrapper: wrapper() });
    await screen.findByTestId("task_types-list");

    fireEvent.click(screen.getByTestId("task_types-create"));
    const dialog = await screen.findByTestId("task_types-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("task_types-entry-label"), { target: { value: "Bug" } });
    fireEvent.click(within(dialog).getByTestId("task_types-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.task_types.map(t => t.key)).toEqual(["task", "bug"]);
  });
});

describe("EnumCollectionPanel — edit-model (SET-28, SET-51)", () => {
  it("value edits live behind an Edit dialog, not inline on the row", async () => {
    mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    // The label is a read-out span, not an <input> that auto-saves on blur.
    const label = screen.getByTestId("statuses-label-todo");
    expect(label.tagName.toLowerCase()).not.toBe("input");
    // The Edit control opens the dialog. Row actions live behind a kebab
    // (K105 affordance rule): open it, then the Edit item is present.
    fireEvent.click(screen.getByRole("button", { name: /Actions for status "To do"/ }));
    expect(screen.getByTestId("statuses-edit-todo")).toBeTruthy();
  });

  /** @verifies SET-51 */
  it("a failed Edit-dialog Save stays open with the error anchored in the dialog", async () => {
    mockWorkflow({ putStatus: 500 });
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for status "Doing"/ }));
    fireEvent.click(screen.getByTestId("statuses-edit-doing"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "In progress" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    // SET-51: the dialog stays open with the error anchored inside it,
    // not thrown as a toast, and the row value did not change.
    const err = await within(dialog).findByTestId("statuses-entry-error");
    expect(err.textContent).toMatch(/EACCES|permission|not saved|denied/i);
    expect(screen.getByTestId("statuses-entry-dialog")).toBeTruthy();
    // A bare inline banner (the reorder path) is NOT shown while a dialog owns the error.
    expect(screen.queryByTestId("workflow-save-error")).toBeNull();
  });

  /** @verifies SET-51 */
  it("Cancel on a failed Edit dialog closes it, discarding the edit", async () => {
    mockWorkflow({ putStatus: 500 });
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for status "Doing"/ }));
    fireEvent.click(screen.getByTestId("statuses-edit-doing"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "In progress" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));
    await within(dialog).findByTestId("statuses-entry-error");

    fireEvent.click(within(dialog).getByTestId("statuses-entry-cancel"));
    await waitFor(() => { expect(screen.queryByTestId("statuses-entry-dialog")).toBeNull(); });
    // The row still shows the original label — the edit was discarded.
    expect(screen.getByTestId("statuses-label-doing").textContent).toBe("Doing");
  });

  /** @verifies SET-28 */
  it("refuses an Edit-dialog Save when the settings changed underneath", async () => {
    // The pre-PUT re-read returns a document whose "doing" status was
    // hand-edited — the panel must refuse rather than clobber it.
    const handEdited: WorkflowConfig = {
      ...WORKFLOW,
      statuses: WORKFLOW.statuses.map(s => (s.key === "doing" ? { ...s, label: "Hand edited" } : s)),
    };
    const { putBodies } = mockWorkflow({ freshOnReread: handEdited });
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for status "Doing"/ }));
    fireEvent.click(screen.getByTestId("statuses-edit-doing"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "In progress" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    // SET-28: the save is refused and nothing was written (the throw
    // happens in `apply`, before the PUT). The error tells the user the
    // settings changed and to reload — it deliberately does NOT name the
    // backing `.yaml` file any more (Ken's report: the GUI should not
    // expose the storage layer for a routine concurrent-edit conflict).
    const err = await within(dialog).findByTestId("statuses-entry-error");
    expect(err.textContent).toMatch(/reload|changed/i);
    expect(err.textContent).not.toMatch(/\.yaml/i);
    expect(putBodies.length).toBe(0);
  });
});

describe("EnumCollectionPanel — edit preserves presentational fields", () => {
  it("editing a status's label leaves its icon and color untouched on the wire", async () => {
    const withIcon: WorkflowConfig = {
      ...WORKFLOW,
      statuses: WORKFLOW.statuses.map(s =>
        s.key === "doing" ? { ...s, icon: "play", color: "#123456" } : s),
    };
    const { putBodies } = mockWorkflow({ workflow: withIcon });
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for status "Doing"/ }));
    fireEvent.click(screen.getByTestId("statuses-edit-doing"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "In progress" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.statuses.find(s => s.key === "doing");
    expect(edited).toMatchObject({ label: "In progress", icon: "play", color: "#123456" });
  });
});

describe("RelationshipsSettingsPanel — create (SET-48)", () => {
  /** @verifies SET-48 */
  it("creates a directional relationship, PUTting the inverse pair", async () => {
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");

    fireEvent.click(screen.getByTestId("relationships-create"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("relationships-entry-label"), { target: { value: "Duplicates" } });
    fireEvent.change(within(dialog).getByTestId("relationships-entry-inverse"), { target: { value: "duplicated_by" } });
    fireEvent.change(within(dialog).getByTestId("relationships-entry-inverse-label"), { target: { value: "Duplicated by" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.relationships.find(r => r.key === "duplicates");
    expect(added).toMatchObject({
      key: "duplicates", label: "Duplicates", kind: "directional",
      inverse: "duplicated_by", inverse_label: "Duplicated by",
    });
  });

  /** @verifies SET-48 */
  it("a symmetric relationship omits the inverse fields entirely", async () => {
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");

    fireEvent.click(screen.getByTestId("relationships-create"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("relationships-entry-label"), { target: { value: "Relates to" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-symmetric"));
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.relationships.find(r => r.key === "relates_to");
    expect(added?.kind).toBe("symmetric");
    expect(added && "inverse" in added).toBe(false);
  });

  /**
   * BUG-1 is fixed (inverse-relationship remap) — a workflow save on a
   * tracker that HAS a relationship in use (blocks: 2 tasks) round-trips.
   * @verifies SET-48
   */
  it("a workflow save succeeds on a tracker that already has a relationship in use (BUG-1 fixed)", async () => {
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");
    // The existing relationship shows its 2-task refcount.
    expect(screen.getByTestId("relationships-refcount-blocks").textContent).toContain("2 task");

    fireEvent.click(screen.getByTestId("relationships-create"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("relationships-entry-label"), { target: { value: "Relates to" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-symmetric"));
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    // The PUT carries BOTH the pre-existing in-use relationship and the new one.
    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.relationships.map(r => r.key)).toEqual(["blocks", "relates_to"]);
  });
});

describe("RelationshipsSettingsPanel — edit preserves presentational fields", () => {
  it("editing a relationship's label keeps its icon and color (they are not in the dialog)", async () => {
    // WORKFLOW's `blocks` carries icon "ban" + color "#ff0000". The Edit
    // dialog has no icon/color controls, so a save that rebuilt the row
    // from the draft alone would silently wipe them.
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");

    // Row actions moved behind a kebab (responsive GROUP A): open it, then Edit.
    fireEvent.click(screen.getByRole("button", { name: /Actions for relationship/ }));
    fireEvent.click(screen.getByTestId("relationships-edit-blocks"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("relationships-entry-label"), { target: { value: "Is blocking" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.relationships.find(r => r.key === "blocks");
    expect(edited).toMatchObject({
      key: "blocks", label: "Is blocking", kind: "directional",
      inverse: "blocked_by", inverse_label: "Blocked by",
      icon: "ban", color: "#ff0000",
    });
  });
});

describe("CustomFieldsPanel — CRUD (SET-49, SET-16)", () => {
  /** @verifies SET-49 */
  it("creates an enum field with values and PUTs the augmented document", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByTestId("custom-fields-create"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "Team" } });
    pickCombo("custom-field-dialog-type", "enum");
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-value-add"));
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-key-0"), { target: { value: "web" } });
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-label-0"), { target: { value: "Web" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.custom_fields.find(f => f.key === "team");
    expect(added).toMatchObject({ key: "team", label: "Team", type: "enum", multi: false });
    expect(added?.values).toEqual([{ key: "web", label: "Web" }]);
  });

  /** @verifies SET-16 */
  it("the Edit dialog locks type and multi, disabled and with the reason shown", async () => {
    mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for custom field "Story points"/ }));
    fireEvent.click(screen.getByTestId("custom-field-edit-story_points"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    // SET-16: the type control is DISABLED (not merely validated on submit).
    expect(within(dialog).getByTestId("custom-field-dialog-type")).toHaveProperty("disabled", true);
    expect(within(dialog).getByTestId("custom-field-dialog-multi")).toHaveProperty("disabled", true);
    // …and it states why.
    const lock = within(dialog).getByTestId("custom-field-dialog-type-lock");
    expect(lock.textContent).toMatch(/stored under this type|fixed after creation/i);
    // Label stays editable — the lock reads as targeted.
    expect(within(dialog).getByTestId("custom-field-dialog-label")).not.toHaveProperty("disabled", true);
  });

  /** @verifies SET-16 */
  it("an Edit save never changes type — it carries the stored type through", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for custom field "Story points"/ }));
    fireEvent.click(screen.getByTestId("custom-field-edit-story_points"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "Points" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-searchable"));
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.custom_fields.find(f => f.key === "story_points");
    // Type unchanged, label and searchable updated.
    expect(edited).toMatchObject({ type: "number", multi: false, label: "Points", searchable: true });
  });

  /** @verifies SET-49 */
  it("editing an enum field's label preserves each value's icon and color", async () => {
    // WORKFLOW's `size` value "s" carries icon "circle" + color "#00ff00".
    // The value rows edit key/label/weight only, so a save that rebuilt
    // the values from the draft alone would wipe the presentational fields.
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for custom field "Size"/ }));
    fireEvent.click(screen.getByTestId("custom-field-edit-size"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    // Change the field label and one value's label — nothing else.
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "T-shirt size" } });
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-label-0"), { target: { value: "Small-ish" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.custom_fields.find(f => f.key === "size");
    expect(edited?.label).toBe("T-shirt size");
    const small = edited?.values?.find(v => v.key === "s");
    // Label updated, icon and color carried through.
    expect(small).toMatchObject({ key: "s", label: "Small-ish", icon: "circle", color: "#00ff00" });
  });

  /** @verifies SET-49 */
  it("deletes an enum value through remap-or-clear, sending the remap table", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    // "size" value "s" is held by 40 tasks — delete demands a choice.
    fireEvent.click(screen.getByTestId("custom-field-value-delete-size-s"));
    const remap = await screen.findByTestId("remap-choice");
    // Clear the field on those tasks.
    fireEvent.click(within(remap.closest("[role='dialog']") ?? remap).getByTestId("remap-clear"));
    fireEvent.click(screen.getByTestId("remap-confirm"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig; remap?: unknown };
    // The value is gone from the field…
    const size = put.workflow.custom_fields.find(f => f.key === "size");
    expect(size?.values?.map(v => v.key)).toEqual(["l"]);
    // …and the clear (null) is in the remap table the server validates.
    expect(put.remap).toEqual({ custom_fields: { size: { s: null } } });
  });
});

describe("Part A — icon + color on statuses (create + edit)", () => {
  it("create carries the chosen icon and color onto the new status", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByTestId("statuses-create"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("statuses-entry-label"), { target: { value: "Blocked" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-icon"));
    // The K104 picker's grid is PORTALLED to document.body (A279), so it
    // is addressed through `screen`, not through the dialog subtree.
    fireEvent.click(screen.getByTestId("icon-option-flag"));
    fireEvent.change(within(dialog).getByTestId("statuses-entry-color"), { target: { value: "#123456" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.statuses.find(s => s.key === "blocked");
    expect(added).toMatchObject({ key: "blocked", label: "Blocked", icon: "flag", color: "#123456" });
  });

  it("edit sets an icon and color on a status that had none", async () => {
    const { putBodies } = mockWorkflow();
    render(<EnumCollectionPanel collection="statuses" />, { wrapper: wrapper() });
    await screen.findByTestId("statuses-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for status "Doing"/ }));
    fireEvent.click(screen.getByTestId("statuses-edit-doing"));
    const dialog = await screen.findByTestId("statuses-entry-dialog");
    fireEvent.click(within(dialog).getByTestId("statuses-entry-icon"));
    // The K104 picker's grid is PORTALLED to document.body (A279), so it
    // is addressed through `screen`, not through the dialog subtree.
    fireEvent.click(screen.getByTestId("icon-option-star"));
    fireEvent.change(within(dialog).getByTestId("statuses-entry-color"), { target: { value: "#abcdef" } });
    fireEvent.click(within(dialog).getByTestId("statuses-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.statuses.find(s => s.key === "doing");
    expect(edited).toMatchObject({ key: "doing", icon: "star", color: "#abcdef" });
  });
});

describe("Part A — icon + color on relationships (create + edit)", () => {
  it("create carries the chosen icon and color onto the new relationship", async () => {
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");

    fireEvent.click(screen.getByTestId("relationships-create"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    fireEvent.change(within(dialog).getByTestId("relationships-entry-label"), { target: { value: "Duplicates" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-symmetric"));
    fireEvent.click(within(dialog).getByTestId("relationships-entry-icon"));
    // The K104 picker's grid is PORTALLED to document.body (A279), so it
    // is addressed through `screen`, not through the dialog subtree.
    fireEvent.click(screen.getByTestId("icon-option-link"));
    fireEvent.change(within(dialog).getByTestId("relationships-entry-color"), { target: { value: "#0a0b0c" } });
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.relationships.find(r => r.key === "duplicates");
    expect(added).toMatchObject({ key: "duplicates", label: "Duplicates", icon: "link", color: "#0a0b0c" });
  });

  it("edit can change a relationship's icon while keeping its color", async () => {
    const { putBodies } = mockWorkflow();
    render(<RelationshipsSettingsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("relationships-list");

    // Row actions live behind a kebab (responsive GROUP A): open it, then Edit.
    fireEvent.click(screen.getByRole("button", { name: /Actions for relationship/ }));
    fireEvent.click(screen.getByTestId("relationships-edit-blocks"));
    const dialog = await screen.findByTestId("relationships-entry-dialog");
    // WORKFLOW's `blocks` starts with icon "ban", color "#ff0000".
    fireEvent.click(within(dialog).getByTestId("relationships-entry-icon"));
    // The K104 picker's grid is PORTALLED to document.body (A279), so it
    // is addressed through `screen`, not through the dialog subtree.
    fireEvent.click(screen.getByTestId("icon-option-flag"));
    fireEvent.click(within(dialog).getByTestId("relationships-entry-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.relationships.find(r => r.key === "blocks");
    expect(edited).toMatchObject({ key: "blocks", icon: "flag", color: "#ff0000" });
  });
});

describe("Part A — icon + color on a custom-field enum value", () => {
  it("create sets an enum value's icon and color", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByTestId("custom-fields-create"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "Severity" } });
    pickCombo("custom-field-dialog-type", "enum");
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-value-add"));
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-key-0"), { target: { value: "high" } });
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-label-0"), { target: { value: "High" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-value-icon-0"));
    // The K104 picker's grid is PORTALLED to document.body (A279), so it
    // is addressed through `screen`, not through the dialog subtree.
    fireEvent.click(screen.getByTestId("icon-option-alert"));
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-value-color-0"), { target: { value: "#ee0000" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.custom_fields.find(f => f.key === "severity");
    const high = added?.values?.find(v => v.key === "high");
    expect(high).toMatchObject({ key: "high", label: "High", icon: "alert", color: "#ee0000" });
  });
});

describe("Part C1 — custom-field task_types scope (create + edit)", () => {
  /** @verifies K91 */
  it("create scopes a field to the chosen task types", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByTestId("custom-fields-create"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "Repro steps" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-scope"));
    // K106 step 2: the options panel now PORTALS to document.body, so it
    // is no longer a descendant of the dialog — the trigger still is.
    // Addressed from `screen` rather than `within(dialog)`; the testid
    // and the assertion are unchanged.
    fireEvent.click(screen.getByTestId("custom-field-dialog-scope-option-task"));
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.custom_fields.find(f => f.key === "repro_steps");
    expect(added?.task_types).toEqual(["task"]);
  });

  /** @verifies K91 */
  it("an empty scope selection stores no task_types (field is global)", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByTestId("custom-fields-create"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.change(within(dialog).getByTestId("custom-field-dialog-label"), { target: { value: "Notes" } });
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const added = put.workflow.custom_fields.find(f => f.key === "notes");
    expect(added).not.toHaveProperty("task_types");
  });

  /** @verifies K91 */
  it("edit can add a task_types scope to a field that had none", async () => {
    const { putBodies } = mockWorkflow();
    render(<CustomFieldsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("custom-fields-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for custom field "Story points"/ }));
    fireEvent.click(screen.getByTestId("custom-field-edit-story_points"));
    const dialog = await screen.findByTestId("custom-field-dialog");
    fireEvent.click(within(dialog).getByTestId("custom-field-dialog-scope"));
    // K106 step 2: the options panel now PORTALS to document.body, so it
    // is no longer a descendant of the dialog — the trigger still is.
    // Addressed from `screen` rather than `within(dialog)`; the testid
    // and the assertion are unchanged.
    fireEvent.click(screen.getByTestId("custom-field-dialog-scope-option-task"));
    fireEvent.click(within(dialog).getByTestId("custom-field-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const edited = put.workflow.custom_fields.find(f => f.key === "story_points");
    expect(edited?.task_types).toEqual(["task"]);
  });
});
