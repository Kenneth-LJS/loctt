import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RecentTaskResponse } from "@loctt/contracts";
import { getCurrentUser, initLoctt, pushRecent } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `GET /api/recents` resolves the current user's recent-task ids to
 * frontmatter for the sidebar's "Recently viewed" group. The route is
 * read-only — the *writing* of recents (pushRecent on task-detail
 * mount) belongs to M2 — so these tests seed the recents file directly
 * via core and assert the route's read/resolve/paginate behaviour.
 */
describe("GET /api/recents", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-recents-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function createTask(title: string): Promise<{ id: string; key: string }> {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ title }),
    });
    return (await res.json()) as { id: string; key: string };
  }

  it("returns an empty page when nothing has been viewed", async () => {
    const res = await fetch(`${base}/api/recents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: RecentTaskResponse[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("resolves recent ids to task frontmatter, most-recent-first", async () => {
    const a = await createTask("First task");
    const b = await createTask("Second task");
    const user = await getCurrentUser(locttDir);
    // Push a then b — b is more recent, so it should come back first.
    await pushRecent(locttDir, user!.id, a.id, "2026-01-01T00:00:00.000Z");
    await pushRecent(locttDir, user!.id, b.id, "2026-01-02T00:00:00.000Z");

    const res = await fetch(`${base}/api/recents`);
    const body = (await res.json()) as { items: RecentTaskResponse[]; total: number };
    expect(body.items.map(i => i.key)).toEqual([b.key, a.key]);
    expect(body.items[0]?.title).toBe("Second task");
    expect(body.items[0]?.at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("drops entries whose task no longer exists", async () => {
    const live = await createTask("Still here");
    const user = await getCurrentUser(locttDir);
    const bogusId = "01JZZZZZZZZZZZZZZZZZZZZZZZ";
    // A recents entry pointing at a non-existent id must be skipped
    // rather than 500 or surface a dangling row.
    await pushRecent(locttDir, user!.id, bogusId, "2026-02-03T00:00:00.000Z");
    await pushRecent(locttDir, user!.id, live.id, "2026-02-04T00:00:00.000Z");

    const res = await fetch(`${base}/api/recents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: RecentTaskResponse[] };
    const keys = body.items.map(i => i.key);
    // The live task is present; the bogus id resolves to nothing and
    // is dropped — never surfaced as a key or a malformed row.
    expect(keys).toContain(live.key);
    expect(keys).not.toContain(bogusId);
    expect(body.items.every(i => typeof i.key === "string" && i.key.length > 0)).toBe(true);
  });

  it("honours limit/offset pagination", async () => {
    const res = await fetch(`${base}/api/recents?limit=1&offset=0`);
    const body = (await res.json()) as { items: RecentTaskResponse[]; limit: number };
    expect(body.items).toHaveLength(1);
    expect(body.limit).toBe(1);
  });
});
