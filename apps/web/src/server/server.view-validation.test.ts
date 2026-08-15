import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `POST /api/views` must reject a query it cannot parse.
 *
 * VUE-6's failure mode: `config/queries.ts` rejects the ENTIRE file on
 * one bad entry, so a single malformed saved view does not merely fail
 * to run — it takes every other saved view with it on the next read.
 */
describe("POST /api/views query validation", () => {
  let root: string;
  let locttDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;
  const csrf = { "Content-Type": "application/json", "X-Loctt-Client": "test" };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-views-"));
    await initLoctt(root);
    locttDir = join(root, ".loctt");
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const create = (name: string, query: string) =>
    fetch(`${base}/api/views`, {
      method: "POST", headers: csrf, body: JSON.stringify({ name, query }),
    });

  it("accepts a valid query", async () => {
    expect((await create("open", "status = backlog")).status).toBe(201);
  });

  it("rejects a syntactically invalid query", async () => {
    const res = await create("broken", "status = = backlog");
    expect(res.status).toBe(400);
  });

  it("rejects a query naming a field that does not exist", async () => {
    // Semantic, not syntactic: this parses fine and matches nothing,
    // which is exactly the case validateQuery exists to distinguish.
    const res = await create("typo", "stat = backlog");
    expect(res.status).toBe(400);
  });

  it("rejects a query naming an unknown status value", async () => {
    expect((await create("ghost", "status = frobnik")).status).toBe(400);
  });

  it("does not persist a rejected view", async () => {
    await create("broken", "status = = backlog");
    const yaml = await readFile(join(locttDir, "config/queries.yaml"), "utf8");
    expect(yaml).not.toContain("broken");
  });

  it("leaves existing views loadable after a rejected save", async () => {
    // The real damage: queries.ts rejects the whole file on one bad
    // entry, so a malformed save destroys every other view's
    // readability, not just its own.
    expect((await create("good", "status = backlog")).status).toBe(201);
    await create("broken", "status = = backlog");

    const listed = await fetch(`${base}/api/views`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { queries: { name: string }[] };
    expect(body.queries.map(v => v.name)).toContain("good");
  });
});
