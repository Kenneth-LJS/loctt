import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies QRY-C2
 *
 * `handleListTasks` had no try/catch, so tokenize/parse/validation
 * errors became `500 {"error":"Internal server error"}` — discarding the
 * message, position and suggestions that validate.ts carries
 * deliberately, and telling the user their query crashed the server
 * rather than that they mistyped a field.
 */
describe("a malformed query is a 4xx that names the problem", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-qerr-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const run = async (q: string): Promise<{ status: number; body: string }> => {
    const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent(q)}`);
    return { status: res.status, body: await res.text() };
  };

  it.each([
    ["syntax error", "status = = done"],
    ["unknown field", "nosuchfield = x"],
    ["unknown enum value", "status = nosuchstatus"],
    ["bracket list", "status in [backlog, done]"],
  ])("returns 4xx naming the problem for %s", async (_label, q) => {
    const { status, body } = await run(q);

    // 500 tells the user they broke the server; they mistyped a query.
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(body).not.toMatch(/Internal server error/);
  });

  it("carries the message the other surfaces give, not a generic one", async () => {
    const { body } = await run("nosuchfield = x");
    // The field name is the one thing the user needs to act.
    expect(body).toMatch(/nosuchfield/);
  });

  it("never answers a malformed query with zero rows", async () => {
    // An empty success is indistinguishable from "nothing matched",
    // which is the failure this whole class of case exists to prevent.
    const { status } = await run("status = = done");
    expect(status).not.toBe(200);
  });

  it("still runs a valid query", async () => {
    const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent("status = backlog")}`);
    expect(res.status).toBe(200);
  });
});

/**
 * @verifies QRY-C7
 *
 * K148: a typed query may name a label; the web list resolves it to the
 * ID the tasks store, as the CLI and MCP do, and refuses a name that
 * matches nothing rather than answering with zero rows.
 */
describe("a query naming a label resolves it (K148)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-qname-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
    const created = await fetch(`${base}/api/labels`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name: "urgent" }),
    });
    const label = (await created.json()) as { id: string };
    for (const [title, labels] of [["tagged", [label.id]], ["plain", []]] as const) {
      await fetch(`${base}/api/tasks`, {
        method: "POST", headers: csrf, body: JSON.stringify({ title, labels }),
      });
    }
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("returns the tasks labelled with that name", async () => {
    const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent("labels = urgent")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { title: string }[] };
    expect(body.items.map(t => t.title)).toEqual(["tagged"]);
  });

  it("refuses a name that matches nothing", async () => {
    const res = await fetch(`${base}/api/tasks?query=${encodeURIComponent("labels = nope")}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("No label named 'nope'");
  });
});

/**
 * @verifies PRU-C15
 *
 * K148: a name shaped like an ID is refused on create and rename, on the
 * web as on the CLI and MCP, as a 400 at the name field.
 */
describe("an ID-shaped name is refused (K148)", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };
  const ID = "01M3JSJ7J3QBTDKH0VT5THF6ET";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-idname-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ["label", "/api/labels", { name: ID }],
    ["saved view", "/api/views", { name: ID, filters: [] }],
  ])("refuses a %s named like an ID", async (_kind, path, body) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: csrf, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error?: string; message?: string; field?: string };
    expect(JSON.stringify(payload)).toContain("That looks like an ID; choose a different name.");
    expect(payload.field).toBe("name");
  });
});
