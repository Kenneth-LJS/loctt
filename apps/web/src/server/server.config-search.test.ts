import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createUser,
  initLoctt,
  resolveLocttDir,
} from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * K90: the config-list endpoints take a `?q=` name search so a picker
 * queries the server instead of fetching the whole list and filtering in
 * the browser (which silently truncated past MAX_PAGE_LIMIT=1000). These
 * assert the search filters the choosable list, reports the *filtered*
 * total, is case-insensitive, treats an empty query as "no filter", and
 * — for projects — matches slug and prefix as well as name.
 */
describe("config-list ?q= search (K90)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-qsearch-"));
    await initLoctt(root);
    const dir = resolveLocttDir(root);

    await createLabel(dir, { name: "Bug" });
    await createLabel(dir, { name: "bugfix" });
    await createLabel(dir, { name: "Feature" });

    await createMilestone(dir, { name: "Alpha" });
    await createMilestone(dir, { name: "Beta" });

    await createSprint(dir, { name: "Sprint One", state: "active", start_date: "2026-01-01", end_date: "2026-01-14" });
    await createSprint(dir, { name: "Sprint Two", state: "future", start_date: "2026-01-15", end_date: "2026-01-28" });

    await createUser(dir, { name: "Ada Lovelace" });
    await createUser(dir, { name: "Alan Turing" });

    // A project whose slug and prefix differ from its name, so a `q`
    // hitting only the slug or only the prefix proves those are searched.
    await createProject(dir, { name: "Website", slug: "portal", prefix: "WEB" });
    await createProject(dir, { name: "Backend", slug: "backend", prefix: "BE" });

    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function list(path: string): Promise<{ total: number; items: { name?: string; id: string }[] }> {
    const res = await fetch(`${base}${path}`);
    expect(res.ok).toBe(true);
    return res.json() as Promise<{ total: number; items: { name?: string; id: string }[] }>;
  }

  it("labels: filters by a case-insensitive substring and reports the filtered total", async () => {
    const hit = await list("/api/labels?q=bug");
    expect(hit.items.map(l => l.name).sort()).toEqual(["Bug", "bugfix"]);
    // `total` reflects the filtered set, so a picker can say "N of M".
    expect(hit.total).toBe(2);

    const upper = await list("/api/labels?q=BUG");
    expect(upper.items.map(l => l.name).sort()).toEqual(["Bug", "bugfix"]);
  });

  it("labels: an empty q is 'no filter' (the initial picker view)", async () => {
    const all = await list("/api/labels");
    const empty = await list("/api/labels?q=");
    expect(empty.total).toBe(all.total);
    expect(empty.total).toBeGreaterThanOrEqual(3);
  });

  it("milestones and sprints filter by name", async () => {
    expect((await list("/api/milestones?q=alph")).items.map(m => m.name)).toEqual(["Alpha"]);
    expect((await list("/api/sprints?q=two")).items.map(s => s.name)).toEqual(["Sprint Two"]);
  });

  it("users filter by name", async () => {
    // "ada" matches only Ada; "alan" only Alan (both start with "A", so a
    // prefix that is not shared proves it is the name, not a stray match).
    expect((await list("/api/users?q=ada")).items.map(u => u.name)).toEqual(["Ada Lovelace"]);
    expect((await list("/api/users?q=turing")).items.map(u => u.name)).toEqual(["Alan Turing"]);
  });

  it("projects match on slug and prefix, not only the display name", async () => {
    // slug-only hit (name is "Website", prefix "WEB").
    expect((await list("/api/projects?q=portal")).items.map(p => p.name)).toEqual(["Website"]);
    // prefix-only hit ("BE" is not a substring of "Backend").
    expect((await list("/api/projects?q=BE")).items.map(p => p.name)).toEqual(["Backend"]);
    // name hit still works.
    expect((await list("/api/projects?q=site")).items.map(p => p.name)).toEqual(["Website"]);
  });

  it("q composes with pagination", async () => {
    const page = await list("/api/labels?q=bug&limit=1");
    // Two match, but the page holds one; total still reports the match count.
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});
