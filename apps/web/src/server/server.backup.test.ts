import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * Web backup/restore surface (F3 / K30).
 *
 * Backup is the canonical safety net (K4: "JSONL is the backup"). It
 * was reachable on the CLI and MCP but had no web surface, so a
 * web-only user could neither take nor restore the real backup. These
 * assert the two new endpoints:
 *
 *  - `GET /api/backup/export` returns the JSONL backup bytes with an
 *    attachment disposition (parity with `loctt backup`).
 *  - `POST /api/backup/restore` round-trips a backup, refuses a
 *    destructive overwrite without an explicit confirm, and attributes
 *    a `RestoreRefusedError` as a 409 rather than a 500.
 *
 * @verifies K30 · F3
 */

const BOUNDARY = "----locttbackuptest";

function buildMultipart(
  fieldName: string,
  filename: string,
  content: Buffer | string,
): { body: ArrayBuffer; contentType: string } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n`
      + `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`
      + `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, "utf-8");
  const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const buf = Buffer.concat([head, data, tail]);
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return { body: ab, contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

interface RunningApp {
  app: ReturnType<typeof createWebApp>;
  root: string;
  base: string;
}

async function startApp(prefix: string): Promise<RunningApp> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await initLoctt(root);
  const app = createWebApp({ root, port: 0 });
  await app.start();
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : app.port;
  return { app, root, base: `http://127.0.0.1:${port}` };
}

async function createTask(base: string, title: string): Promise<string> {
  const res = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Loctt-Client": "1" },
    body: JSON.stringify({ title }),
  });
  const body = await res.json() as { key: string };
  return body.key;
}

async function restore(
  base: string,
  backup: Buffer,
  query: string,
): Promise<Response> {
  const { body, contentType } = buildMultipart("file", "backup.jsonl", backup);
  return fetch(`${base}/api/backup/restore${query}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Loctt-Client": "web" },
    body,
  });
}

describe("web backup/restore surface (F3/K30)", () => {
  let src: RunningApp;

  beforeAll(async () => {
    src = await startApp("loctt-web-backup-src-");
    await createTask(src.base, "First task");
    await createTask(src.base, "Second task");
  });

  afterAll(async () => {
    await src.app.stop();
    await rm(src.root, { recursive: true, force: true });
  });

  async function exportBytes(): Promise<Buffer> {
    const res = await fetch(`${src.base}/api/backup/export`);
    expect(res.status).toBe(200);
    return Buffer.from(await res.arrayBuffer());
  }

  it("export returns the JSONL backup bytes with an attachment filename", async () => {
    const res = await fetch(`${src.base}/api/backup/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename=/);
    expect(res.headers.get("content-disposition")).toMatch(/\.jsonl/);
    const text = await res.text();
    // The first line is the backup header; the tasks follow.
    const first = JSON.parse(text.split("\n")[0] ?? "{}") as { kind?: string };
    expect(first.kind).toBe("loctt-backup");
    // Both tasks are in the file.
    expect(text.match(/"kind":"task"/g)?.length).toBe(2);
  });

  it("restore round-trips a backup into an empty tracker (bare)", async () => {
    const backup = await exportBytes();
    const dst = await startApp("loctt-web-backup-dst-");
    try {
      const res = await restore(dst.base, backup, "");
      expect(res.status).toBe(200);
      const report = await res.json() as { created: number; mode: string };
      expect(report.mode).toBe("bare");
      expect(report.created).toBe(2);
      // The tasks are really on disk in the destination.
      const ids = await readdir(join(dst.root, ".loctt", "tasks"));
      expect(ids.length).toBe(2);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("refuses a destructive overwrite without confirm (409, not silent)", async () => {
    const backup = await exportBytes();
    // A destination that already holds a task, so overwrite is destructive.
    const dst = await startApp("loctt-web-backup-ow-");
    try {
      await createTask(dst.base, "Existing local task");
      const res = await restore(dst.base, backup, "?mode=overwrite");
      expect(res.status).toBe(409);
      const body = await res.json() as { code: string; message: string };
      expect(body.code).toBe("conflict");
      expect(body.message).toMatch(/confirm/i);
      // With confirm=true it proceeds.
      const ok = await restore(dst.base, backup, "?mode=overwrite&confirm=true");
      expect(ok.status).toBe(200);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("attributes a bare restore into a non-empty tracker as 409, not 500", async () => {
    const backup = await exportBytes();
    const dst = await startApp("loctt-web-backup-refuse-");
    try {
      await createTask(dst.base, "Existing local task");
      const res = await restore(dst.base, backup, ""); // bare, default
      expect(res.status).toBe(409);
      const body = await res.json() as { code: string };
      expect(body.code).toBe("conflict");
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("attributes a malformed backup as 400 (file), not 500", async () => {
    const dst = await startApp("loctt-web-backup-bad-");
    try {
      const res = await restore(dst.base, Buffer.from("not a backup\n"), "");
      // A header that will not parse is a BackupFormatError -> 400.
      expect(res.status).toBe(400);
      const body = await res.json() as { field?: string };
      expect(body.field).toBe("file");
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("requires the X-Loctt-Client header on restore (CSRF guard)", async () => {
    const backup = await exportBytes();
    const { body, contentType } = buildMultipart("file", "backup.jsonl", backup);
    const res = await fetch(`${src.base}/api/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": contentType }, // no X-Loctt-Client
      body,
    });
    expect(res.status).toBe(403);
  });

  it("refuses a path-traversal backup with 409 (SEC-1/SEC-2), not 500", async () => {
    // A crafted backup whose config record escapes the tracker dir. The
    // header must parse (so restore starts), then the traversing config
    // path trips assertContainedPath -> RestoreRefusedError.
    const header = JSON.stringify({
      kind: "loctt-backup", format: 1, schema_version: 1,
      created_at: new Date().toISOString(), backup_id: "01",
      includes_history: true, excluded: [], part: 1, parts: 1,
    });
    const evil = JSON.stringify({
      kind: "config", path: "../../escape.yaml", content: "x: 1",
    });
    const crafted = Buffer.from(`${header}\n${evil}\n`, "utf-8");
    const dst = await startApp("loctt-web-backup-evil-");
    try {
      const res = await restore(dst.base, crafted, "");
      expect(res.status).toBe(409);
      const body = await res.json() as { code: string; message: string };
      expect(body.code).toBe("conflict");
      expect(body.message).toMatch(/escape/i);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("dry_run predicts without writing and needs no confirm for overwrite", async () => {
    const backup = await exportBytes();
    const dst = await startApp("loctt-web-backup-dry-");
    try {
      await createTask(dst.base, "Existing local task");
      const before = await readdir(join(dst.root, ".loctt", "tasks"));
      const res = await restore(dst.base, backup, "?mode=overwrite&dry_run=true");
      expect(res.status).toBe(200);
      const report = await res.json() as { dryRun: boolean };
      expect(report.dryRun).toBe(true);
      const after = await readdir(join(dst.root, ".loctt", "tasks"));
      expect(after.length).toBe(before.length);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });
});
