import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * DNS-rebinding guard (known-gaps "The local server has no Host/Origin
 * validation").
 *
 * The server binds 127.0.0.1, which blocks direct off-machine access but
 * not DNS rebinding: a hostile public page can rebind its hostname to
 * 127.0.0.1 and then issue same-origin GETs to read the tracker. The
 * fix validates the `Host` header on every request and refuses anything
 * that is not a loopback name the server legitimately serves.
 *
 * These use raw `http.request` (not `fetch`) because `fetch` forbids
 * setting the `Host` header — we must forge a foreign host to exercise
 * the guard.
 *
 * RED-PROOF: with `requireAllowedHost` removed from `handleRequest`, the
 * "foreign Host returns 403" case fails — the request routes to
 * `/api/info` and returns 200 with the tracker payload. Restoring the
 * guard makes it 403 again while the loopback-host cases stay 200.
 */
describe("web server DNS-rebinding Host guard", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let port: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-host-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : app.port;
  });

  afterAll(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  /**
   * GET /api/info with an explicit `Host` header, over a raw socket
   * connected to 127.0.0.1:port. Returns the status code and body.
   */
  function getWithHost(hostHeader: string | undefined): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "GET",
          path: "/api/info",
          // `setHost: false` stops Node auto-deriving a Host header, so
          // ours is the only one sent (and the undefined case sends none).
          setHost: false,
          headers: hostHeader === undefined ? {} : { Host: hostHeader },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { body += c; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("refuses a GET carrying a foreign Host header with 403", async () => {
    const { status, body } = await getWithHost("evil.example.com");
    expect(status).toBe(403);
    // And it did not leak tracker data in the refusal body.
    expect(body).not.toContain("\"exists\"");
  });

  it("refuses a foreign Host even with a port suffix", async () => {
    const { status } = await getWithHost(`evil.example.com:${port}`);
    expect(status).toBe(403);
  });

  it("refuses a request with no Host header", async () => {
    // Node's HTTP/1.1 parser already rejects a missing Host with its own
    // 400 before our handler runs, so the request never reaches routing
    // either way. We assert only that it is refused (never a 200 that
    // would read tracker data), not the exact code — the guard's own
    // 403 also covers this if Node's behaviour ever changes.
    const { status } = await getWithHost(undefined);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it("allows Host: 127.0.0.1:<port>", async () => {
    const { status } = await getWithHost(`127.0.0.1:${port}`);
    expect(status).toBe(200);
  });

  it("allows Host: localhost:<port>", async () => {
    const { status } = await getWithHost(`localhost:${port}`);
    expect(status).toBe(200);
  });

  it("allows Host: [::1]:<port> (IPv6 loopback)", async () => {
    const { status } = await getWithHost(`[::1]:${port}`);
    expect(status).toBe(200);
  });

  it("allows a bare loopback host with no port", async () => {
    const { status } = await getWithHost("127.0.0.1");
    expect(status).toBe(200);
  });
});
