import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

describe("web server schema guard", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-schema-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("returns 409 for write endpoints when the schema is too new", async () => {
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/newer version/i);
  });

  it("returns 409 for write endpoints when the schema is missing", async () => {
    await rm(join(root, ".loctt", ".schema-version"));
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(409);
  });

  it("/api/info stays reachable on a bad schema so the banner can read its own state", async () => {
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
    const body = await res.json() as { schemaStatus: { kind: string } };
    expect(["future", "outdated", "unknown"]).toContain(body.schemaStatus.kind);
  });

  it("/api/migrate stays reachable on a bad schema so the banner's button can recover", async () => {
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    const res = await fetch(`${base}/api/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
    });
    // Not 409 — the guard exempts /api/migrate. Returns 400 because
    // migrating *down* from a future schema isn't supported, but that
    // shape comes from the handler, not the gate.
    expect(res.status).not.toBe(409);
  });

  it("static asset paths are not gated by the schema guard", async () => {
    await writeFile(join(root, ".loctt", ".schema-version"), "999\n", "utf-8");
    // Non-/api path with no clientDir set: server returns 404, not 409.
    const res = await fetch(`${base}/some/static/asset.css`);
    expect(res.status).toBe(404);
  });

  it("permits /api/* requests when the schema matches", async () => {
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
  });
});
