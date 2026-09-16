import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * @verifies SET-29
 *
 * `GET /api/doctor` streams each diagnostic check as it completes rather
 * than returning the whole set in one JSON blob. The transport is
 * newline-delimited JSON (NDJSON): one `DiagnosticCheck` object per
 * line, over a chunked response. These tests pin both halves of that —
 * the streaming content-type, and that the checks arrive as separate
 * lines the client can render one at a time.
 */
describe("GET /api/doctor streams checks as NDJSON", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-doctor-stream-"));
    await initLoctt(root);
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

  it("responds with the NDJSON streaming content-type, not application/json", async () => {
    const res = await fetch(`${base}/api/doctor`);
    expect(res.status).toBe(200);
    // The streaming content-type is the contract the panel keys off. A
    // batched `application/json` array — the previous behaviour — must
    // not satisfy this.
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    await res.text();
  });

  it("emits each check as its own line, not one array blob", async () => {
    const res = await fetch(`${base}/api/doctor`);
    const body = await res.text();

    // NDJSON: every non-empty line is a standalone JSON object. A single
    // JSON array (`[{...},{...}]`) would parse as one line and fail the
    // per-line parse below — which is exactly the batched shape SET-29
    // replaces.
    const lines = body.split("\n").filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(5);

    const checks = lines.map(l => JSON.parse(l) as { name: string; status: string; message: string });
    for (const check of checks) {
      expect(typeof check.name).toBe("string");
      expect(["ok", "warn", "error"]).toContain(check.status);
      expect(typeof check.message).toBe("string");
    }

    // The first check is the `.loctt` directory existence check — the
    // one that can be answered before any of the heavier scans, and the
    // one a streaming producer hands over first.
    expect(checks[0]?.name).toBe(".loctt directory");
    // A whole-body parse as a single JSON value must fail: proof the
    // response is a stream of objects, not one array.
    expect(() => { JSON.parse(body); }).toThrow();
  });

  it("delivers the first check as a chunk before the response completes", async () => {
    const res = await fetch(`${base}/api/doctor`);
    expect(res.body).not.toBeNull();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read only the first chunk(s) until at least one full line is
    // available, then confirm the stream is NOT yet done. A batched
    // response writes the whole payload and closes in one shot, so its
    // first read would already be the final chunk (`done === true` on
    // the read that carries the body, or the very next read). A stream
    // hands over an early line while more checks are still to come.
    let buffered = "";
    let sawFirstLineBeforeEnd = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffered += decoder.decode(value, { stream: true });
      const firstNewline = buffered.indexOf("\n");
      if (firstNewline !== -1) {
        const first = JSON.parse(buffered.slice(0, firstNewline)) as { name: string };
        expect(first.name).toBe(".loctt directory");
        // The stream is still open (more checks coming) when the first
        // line is already parseable — the incremental guarantee.
        sawFirstLineBeforeEnd = !done;
        break;
      }
      if (done) break;
    }
    expect(sawFirstLineBeforeEnd).toBe(true);
    await reader.cancel();
  });
});
