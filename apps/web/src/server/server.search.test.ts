import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/search` (D2). Builds `text ~ "<q>"` and runs the existing
 * evaluator, so the header box and a hand-typed DSL query agree by
 * construction rather than by two implementations staying in step.
 */
describe("GET /api/search", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-search-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;

    const mk = async (title: string, body?: string) => {
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf,
        body: JSON.stringify({ title, ...(body !== undefined ? { body } : {}) }),
      });
      return (await res.json()) as { key: string };
    };
    await mk("Fix login crash");
    await mk("Improve logout flow");
    await mk("Unrelated chore", "the body mentions a pelican");
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function search(qs: string): Promise<TaskFrontmatterPublic[]> {
    const res = await fetch(`${base}/api/search?${qs}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: TaskFrontmatterPublic[] }).items;
  }

  it("matches on title", async () => {
    const items = await search("q=login");
    expect(items.map(t => t.title)).toEqual(["Fix login crash"]);
  });

  it("is case-insensitive", async () => {
    expect((await search("q=LOGIN")).map(t => t.title)).toEqual(["Fix login crash"]);
  });

  it("matches on the body, not only frontmatter", async () => {
    // `text ~ q` has always read ctx.body, but no caller supplied
    // getBody — so body search was documented and reachable in the
    // evaluator while matching nothing on every surface.
    const items = await search("q=pelican");
    expect(items.map(t => t.title)).toEqual(["Unrelated chore"]);
  });

  it("returns an empty list for a blank q rather than everything", async () => {
    // A stray keystroke must not return the whole tracker.
    expect(await search("q=")).toEqual([]);
    expect(await search("q=%20%20")).toEqual([]);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await search("q=zzzznomatch")).toEqual([]);
  });

  it("cannot be used to inject query structure", async () => {
    // q is passed as a structured value, not interpolated. If it were
    // interpolated this would parse as `text ~ "x" or status = backlog`
    // and return every task.
    const items = await search(`q=${encodeURIComponent('x") or (status = backlog')}`);
    expect(items).toEqual([]);
  });

  it("excludes archived tasks by default and includes them on request", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST", headers: csrf, body: JSON.stringify({ title: "archived login note" }),
    });
    const { key } = await res.json() as { key: string };
    await fetch(`${base}/api/tasks/${key}/archive`, { method: "POST", headers: csrf });

    expect((await search("q=login")).map(t => t.key)).not.toContain(key);
    // K107: the tri-state scope replaces the old `archived=true` boolean.
    expect((await search("q=login&archived=all")).map(t => t.key)).toContain(key);
    // The stale boolean spelling is no longer recognised — it falls back
    // to the default active scope, so the archived task stays excluded.
    expect((await search("q=login&archived=true")).map(t => t.key)).not.toContain(key);
  });

  it("paginates", async () => {
    const res = await fetch(`${base}/api/search?q=lo&limit=1`);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(1);
    // login + logout both match "lo".
    expect(body.total).toBeGreaterThanOrEqual(2);
  });
});
