import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * RR-B2 (K136, A352): the security posture SECURITY.md and the README
 * promise, checked claim by claim where a test can check it.
 *
 * The claims, and where each is written:
 * - "the web server binds to `127.0.0.1` only" (SECURITY.md, README):
 *   the listening socket's address, and `main.ts`/`loctt ui` have no
 *   flag that changes it. `dev:host` exposes only Vite; its proxy points
 *   at loopback.
 * - "refuses a request carrying a `Host` header it doesn't recognize"
 *   (DNS rebinding, A206).
 * - "sets a restrictive Content-Security-Policy" (A207).
 * - Nothing on the API opts into cross-origin reads (no CORS headers).
 * - SECURITY.md's link to the README's security section lands on a
 *   heading that exists (the anchor was dead until B34).
 *
 * `server.host-guard.test.ts` and `server.csp.test.ts` test the guard
 * and the header in depth; this file pins the *documented* posture as
 * one case, so a change that breaks what the docs promise fails here.
 *
 * @verifies ONB-C10
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function get(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((done, fail) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: "GET", path, setHost: false, headers },
      (res) => {
        res.resume();
        res.on("end", () => { done({ status: res.statusCode ?? 0, headers: res.headers }); });
      },
    );
    req.on("error", fail);
    req.end();
  });
}

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

describe("documented security posture (SECURITY.md, README Data & security)", () => {
  let root: string;
  let clientDir: string;
  let app: ReturnType<typeof createWebApp>;
  let port: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-posture-"));
    await initLoctt(root);
    clientDir = await mkdtemp(join(tmpdir(), "loctt-web-posture-client-"));
    await writeFile(join(clientDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
    app = createWebApp({ root, port: 0, clientDir });
    await app.start();
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : app.port;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
    await rm(clientDir, { recursive: true, force: true });
  });

  // @verifies ONB-C10
  it("listens on the IPv4 loopback address only", () => {
    const addr = app.server.address();
    expect(typeof addr).toBe("object");
    expect(addr !== null && typeof addr === "object" ? addr.address : "").toBe("127.0.0.1");
  });

  // @verifies ONB-C10
  it("offers no way to bind elsewhere: no host option on either launcher", async () => {
    // `loctt-ui` (main.ts) and `loctt ui` (the CLI) are the two ways to
    // start the server. Neither reads a host/bind flag or env var, so a
    // user cannot talk either into listening on 0.0.0.0.
    const main = await readFile(join(repoRoot, "apps/web/src/server/main.ts"), "utf8");
    const ui = await readFile(join(repoRoot, "apps/cli/src/commands/ui.ts"), "utf8");
    for (const src of [main, ui]) {
      expect(src).not.toMatch(/--host|--bind|LOCTT_HOST|0\.0\.0\.0/);
    }
    // `dev:host` exposes Vite; Vite forwards /api to the server on loopback.
    const vite = await readFile(join(repoRoot, "apps/web/vite.config.ts"), "utf8");
    expect(vite).toMatch(/target:\s*`http:\/\/127\.0\.0\.1:/);
  });

  // @verifies ONB-C10
  it("refuses a foreign Host header and serves a loopback one", async () => {
    expect((await get(port, "/api/info", { Host: "attacker.example" })).status).toBe(403);
    expect((await get(port, "/api/info", { Host: `127.0.0.1:${String(port)}` })).status).toBe(200);
    expect((await get(port, "/api/info", { Host: `localhost:${String(port)}` })).status).toBe(200);
  });

  // @verifies ONB-C10
  it("sends a restrictive Content-Security-Policy with the page", async () => {
    const res = await get(port, "/", { Host: `localhost:${String(port)}` });
    expect(res.status).toBe(200);
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  // @verifies ONB-C10
  it("does not opt the API into cross-origin reads", async () => {
    const res = await get(port, "/api/info", {
      Host: `localhost:${String(port)}`,
      Origin: "https://attacker.example",
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  // @verifies ONB-C10
  it("SECURITY.md's link to the README's security section resolves", async () => {
    const security = await readFile(join(repoRoot, "SECURITY.md"), "utf8");
    const readme = await readFile(join(repoRoot, "README.md"), "utf8");
    const anchors = [...security.matchAll(/README\.md#([\w-]+)/g)].map(m => m[1]);
    expect(anchors.length).toBeGreaterThan(0);
    const slugs = new Set(
      [...readme.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => githubSlug(m[1] ?? "")),
    );
    for (const anchor of anchors) expect(slugs, `README.md#${String(anchor)}`).toContain(anchor);
  });
});
