import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * SET-43 (K86): `GET /api/config/:key` reads a single config domain back
 * from the source of truth, so a settings panel can confirm what it wrote
 * and never drift from disk. It used to 404 for every key.
 *
 * @verifies SET-43
 */

interface Harness { root: string; base: string; stop: () => Promise<void> }
const started: Harness[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop();
    if (h) { await h.stop(); await rm(h.root, { recursive: true, force: true }); }
  }
});

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "loctt-cfgrb-"));
  await initLoctt(root);
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  const h: Harness = { root, base: `http://127.0.0.1:${port}`, stop: () => app.stop() };
  started.push(h);
  return h;
}

describe("GET /api/config/:key (SET-43)", () => {
  it("reads back a routed config value (default) from the source of truth", async () => {
    const { base } = await harness();
    const res = await fetch(`${base}/api/config/git.auto_push`);
    expect(res.status).toBe(200);
    const body = await res.json() as { key?: string; value?: unknown };
    expect(body.key).toBe("git.auto_push");
    // A fresh tracker has no sync state, so the get returns the default
    // rather than erroring — get is never an error path for a valid key.
    expect(typeof body.value).toBe("boolean");
  });

  it("surfaces exactly what core's getConfigValue reports (source of truth)", async () => {
    const { root, base } = await harness();
    // The endpoint must be a faithful read of the source of truth, not a
    // separate opinion — assert it agrees with core's own reader for every
    // routed key. (A write→read round-trip through the git.* keys needs a
    // real git repo to enable; that precondition is the write path's, not
    // SET-43's, so this asserts the read contract directly.)
    const { getConfigValue } = await import("@loctt/core");
    for (const key of ["git.enabled", "git.remote", "git.branch", "git.auto_push", "git.auto_fetch"]) {
      const expected = await getConfigValue(`${root}/.loctt`, key);
      const res = await fetch(`${base}/api/config/${key}`);
      expect(res.status, `key ${key}`).toBe(200);
      const body = await res.json() as { key?: string; value?: unknown };
      expect(body.key).toBe(key);
      expect(body.value, `value for ${key}`).toBe(expected);
    }
  });

  it("404s an unknown key, listing the valid keys (CFG-C3 parity)", async () => {
    const { base } = await harness();
    const res = await fetch(`${base}/api/config/nonsense`);
    expect(res.status).toBe(404);
    const body = await res.json() as { code?: string; field?: string; message?: string };
    expect(body.code).toBe("not_found");
    expect(body.field).toBe("nonsense");
    // CFG-C3 (blocker): the error lists the valid keys — the same list
    // core gives every surface — so a typo is diagnosable.
    expect(body.message).toMatch(/valid keys/i);
    expect(body.message).toContain("git.branch");
  });
});
