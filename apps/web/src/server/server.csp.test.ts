import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * UI hardening: the served HTML document must carry a Content-Security-Policy
 * (and framing / nosniff / referrer headers) as defense-in-depth behind the
 * XSS-safe React render path. Static assets must NOT carry the document CSP
 * but must carry `nosniff`.
 *
 * The CSP's `script-src` allows `'self'` plus a SHA-256 hash of every inline
 * <script> in the served index.html — this is what lets the blocking theme
 * script run while blocking arbitrary injected inline script. The hash is
 * derived from the file, so this test pins that the derivation is correct.
 */
describe("web server security headers (CSP / framing / nosniff)", () => {
  let root: string;
  let clientDir: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  // A known inline script (matches the shape of the real SHL-29 theme
  // script). Its hash is what the CSP must whitelist.
  const inlineScript = "\n      (function(){ document.documentElement.dataset.t = '1'; })();\n    ";
  const expectedHash = createHash("sha256").update(inlineScript, "utf8").digest("base64");

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-csp-"));
    await initLoctt(root);

    clientDir = await mkdtemp(join(tmpdir(), "loctt-web-client-"));
    await writeFile(
      join(clientDir, "index.html"),
      `<!doctype html><html><head>`
      + `<script src="/assets/app.js"></script>`
      + `<script>${inlineScript}</script>`
      + `</head><body><div id="root"></div></body></html>`,
      "utf8",
    );
    await mkdir(join(clientDir, "assets"), { recursive: true });
    await writeFile(join(clientDir, "assets", "app.js"), "export const x = 1;\n", "utf8");

    app = createWebApp({ root, port: 0, clientDir });
    await app.start();
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : app.port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
    await rm(clientDir, { recursive: true, force: true });
  });

  it("serves the HTML document with a CSP that whitelists the inline script by hash", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);

    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    // script-src is the wall that matters: 'self' + the inline hash, and
    // nothing looser (no 'unsafe-inline' on scripts).
    expect(csp).toContain(`script-src 'self' 'sha256-${expectedHash}'`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // Clickjacking / plugin / base-tag closed.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    // A180 ruling: external images render inline, so the CSP must permit them.
    expect(csp).toMatch(/img-src[^;]*https:/);
    expect(csp).toMatch(/img-src[^;]*http:/);
    // Avatar preview/crop render <img> from blob: object URLs — the CSP
    // must allow blob: or the avatar feature breaks under enforcement.
    expect(csp).toMatch(/img-src[^;]*blob:/);
  });

  it("sets framing, nosniff and referrer headers on the HTML document", async () => {
    const res = await fetch(`${base}/`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("does NOT put the document CSP on a static asset, but does set nosniff", async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    // A CSP on a script response is useless noise; the document owns the CSP.
    expect(res.headers.get("content-security-policy")).toBeNull();
    // nosniff still matters on assets (MIME-confusion defense).
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
