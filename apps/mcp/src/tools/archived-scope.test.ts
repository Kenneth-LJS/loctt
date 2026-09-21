import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../index.js";

/**
 * @verifies K107 — the tri-state `archived` scope on every config-entity
 * list tool (list_milestones, list_sprints, list_labels, list_projects,
 * list_users, list_views).
 *
 * The default scope is `active` (archived hidden), `archived` returns only
 * archived, and `all` returns both — one spelling shared by all six via
 * the `configListInputSchema` (`archived: z.enum(...)`), applied through
 * core's `applyArchivedScope`. Before K107, list_labels/list_projects/
 * list_views/list_milestones/list_sprints defaulted to showing archived
 * (no scope at all), and list_users used a boolean `include_archived`.
 * These exercise the change through the dispatcher (`executeTool`), the
 * same path the host uses.
 */
describe("MCP config-list archived scope (K107)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-mcp-k107-"));
    await initLoctt(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const idOf = (text: string): string => (JSON.parse(text) as { id: string }).id;
  const parse = <T,>(text: string): T => JSON.parse(text) as T;

  it("list_milestones defaults to active, and archived/all widen the scope", async () => {
    const live = idOf((await executeTool(root, "create_milestone", { name: "Live" })).content[0]?.text ?? "");
    const gone = idOf((await executeTool(root, "create_milestone", { name: "Gone" })).content[0]?.text ?? "");
    await executeTool(root, "archive_milestone", { milestone: gone });

    const active = parse<{ milestones: Array<{ id: string }> }>(
      (await executeTool(root, "list_milestones", {})).content[0]?.text ?? "",
    ).milestones.map(m => m.id);
    expect(active).toContain(live);
    expect(active).not.toContain(gone);

    const onlyArchived = parse<{ milestones: Array<{ id: string }> }>(
      (await executeTool(root, "list_milestones", { archived: "archived" })).content[0]?.text ?? "",
    ).milestones.map(m => m.id);
    expect(onlyArchived).toEqual([gone]);

    const all = parse<{ milestones: Array<{ id: string }> }>(
      (await executeTool(root, "list_milestones", { archived: "all" })).content[0]?.text ?? "",
    ).milestones.map(m => m.id);
    expect(all).toContain(live);
    expect(all).toContain(gone);
  });

  it("list_sprints defaults to active, and archived/all widen the scope", async () => {
    const live = idOf((await executeTool(root, "create_sprint", {
      name: "Live", start_date: "2026-01-01", end_date: "2026-01-14", state: "active",
    })).content[0]?.text ?? "");
    const gone = idOf((await executeTool(root, "create_sprint", {
      name: "Gone", start_date: "2026-02-01", end_date: "2026-02-14", state: "future",
    })).content[0]?.text ?? "");
    await executeTool(root, "archive_sprint", { sprint: gone });

    const active = parse<{ sprints: Array<{ id: string }> }>(
      (await executeTool(root, "list_sprints", {})).content[0]?.text ?? "",
    ).sprints.map(s => s.id);
    expect(active).toContain(live);
    expect(active).not.toContain(gone);

    const onlyArchived = parse<{ sprints: Array<{ id: string }> }>(
      (await executeTool(root, "list_sprints", { archived: "archived" })).content[0]?.text ?? "",
    ).sprints.map(s => s.id);
    expect(onlyArchived).toEqual([gone]);

    const all = parse<{ sprints: Array<{ id: string }> }>(
      (await executeTool(root, "list_sprints", { archived: "all" })).content[0]?.text ?? "",
    ).sprints.map(s => s.id);
    expect(all).toContain(live);
    expect(all).toContain(gone);
  });

  it("list_labels hides archived by default (behavior change from show-all)", async () => {
    const live = idOf((await executeTool(root, "create_label", { name: "Live" })).content[0]?.text ?? "");
    const gone = idOf((await executeTool(root, "create_label", { name: "Gone" })).content[0]?.text ?? "");
    await executeTool(root, "archive_label", { label: gone });

    const active = parse<{ labels: Array<{ id: string }> }>(
      (await executeTool(root, "list_labels", {})).content[0]?.text ?? "",
    ).labels.map(l => l.id);
    expect(active).toContain(live);
    expect(active).not.toContain(gone);

    const all = parse<{ labels: Array<{ id: string }> }>(
      (await executeTool(root, "list_labels", { archived: "all" })).content[0]?.text ?? "",
    ).labels.map(l => l.id);
    expect(all).toContain(gone);

    const onlyArchived = parse<{ labels: Array<{ id: string }> }>(
      (await executeTool(root, "list_labels", { archived: "archived" })).content[0]?.text ?? "",
    ).labels.map(l => l.id);
    expect(onlyArchived).toEqual([gone]);
  });

  it("list_projects hides archived by default (behavior change from show-all)", async () => {
    // initLoctt seeds a default project; archive a second one we add.
    await executeTool(root, "create_project", { name: "Live", prefix: "LIV" });
    const gone = idOf((await executeTool(root, "create_project", { name: "Gone", prefix: "GON" })).content[0]?.text ?? "");
    await executeTool(root, "archive_project", { project: gone });

    const active = parse<{ projects: Array<{ id: string }> }>(
      (await executeTool(root, "list_projects", {})).content[0]?.text ?? "",
    ).projects.map(p => p.id);
    expect(active).not.toContain(gone);

    const all = parse<{ projects: Array<{ id: string }> }>(
      (await executeTool(root, "list_projects", { archived: "all" })).content[0]?.text ?? "",
    ).projects.map(p => p.id);
    expect(all).toContain(gone);

    const onlyArchived = parse<{ projects: Array<{ id: string }> }>(
      (await executeTool(root, "list_projects", { archived: "archived" })).content[0]?.text ?? "",
    ).projects.map(p => p.id);
    expect(onlyArchived).toEqual([gone]);
  });

  it("list_users hides archived by default; `archived` replaces `include_archived`", async () => {
    const live = idOf((await executeTool(root, "create_user", { name: "Live" })).content[0]?.text ?? "");
    const gone = idOf((await executeTool(root, "create_user", { name: "Gone" })).content[0]?.text ?? "");
    // archive_user is blocked on the active user; a freshly created user is
    // not active, so archiving `gone` is fine.
    await executeTool(root, "archive_user", { ref: gone });

    const active = parse<{ users: Array<{ id: string }> }>(
      (await executeTool(root, "list_users", {})).content[0]?.text ?? "",
    ).users.map(u => u.id);
    expect(active).toContain(live);
    expect(active).not.toContain(gone);

    const all = parse<{ users: Array<{ id: string }> }>(
      (await executeTool(root, "list_users", { archived: "all" })).content[0]?.text ?? "",
    ).users.map(u => u.id);
    expect(all).toContain(gone);

    const onlyArchived = parse<{ users: Array<{ id: string }> }>(
      (await executeTool(root, "list_users", { archived: "archived" })).content[0]?.text ?? "",
    ).users.map(u => u.id);
    expect(onlyArchived).toEqual([gone]);
  });

  it("list_views hides archived by default; archived/all widen the scope", async () => {
    const live = idOf((await executeTool(root, "create_view", { name: "live", query: "status = backlog" })).content[0]?.text ?? "");
    const gone = idOf((await executeTool(root, "create_view", { name: "gone", query: "status = done" })).content[0]?.text ?? "");
    await executeTool(root, "archive_view", { view: gone });

    const active = parse<Array<{ id: string }>>(
      (await executeTool(root, "list_views", {})).content[0]?.text ?? "",
    ).map(v => v.id);
    expect(active).toContain(live);
    expect(active).not.toContain(gone);

    const all = parse<Array<{ id: string }>>(
      (await executeTool(root, "list_views", { archived: "all" })).content[0]?.text ?? "",
    ).map(v => v.id);
    expect(all).toContain(live);
    expect(all).toContain(gone);

    const onlyArchived = parse<Array<{ id: string }>>(
      (await executeTool(root, "list_views", { archived: "archived" })).content[0]?.text ?? "",
    ).map(v => v.id);
    expect(onlyArchived).toEqual([gone]);
  });
});
