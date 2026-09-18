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
