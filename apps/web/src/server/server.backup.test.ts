import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { exportBackup, initLoctt } from "@loctt/core";
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

/**
 * A multipart body carrying SEVERAL file parts under one field name —
 * the shape a split-backup restore uploads.
 */
function buildMultipartMany(
  fieldName: string,
  files: readonly { filename: string; content: Buffer }[],
): { body: ArrayBuffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${BOUNDARY}\r\n`
        + `Content-Disposition: form-data; name="${fieldName}"; filename="${f.filename}"\r\n`
        + `Content-Type: application/octet-stream\r\n\r\n`,
      "utf-8",
    ));
    chunks.push(f.content);
    chunks.push(Buffer.from("\r\n", "utf-8"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf-8"));
  const buf = Buffer.concat(chunks);
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

async function restoreMany(
  base: string,
  files: readonly { filename: string; content: Buffer }[],
  query: string,
): Promise<Response> {
  const { body, contentType } = buildMultipartMany("file", files);
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

/**
 * Split-backup restore over the web (Ken, 2026-09-23).
 *
 * The panel used to tell the user to go and run `loctt restore`. Ken:
 * "why are we revealing the CLI command here? cant the user just load
 * from backup file and have it work?" — and chose supporting it over
 * documenting it.
 *
 * Core needed nothing: `restoreBackup` has always taken an array and
 * `resolveBackupSet` already orders a split set and refuses a bad one.
 * What did not exist was a web path that could carry more than one file,
 * so these assert the surface, not core's logic:
 *
 *  - N `file` parts reach core and restore as one set;
 *  - each of core's refusals — missing part, foreign part, duplicate,
 *    not-a-backup — arrives at the client NAMING what is wrong, rather
 *    than as a generic failure (the UI-9 shape: core knows the reason
 *    and the surface throws it away);
 *  - the uploaded parts are deleted whether the restore succeeds or
 *    fails.
 *
 * @verifies K30 · F3 · BAK-C8
 */
describe("web restore of a SPLIT backup (Ken 2026-09-23)", () => {
  let src: RunningApp;

  beforeAll(async () => {
    src = await startApp("loctt-web-split-src-");
    // Enough tasks with big bodies that an 8 KB split threshold yields
    // several parts.
    for (let i = 0; i < 6; i += 1) {
      await createTask(src.base, `Split task ${String(i)} ${"x".repeat(2000)}`);
    }
  });

  afterAll(async () => {
    await src.app.stop();
    await rm(src.root, { recursive: true, force: true });
  });

  /** Exports `app`'s tracker as a split set and returns the part bytes. */
  async function splitParts(
    app: RunningApp,
  ): Promise<{ filename: string; content: Buffer }[]> {
    const outDir = await mkdtemp(join(tmpdir(), "loctt-split-out-"));
    const report = await exportBackup(join(app.root, ".loctt"), {
      outputPath: join(outDir, "backup.jsonl"),
      splitThresholdBytes: 8 * 1024,
    });
    const parts = await Promise.all(report.files.map(async f => ({
      filename: basename(f),
      content: await readFile(f),
    })));
    await rm(outDir, { recursive: true, force: true });
    return parts;
  }

  /** Temp dirs this endpoint creates, so a leak is visible. */
  async function restoreTempDirs(): Promise<string[]> {
    const entries = await readdir(tmpdir());
    return entries.filter(e => e.startsWith("loctt-restore-"));
  }

  it("restores a two-part backup end to end from N uploaded file parts", async () => {
    const parts = await splitParts(src);
    // The fixture is only meaningful if the export really split.
    expect(parts.length).toBeGreaterThan(1);
    const dst = await startApp("loctt-web-split-ok-");
    try {
      const res = await restoreMany(dst.base, parts, "");
      expect(res.status).toBe(200);
      const report = await res.json() as { created: number; mode: string };
      expect(report.mode).toBe("bare");
      expect(report.created).toBe(6);
      // Every task really landed — not just the ones in part 1.
      const ids = await readdir(join(dst.root, ".loctt", "tasks"));
      expect(ids.length).toBe(6);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("refuses a set with a part missing, and the message NAMES the missing part", async () => {
    const parts = await splitParts(src);
    expect(parts.length).toBeGreaterThan(1);
    // Drop part 1, keep the rest: the classic "1 and 3 of 3" case.
    const incomplete = parts.slice(1);
    const dst = await startApp("loctt-web-split-missing-");
    try {
      const res = await restoreMany(dst.base, incomplete, "");
      expect(res.status).toBe(400);
      const body = await res.json() as { message: string; field?: string };
      expect(body.field).toBe("file");
      // The whole point: core knows WHICH part is missing, and the user
      // is told. A generic "restore failed" would pass a status check
      // and fail the user.
      expect(body.message).toMatch(/part 1 .*is missing|parts .*1.* are missing/);
      expect(body.message).toMatch(/Nothing has been restored/);
      // And nothing landed.
      expect(await readdir(join(dst.root, ".loctt", "tasks"))).toEqual([]);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("refuses a part from a DIFFERENT backup, naming the offending file (BAK-C8)", async () => {
    const parts = await splitParts(src);
    expect(parts.length).toBeGreaterThan(1);
    // A second export of the same tracker: same content, different
    // backup_id. Without BAK-C8 the part count would still add up.
    const otherParts = await splitParts(src);
    const mixed = [parts[0] as { filename: string; content: Buffer }, {
      filename: "foreign.jsonl",
      content: (otherParts[1] as { content: Buffer }).content,
    }];
    const dst = await startApp("loctt-web-split-foreign-");
    try {
      const res = await restoreMany(dst.base, mixed, "");
      expect(res.status).toBe(400);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/belongs to a different backup/);
      // It names the file that does not belong, not just "a file".
      expect(body.message).toMatch(/foreign\.jsonl/);
      expect(await readdir(join(dst.root, ".loctt", "tasks"))).toEqual([]);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("refuses the same part uploaded twice, naming the duplicated file", async () => {
    const parts = await splitParts(src);
    const first = parts[0] as { filename: string; content: Buffer };
    const dst = await startApp("loctt-web-split-dupe-");
    try {
      const res = await restoreMany(dst.base, [first, first], "");
      expect(res.status).toBe(400);
      const body = await res.json() as { message: string; field?: string };
      expect(body.field).toBe("file");
      // Two parts with one name would resolve to one temp path and the
      // second would silently clobber the first — the restore would then
      // believe it had N files while holding N-1.
      expect(body.message).toMatch(/both named/);
      expect(body.message).toMatch(new RegExp(first.filename.replace(".", "\\.")));
      expect(await readdir(join(dst.root, ".loctt", "tasks"))).toEqual([]);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("refuses a set containing one file that is not a backup at all, naming it", async () => {
    const parts = await splitParts(src);
    const withJunk = [
      parts[0] as { filename: string; content: Buffer },
      { filename: "notes.txt", content: Buffer.from("just some notes\n", "utf-8") },
    ];
    const dst = await startApp("loctt-web-split-junk-");
    try {
      const res = await restoreMany(dst.base, withJunk, "");
      expect(res.status).toBe(400);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/is not a LocTT backup/);
      expect(body.message).toMatch(/notes\.txt/);
      expect(await readdir(join(dst.root, ".loctt", "tasks"))).toEqual([]);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });

  it("deletes the uploaded temp parts on BOTH a successful and a failed restore", async () => {
    const parts = await splitParts(src);
    const before = await restoreTempDirs();

    // Success path.
    const ok = await startApp("loctt-web-split-tmp-ok-");
    try {
      expect((await restoreMany(ok.base, parts, "")).status).toBe(200);
    } finally {
      await ok.app.stop();
      await rm(ok.root, { recursive: true, force: true });
    }
    expect(await restoreTempDirs()).toEqual(before);

    // Failure path: an incomplete set, refused by core AFTER the parts
    // were written to disk. This is the leak that would matter — a
    // whole tracker's worth of uploads left in /tmp on every failure.
    const bad = await startApp("loctt-web-split-tmp-bad-");
    try {
      expect((await restoreMany(bad.base, parts.slice(1), "")).status).toBe(400);
    } finally {
      await bad.app.stop();
      await rm(bad.root, { recursive: true, force: true });
    }
    expect(await restoreTempDirs()).toEqual(before);
  });

  it("still restores a single-file backup unchanged (the common case)", async () => {
    const res0 = await fetch(`${src.base}/api/backup/export`);
    const single = Buffer.from(await res0.arrayBuffer());
    const dst = await startApp("loctt-web-split-single-");
    try {
      const res = await restore(dst.base, single, "");
      expect(res.status).toBe(200);
      const report = await res.json() as { created: number };
      expect(report.created).toBe(6);
    } finally {
      await dst.app.stop();
      await rm(dst.root, { recursive: true, force: true });
    }
  });
});
