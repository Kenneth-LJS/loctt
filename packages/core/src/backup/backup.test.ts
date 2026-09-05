/**
 * The JSONL backup, against a real tracker on disk.
 *
 * Every assertion here reads the far end — `task.md`, `_comments.yaml`,
 * `attachments/` as they exist after a restore — rather than a return
 * value, because a report that says "12 restored" while the disk holds
 * eleven is exactly the failure these cases are for.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { createLabel } from "../labels/manage.js";
import {
  getAttachmentsDir,
  getCommentsFilePath,
  getHistoryFilePath,
  getTaskFilePath,
  resolveLocttDir,
} from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { postComment } from "../task/comments.js";
import { createTask } from "../task/create.js";
import { DEFAULT_EXPORT_COLUMNS } from "../task/export.js";
import { lookupTask } from "../task/lookup.js";
import { exportBackup } from "./export.js";
import { EXCLUDED_FROM_BACKUP } from "./format.js";
import { readBackupHeader, resolveBackupSet } from "./read.js";
import { restoreBackup } from "./restore.js";

let src: string;
let srcDir: string;
let dst: string;
let dstDir: string;
let out: string;

beforeEach(async () => {
  src = await mkdtemp(join(tmpdir(), "loctt-bak-src-"));
  dst = await mkdtemp(join(tmpdir(), "loctt-bak-dst-"));
  await initLoctt(src, { docs: false });
  srcDir = resolveLocttDir(src);
  dstDir = resolveLocttDir(dst);
  out = join(src, "backup.jsonl");
});

afterEach(async () => {
  await rm(src, { recursive: true, force: true });
  await rm(dst, { recursive: true, force: true });
});

async function seed(
  locttDir: string,
  title: string,
  extra: Record<string, unknown> = {},
  project?: string,
): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const cfg = await loadProjectsConfig(locttDir);
    const t = await createTask({
      locttDir, state,
      options: { project: project ?? cfg.projects[0]?.id as string, title, ...extra },
    });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

/** Rewrites one field straight into task.md, bypassing validation. */
async function patchFrontmatter(
  locttDir: string, id: string, edit: (fm: Record<string, unknown>) => void,
): Promise<void> {
  const p = getTaskFilePath(locttDir, id);
  const content = await readFile(p, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  const fm = parseYaml(m?.[1] ?? "") as Record<string, unknown>;
  edit(fm);
  await writeFile(p, `---\n${stringifyYaml(fm)}---\n${m?.[2] ?? ""}`, "utf-8");
}

/** Replaces a task's markdown body, leaving frontmatter intact. */
async function setBody(locttDir: string, id: string, body: string): Promise<void> {
  const p = getTaskFilePath(locttDir, id);
  const content = await readFile(p, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  await writeFile(p, `${m?.[0] ?? ""}${body}`, "utf-8");
}

/** An empty destination that is nonetheless an initialised tracker. */
async function initDest(): Promise<void> {
  await initLoctt(dst, { docs: false });
  await rm(join(dstDir, "tasks"), { recursive: true, force: true });
  await mkdir(join(dstDir, "tasks"), { recursive: true });
}

describe("export/restore round trip", () => {
  // @verifies BAK-C1
  // @verifies BAK-C2
  it("carries every field the CSV drops, with its value, across a round trip", async () => {
    const a = await seed(srcDir, "Alpha");
    const b = await seed(srcDir, "Beta");
    const c = await seed(srcDir, "Gamma");

    // Two related tasks, so the inverse (P-12) can be checked, plus an
    // archived one and one with an attachment — the multi-task
    // properties an all-fields single task would never exercise.
    await patchFrontmatter(srcDir, a, fm => {
      fm["relationships"] = [{ type: "blocks", target: b }];
      fm["fields"] = { severity: "high" };
      fm["key_history"] = ["OLD-9"];
      fm["rank"] = "0|hzzzzz:";
      fm["board_rank"] = "0|i00000:";
    });
    await patchFrontmatter(srcDir, b, fm => {
      fm["relationships"] = [{ type: "blocked_by", target: a }];
    });
    await patchFrontmatter(srcDir, c, fm => {
      fm["archived"] = true;
      fm["archived_at"] = "2026-03-01T00:00:00.000Z";
    });
    await setBody(srcDir, a, "# Alpha\n\nA body the CSV would have dropped.\n");
    await mkdir(getAttachmentsDir(srcDir, a), { recursive: true });
    await writeFile(join(getAttachmentsDir(srcDir, a), "note.txt"), "attached");

    await exportBackup(srcDir, { outputPath: out });
    await initDest();
    await restoreBackup(dstDir, [out], { mode: "bare" });

    // Read the far end: task.md on disk, not a return value.
    const restoredA = await lookupTask(dstDir, a);
    expect(restoredA.body).toContain("A body the CSV would have dropped.");
    expect(restoredA.frontmatter.relationships).toEqual([{ type: "blocks", target: b }]);
    expect(restoredA.frontmatter.fields).toEqual({ severity: "high" });
    expect(restoredA.frontmatter.key_history).toEqual(["OLD-9"]);
    // `rank` is not a schema-known key, so the corruption framework lifts
    // it into `health` (kind unrecognised) rather than onto `frontmatter`
    // — but its VALUE still survives the round trip byte-for-byte, which
    // is what this test checks. (Previously this asserted
    // `frontmatter.rank`; the value moved home, not the guarantee. A135.)
    const rankEntry = (restoredA.health ?? []).find(h => h.field === "rank");
    expect(rankEntry?.raw).toBe("0|hzzzzz:");
    expect(restoredA.frontmatter.board_rank).toBe("0|i00000:");

    const restoredC = await lookupTask(dstDir, c);
    expect(restoredC.frontmatter.archived).toBe(true);
    expect(restoredC.frontmatter.archived_at).toBe("2026-03-01T00:00:00.000Z");

    // Multi-task properties: the inverse exists on the target (P-12),
    // and no two restored tasks share a key.
    const restoredB = await lookupTask(dstDir, b);
    expect(restoredB.frontmatter.relationships)
      .toEqual([{ type: "blocked_by", target: a }]);
    const ids = await readdir(join(dstDir, "tasks"));
    const keys = await Promise.all(
      ids.map(async i => (await lookupTask(dstDir, i)).frontmatter.key),
    );
    expect(new Set(keys).size).toBe(keys.length);

    // The attachment is on disk, in the task's own directory.
    expect(await readFile(join(getAttachmentsDir(dstDir, a), "note.txt"), "utf-8"))
      .toBe("attached");
  });

  // @verifies BAK-C2
  it("leaves the CSV report at its 18 columns", () => {
    // K4 ruling 1: the backup must not turn the report into a backup.
    expect(DEFAULT_EXPORT_COLUMNS).toHaveLength(18);
    expect(DEFAULT_EXPORT_COLUMNS).not.toContain("body");
    expect(DEFAULT_EXPORT_COLUMNS).not.toContain("relationships");
    expect(DEFAULT_EXPORT_COLUMNS).not.toContain("fields");
    expect(DEFAULT_EXPORT_COLUMNS).not.toContain("key_history");
  });

  // @verifies BAK-C1
  it("names every excluded file in the export's own report", async () => {
    await seed(srcDir, "A");
    const report = await exportBackup(srcDir, { outputPath: out });
    // The whole list, so a new exclusion cannot be added silently.
    expect([...report.excluded].sort()).toEqual([
      ".loctt/.schema-migration-in-progress",
      ".loctt/local/journal.yaml",
      ".loctt/local/key-index.yaml",
      ".loctt/local/prefix-rename.yaml",
      ".loctt/local/reconcile.yaml",
      ".loctt/local/sync.yaml",
      ".loctt/users/<id>/recents.yaml",
      ".loctt/users/<id>/settings.yaml",
    ]);
    const header = await readBackupHeader(out);
    expect([...header.excluded].sort()).toEqual([...EXCLUDED_FROM_BACKUP].sort());
  });

  // @verifies BAK-C16
  it("carries every config file, including one it was never told about", async () => {
    // BAK-C16 requires queries.yaml and list-view.yaml to be restored
    // or named as excluded — "silence is not a decision". A hardcoded
    // file list satisfies that on the day it is written and silently
    // drops whatever is added next, so the export reads the directory.
    await seed(srcDir, "A");
    await writeFile(
      join(srcDir, "config", "queries.yaml"), "queries: []\n", "utf-8",
    );
    await writeFile(
      join(srcDir, "config", "list-view.yaml"), "columns: [key]\n", "utf-8",
    );
    // Stands in for a config file added after this code was written.
    await writeFile(
      join(srcDir, "config", "future-thing.yaml"), "invented: later\n", "utf-8",
    );

    await exportBackup(srcDir, { outputPath: out });
    await initDest();
    await restoreBackup(dstDir, [out], { mode: "bare" });

    expect(await readFile(join(dstDir, "config", "queries.yaml"), "utf-8"))
      .toContain("queries:");
    expect(await readFile(join(dstDir, "config", "list-view.yaml"), "utf-8"))
      .toContain("columns:");
    expect(await readFile(join(dstDir, "config", "future-thing.yaml"), "utf-8"))
      .toContain("invented: later");
  });

  // @verifies BAK-C16
  it("restores config values and never a user's settings or recents", async () => {
    const label = await createLabel(srcDir, { name: "bug" });
    await seed(srcDir, "A");
    // Both are machine-local (Q22). The obvious implementation copies
    // the user directory and ships them.
    const users = await readdir(join(srcDir, "users"));
    const userId = users[0] as string;
    await writeFile(join(srcDir, "users", userId, "settings.yaml"), "theme: dark\n");
    await writeFile(join(srcDir, "users", userId, "recents.yaml"), "recents: [T-1]\n");

    await exportBackup(srcDir, { outputPath: out });
    await initDest();
    await restoreBackup(dstDir, [out], { mode: "bare" });

    // Values, not nameless stubs.
    const labels = parseYaml(
      await readFile(join(dstDir, "config", "labels.yaml"), "utf-8"),
    ) as { labels: { id: string; name: string }[] };
    expect(labels.labels.find(l => l.id === label.id)?.name).toBe("bug");

    const profile = await readFile(
      join(dstDir, "users", userId, "profile.yaml"), "utf-8",
    );
    expect(profile.length).toBeGreaterThan(0);

    // Asserted by absence of the file, not by prose.
    expect(await stat(join(dstDir, "users", userId, "settings.yaml"))
      .then(() => true, () => false)).toBe(false);
    expect(await stat(join(dstDir, "users", userId, "recents.yaml"))
      .then(() => true, () => false)).toBe(false);
  });
});

describe("attachments", () => {
  // @verifies BAK-C5
  it("carries binary bytes unchanged and keeps same-named files apart", async () => {
    const a = await seed(srcDir, "A");
    const b = await seed(srcDir, "B");
    const c = await seed(srcDir, "C");
    // Non-UTF8 bytes: a decode/re-encode round trip mangles these.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
    await mkdir(getAttachmentsDir(srcDir, a), { recursive: true });
    await writeFile(join(getAttachmentsDir(srcDir, a), "same.png"), png);
    await mkdir(getAttachmentsDir(srcDir, b), { recursive: true });
    await writeFile(join(getAttachmentsDir(srcDir, b), "same.png"), Buffer.from("different"));

    await exportBackup(srcDir, { outputPath: out });
    await initDest();
    await restoreBackup(dstDir, [out], { mode: "bare" });

    // Compared as bytes, never as a decoded string.
    expect(await readFile(join(getAttachmentsDir(dstDir, a), "same.png")))
      .toEqual(png);
    expect(await readFile(join(getAttachmentsDir(dstDir, b), "same.png")))
      .toEqual(Buffer.from("different"));
    // A task with no attachments carries no empty structure.
    expect(await stat(getAttachmentsDir(dstDir, c)).then(() => true, () => false))
      .toBe(false);
  });

  // @verifies BAK-C6
  it("reports the output size in bytes", async () => {
    const a = await seed(srcDir, "A");
    await mkdir(getAttachmentsDir(srcDir, a), { recursive: true });
    await writeFile(join(getAttachmentsDir(srcDir, a), "big.bin"), Buffer.alloc(64 * 1024, 7));
    const report = await exportBackup(srcDir, { outputPath: out });
    const onDisk = (await stat(out)).size;
    expect(report.bytes).toBe(onDisk);
    // Large enough that the attachment is visibly accounted for.
    expect(report.bytes).toBeGreaterThan(64 * 1024);
  });
});

describe("history", () => {
  // @verifies BAK-C4
  it("includes history by default and omits it on request", async () => {
    const a = await seed(srcDir, "A");
    await postComment({ locttDir: srcDir, taskId: a, body: "hello" });
    const srcHistory = parseYaml(
      await readFile(getHistoryFilePath(srcDir, a), "utf-8"),
    ) as unknown[];
    expect(srcHistory.length).toBeGreaterThan(0);

    await exportBackup(srcDir, { outputPath: out });
    await initDest();
    await restoreBackup(dstDir, [out], { mode: "bare" });
    const restored = parseYaml(
      await readFile(getHistoryFilePath(dstDir, a), "utf-8"),
    ) as Record<string, unknown>[];
    // Same count, same first and same last entry.
    expect(restored).toHaveLength(srcHistory.length);
    expect(restored[0]).toEqual(srcHistory[0]);
    expect(restored.at(-1)).toEqual(srcHistory.at(-1));

    // Opting out drops the file and says so — and touches neither
    // comments nor attachments.
    const out2 = join(src, "nohist.jsonl");
    const report = await exportBackup(srcDir, { outputPath: out2, includeHistory: false });
    expect(report.includedHistory).toBe(false);
    const dst2 = await mkdtemp(join(tmpdir(), "loctt-bak-nh-"));
    await initLoctt(dst2, { docs: false });
    const dst2Dir = resolveLocttDir(dst2);
    await rm(join(dst2Dir, "tasks"), { recursive: true, force: true });
    await mkdir(join(dst2Dir, "tasks"), { recursive: true });
    await restoreBackup(dst2Dir, [out2], { mode: "bare" });
    expect(await stat(getHistoryFilePath(dst2Dir, a)).then(() => true, () => false))
      .toBe(false);
    const comments = (parseYaml(
      await readFile(getCommentsFilePath(dst2Dir, a), "utf-8"),
    ) as { comments: unknown[] }).comments;
    expect(comments).toHaveLength(1);
    await rm(dst2, { recursive: true, force: true });
  });
});

describe("malformed input", () => {
  // @verifies BAK-C3
  it("names a bad line, skips it, and restores everything else", async () => {
    const a = await seed(srcDir, "A");
    const b = await seed(srcDir, "B");
    const c = await seed(srcDir, "C");
    await exportBackup(srcDir, { outputPath: out });

    // Corrupt exactly one task line by hand.
    const lines = (await readFile(out, "utf-8")).split("\n").filter(l => l.length > 0);
    const idx = lines.findIndex(l => l.includes(`"id":"${b}"`));
    expect(idx).toBeGreaterThan(0);
    lines[idx] = "{ this is not json";
    await writeFile(out, `${lines.join("\n")}\n`, "utf-8");

    await initDest();
    const report = await restoreBackup(dstDir, [out], { mode: "bare" });

    expect(report.badLines).toHaveLength(1);
    // Named with its line number, 1-based as an editor shows it.
    expect(report.badLines[0]?.line).toBe(idx + 1);

    // Every other task restored, and the count matches the disk.
    const onDisk = await readdir(join(dstDir, "tasks"));
    expect(onDisk.sort()).toEqual([a, c].sort());
    expect(report.created).toBe(onDisk.length);
  });

  // @verifies BAK-C3
  it("never writes over a _comments.yaml it could not read (P-11)", async () => {
    const a = await seed(srcDir, "A");
    await postComment({ locttDir: srcDir, taskId: a, body: "one" });
    await postComment({ locttDir: srcDir, taskId: a, body: "two" });
    await postComment({ locttDir: srcDir, taskId: a, body: "three" });
    await exportBackup(srcDir, { outputPath: out });

    // The destination holds the same task with an unreadable thread.
    await initDest();
    await mkdir(join(dstDir, "tasks", a), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, a),
      await readFile(getTaskFilePath(srcDir, a), "utf-8"),
    );
    const unreadable = "{{{ not yaml at all\n\t- : :\n";
    await writeFile(getCommentsFilePath(dstDir, a), unreadable, "utf-8");

    await restoreBackup(dstDir, [out], { mode: "overwrite" });

    // The 2026-08-17 bug: a failed read preceded a write and a
    // three-comment thread became one. The file must be untouched.
    expect(await readFile(getCommentsFilePath(dstDir, a), "utf-8")).toBe(unreadable);
  });
});

describe("splitting", () => {
  // @verifies BAK-C7
  it("splits into numbered parts and reconstructs every task", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await seed(srcDir, `T${String(i)}`));
    for (const id of ids) {
      await mkdir(getAttachmentsDir(srcDir, id), { recursive: true });
      await writeFile(join(getAttachmentsDir(srcDir, id), "pad.bin"), Buffer.alloc(4096, 1));
    }
    const report = await exportBackup(srcDir, {
      outputPath: out, splitThresholdBytes: 8 * 1024,
    });
    expect(report.files.length).toBeGreaterThan(1);
    expect(report.files[1]).toContain(".part2");

    await initDest();
    await restoreBackup(dstDir, report.files, { mode: "bare" });
    const onDisk = await readdir(join(dstDir, "tasks"));
    expect(onDisk.sort()).toEqual([...ids].sort());
  });

  // @verifies BAK-C8
  it("refuses a partial set, names the missing part, and writes nothing", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await seed(srcDir, `T${String(i)}`));
    for (const id of ids) {
      await mkdir(getAttachmentsDir(srcDir, id), { recursive: true });
      await writeFile(join(getAttachmentsDir(srcDir, id), "pad.bin"), Buffer.alloc(4096, 1));
    }
    const report = await exportBackup(srcDir, {
      outputPath: out, splitThresholdBytes: 8 * 1024,
    });
    expect(report.files.length).toBeGreaterThan(1);

    await initDest();
    // Hand it every part but the last.
    const partial = report.files.slice(0, -1);
    await expect(restoreBackup(dstDir, partial, { mode: "bare" }))
      .rejects.toThrow(/part \d+ is missing|parts .* are missing/);
    // Nothing written: a half restore reporting success is the failure
    // that costs most, because the user believes they have their data.
    expect(await readdir(join(dstDir, "tasks"))).toEqual([]);
  });

  // @verifies BAK-C8
  it("refuses a part from a different backup", async () => {
    await seed(srcDir, "A");
    const one = await exportBackup(srcDir, { outputPath: out });
    const other = join(src, "other.jsonl");
    await exportBackup(srcDir, { outputPath: other });
    await initDest();
    await expect(
      resolveBackupSet([one.files[0] as string, other]),
    ).rejects.toThrow(/belongs to a different backup/);
  });
});
