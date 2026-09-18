import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Project scope, applied server-side.
 *
 * PRU-2's last bullet is the one worth a test: "the server actually
 * filtered — the returned set excludes tasks from other projects,
 * rather than the client narrowing a full response". A client-side
 * narrowing looks identical on screen and is wrong the moment the
 * result is paginated, exported, or counted.
 */
describe("GET /api/tasks?project=", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  let webId: string;
  let apiId: string;

  const headers = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-scope-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;

    const projects = await (await fetch(`${base}/api/projects`)).json() as {
      items: { id: string }[];
    };
    webId = projects.items[0]?.id ?? "";

    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Second", prefix: "SEC" }),
    });
    apiId = ((await created.json()) as { id: string }).id;

    for (const [project, title] of [
      [webId, "in the first project"],
      [apiId, "in the second project"],
    ] as const) {
      await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, project }),
      });
    }
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function titles(qs: string): Promise<{ titles: string[]; total: number }> {
    const res = await fetch(`${base}/api/tasks${qs}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: { title: string }[]; total: number };
    return { titles: body.items.map(t => t.title), total: body.total };
  }

  /**
   * @verifies PRU-2
   */
  it("excludes other projects from the response, not just from the view", async () => {
    const all = await titles("");
    expect(all.titles).toContain("in the first project");
    expect(all.titles).toContain("in the second project");

    const scoped = await titles(`?project=${webId}`);
    expect(scoped.titles).toContain("in the first project");
    // Absent from the payload, not merely hidden by the client.
    expect(scoped.titles).not.toContain("in the second project");
    // And `total` reflects the scope, so pagination and count badges
    // agree with the rows.
    expect(scoped.total).toBeLessThan(all.total);
    expect(scoped.total).toBe(scoped.titles.length);
  });

  /**
   * @verifies PRU-2
   *
   * The URL is the whole state: two requests carrying the same scope
   * must produce the same rows in the same order, because nothing
   * about the scope lives in the client.
   */
  it("is reproducible from the URL alone", async () => {
    const first = await titles(`?project=${apiId}`);
    const second = await titles(`?project=${apiId}`);
    expect(second.titles).toEqual(first.titles);
    expect(first.titles).toEqual(["in the second project"]);
  });

  it("resolves a project SLUG, not only a ULID (K3, PRU-6)", async () => {
    // K3 rules that URLs carry a slug rather than a ULID, and PRU-6's
    // last bullet requires `?project=backend` to keep resolving after
    // a rename. `findProjectBySlug` was in core and called nowhere
    // from the server, so a slug returned an **empty list** — the task
    // was there and a ULID filter found it, but the slug found
    // nothing. An empty result reads as "no matches", not as "this
    // filter is broken", which is how it survived.
    const projects = await (await fetch(`${base}/api/projects`, { headers })).json() as {
      items: { id: string; name: string; slug?: string }[];
    };
    const second = projects.items.find(p => p.name === "Second");
    expect(second?.slug, "K3 requires a generated slug").toBeDefined();

    const bySlug = await (await fetch(
      `${base}/api/tasks?project=${second?.slug ?? ""}`,
      { headers },
    )).json() as { items: { title: string }[] };
    expect(bySlug.items.map(t => t.title)).toEqual(["in the second project"]);

    // The same filter by id, so a slug that silently fell back to
    // "no filter" would not pass the assertion above by accident.
    const byId = await (await fetch(
      `${base}/api/tasks?project=${second?.id ?? ""}`,
      { headers },
    )).json() as { items: { title: string }[] };
    expect(byId.items.map(t => t.title)).toEqual(bySlug.items.map(t => t.title));

    // An unknown value must still filter to nothing rather than
    // becoming a pass-through that returns everything.
    const unknown = await (await fetch(
      `${base}/api/tasks?project=no-such-slug`,
      { headers },
    )).json() as { items: unknown[] };
    expect(unknown.items).toHaveLength(0);
  });
});
