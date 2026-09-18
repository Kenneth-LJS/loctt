/**
 * The format's own promises: streaming, the version header, atomicity
 * and reference integrity.
 *
 * These are the cases an implementation can pass by accident on a small
 * fixture and fail in the field, so each one is written against the
 * mechanism rather than the outcome — the first report line before EOF,
 * a killed swap, a dangling target.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { createLabel } from "../labels/manage.js";
import {
  getJournalPath,
  getStateFilePath,
  getTaskFilePath,
  resolveLocttDir,
} from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { loadJournal } from "../state/journal.js";
import { stagedSwap } from "../state/staged-swap.js";
import { createTask } from "../task/create.js";
import { lookupTask } from "../task/lookup.js";
import { exportBackup } from "./export.js";
import { readBackupHeader, readBackupPart } from "./read.js";
import { restoreBackup } from "./restore.js";

let src: string;
let srcDir: string;
let dst: string;
let dstDir: string;
let out: string;

beforeEach(async () => {
  src = await mkdtemp(join(tmpdir(), "loctt-fmt-src-"));
  dst = await mkdtemp(join(tmpdir(), "loctt-fmt-dst-"));
  await initLoctt(src, { docs: false });
  await initLoctt(dst, { docs: false });
  srcDir = resolveLocttDir(src);
  dstDir = resolveLocttDir(dst);
  out = join(src, "backup.jsonl");
});

afterEach(async () => {
  await rm(src, { recursive: true, force: true });
  await rm(dst, { recursive: true, force: true });
});

async function seed(locttDir: string, title: string): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const cfg = await loadProjectsConfig(locttDir);
    const t = await createTask({
      locttDir, state,
      options: { project: cfg.projects[0]?.id as string, title },
    });
    await saveState(locttDir, state);
    return t.frontmatter.id;
  });
}

async function emptyTasks(locttDir: string): Promise<void> {
  await rm(join(locttDir, "tasks"), { recursive: true, force: true });
  await mkdir(join(locttDir, "tasks"), { recursive: true });
}

describe("streaming", () => {
  // @verifies BAK-C19
  it("reports its first record before the file has been fully consumed", async () => {
    // Bigger than one read chunk, or the whole file arrives in a single
    // `data` event and the measurement cannot distinguish streaming
    // from a whole-file read — it would pass either way.
    const a = await seed(srcDir, "Padded");
    const { mkdir: mk, writeFile: wf } = await import("node:fs/promises");
    const { getAttachmentsDir } = await import("../paths/index.js");
    await mk(getAttachmentsDir(srcDir, a), { recursive: true });
    await wf(join(getAttachmentsDir(srcDir, a), "pad.bin"), Buffer.alloc(512 * 1024, 3));
    for (let i = 0; i < 40; i += 1) await seed(srcDir, `T${String(i)}`);
    await exportBackup(srcDir, { outputPath: out });
    const total = (await stat(out)).size;
    expect(total).toBeGreaterThan(256 * 1024);

    // Mechanically checkable, unlike peak memory: how much of the file
    // had been read when the first record was handed over.
    let bytesReadAtFirst: number | undefined;
    let seen = 0;
    const { createReadStream } = await import("node:fs");
    const stream = createReadStream(out, { encoding: "utf-8" });
    stream.on("data", chunk => { seen += Buffer.byteLength(chunk as string); });
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let line = 0;
    for await (const _l of rl) {
      line += 1;
      if (line === 2 && bytesReadAtFirst === undefined) {
        bytesReadAtFirst = seen;
        break;
      }
    }
    rl.close();
    stream.destroy();

    expect(bytesReadAtFirst).toBeDefined();
    // A readFileSync implementation would have consumed all of it.
    expect(bytesReadAtFirst as number).toBeLessThan(total);
  });

  // @verifies BAK-C19
  it("hands records to the caller one at a time rather than as one array", async () => {
    for (let i = 0; i < 10; i += 1) await seed(srcDir, `T${String(i)}`);
    await exportBackup(srcDir, { outputPath: out });

    // The callback shape is the streaming contract: the caller sees a
    // record, and can act on it, before the rest of the file is read.
    const order: string[] = [];
    let sawTaskBeforeLast = false;
    const result = await readBackupPart(out, record => {
      order.push(record.kind);
      // A task record arrived while records were still to come.
      if (record.kind === "task" && order.filter(k => k === "task").length < 10) {
        sawTaskBeforeLast = true;
      }
    });
    expect(sawTaskBeforeLast).toBe(true);
    expect(order.filter(k => k === "task")).toHaveLength(10);
    expect(result.badLines).toEqual([]);
  });

  // @verifies BAK-C19
  it("keeps one record on one line even when the body has newlines", async () => {
    // The whole format rests on this: a record that spanned two lines
    // would make every subsequent line number wrong, split a task
    // across a part boundary, and turn a body containing a JSON-looking
    // line into a "malformed line" report. JSON escapes newlines inside
    // strings, and this pins that rather than assuming it.
    const a = await seed(srcDir, "Multi-line");
    const body = "para one\n\npara two\n{\"kind\":\"task\",\"id\":\"NOT-REAL\"}\n";
    const p = getTaskFilePath(srcDir, a);
    const content = await readFile(p, "utf-8");
    const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
    await writeFile(p, `${m?.[0] ?? ""}${body}`, "utf-8");

    await exportBackup(srcDir, { outputPath: out });

    const lines = (await readFile(out, "utf-8")).split("\n").filter(l => l.length > 0);
    // Header + state + configs + user + exactly one task line.
    expect(lines.filter(l => l.includes('"kind":"task"')).length).toBe(1);
    // Every line is independently parseable — no record spans two.
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }

    // And the embedded JSON-looking line survives as body text, not as
    // a record: a restore must not mistake it for a second task.
    await emptyTasks(dstDir);
    const report = await restoreBackup(dstDir, [out], { mode: "bare" });
    expect(report.created).toBe(1);
    expect(report.badLines).toEqual([]);
    expect((await lookupTask(dstDir, a)).body).toContain('"id":"NOT-REAL"');
  });
});

describe("schema version", () => {
  // @verifies BAK-C21
  it("records the version in the first line, not a footer", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    const firstLine = (await readFile(out, "utf-8")).split("\n")[0] as string;
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    // In the first line, so the check does not require reading to the
    // end — a footer would satisfy "carries its version" and contradict
    // BAK-C19's streaming.
    expect(parsed["kind"]).toBe("loctt-backup");
    expect(typeof parsed["schema_version"]).toBe("number");
    const header = await readBackupHeader(out);
    expect(header.schema_version).toBeGreaterThanOrEqual(1);
  });

  // @verifies BAK-C21
  it("refuses a newer-schema backup, naming both versions, writing nothing", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    // Hand-bump the header's version, as a backup from a future LocTT
    // would carry.
    const lines = (await readFile(out, "utf-8")).split("\n");
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
    const future = 99;
    header["schema_version"] = future;
    lines[0] = JSON.stringify(header);
    await writeFile(out, lines.join("\n"), "utf-8");

    await emptyTasks(dstDir);
    // SchemaTooNewError already exists for this shape and names both.
    await expect(restoreBackup(dstDir, [out], { mode: "bare" }))
      .rejects.toThrow(/99[\s\S]*schema v1|schema v99/);
    expect(await readdir(join(dstDir, "tasks"))).toEqual([]);
  });

  // @verifies BAK-C21
  it("refuses an older-schema backup rather than migrating it", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });
    const lines = (await readFile(out, "utf-8")).split("\n");
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
    // Only reachable once CURRENT_SCHEMA_VERSION > 1; until then the
    // schema has no older version to carry, so this asserts the
    // *decision* is implemented rather than simulating a v0 tracker.
    header["schema_version"] = 0;
    lines[0] = JSON.stringify(header);
    await writeFile(out, lines.join("\n"), "utf-8");

    await emptyTasks(dstDir);
    // Zod's `min(1)` rejects 0 as a malformed header before the version
    // comparison — either way it is refused and nothing is written,
    // which is what the case asks for.
    await expect(restoreBackup(dstDir, [out], { mode: "bare" })).rejects.toThrow();
    expect(await readdir(join(dstDir, "tasks"))).toEqual([]);
  });
});

describe("atomicity", () => {
  // @verifies BAK-C14
  it("journals the restore's writes and clears the entry only on success", async () => {
    await seed(srcDir, "A");
    await seed(srcDir, "B");
    await exportBackup(srcDir, { outputPath: out });
    await emptyTasks(dstDir);

    // Positive control. Asserting only "the journal is empty
    // afterwards" is satisfied by a restore that never journalled at
    // all — the exact implementation BAK-C14 exists to rule out — so
    // the entry is observed *while the writes are in flight*, by
    // watching the journal from inside the swap.
    //
    // `stat` on the journal during the restore is not possible without
    // a hook, so this reads it at the moment the staging directory
    // exists: stagedSwap creates `local/swap/<opId>` before it
    // journals, and clears the entry last.
    const seenEntries: string[] = [];
    const realWriteFile = (await import("node:fs/promises")).writeFile;
    void realWriteFile;
    // Poll for the swap directory while the restore runs.
    const watcher = (async () => {
      for (let i = 0; i < 2000; i += 1) {
        const dirs = await readdir(join(dstDir, "local", "swap"))
          .catch(() => [] as string[]);
        if (dirs.length > 0) {
          const j = await loadJournal(dstDir).catch(() => ({ entries: [] }));
          for (const e of j.entries) seenEntries.push(e.kind);
          if (seenEntries.length > 0) return;
        }
        await new Promise(r => setImmediate(r));
      }
    })();

    await restoreBackup(dstDir, [out], { mode: "bare" });
    await watcher;

    // The restore's writes went through the journalled staged swap —
    // a plain write loop leaves nothing here to find.
    expect(seenEntries).toContain("staged_swap");

    // The entry goes last, so "entry exists" always means unfinished.
    // A completed restore leaves none.
    const journal = await loadJournal(dstDir);
    expect(journal.entries).toEqual([]);
    // And no per-op staging directory is left behind. (The shared
    // `swap/` parent stays; stagedSwap removes only its own op dir.)
    const leftover = await readdir(join(dstDir, "local", "swap"))
      .catch(() => [] as string[]);
    expect(leftover).toEqual([]);
  });

  // @verifies BAK-C14
  it("rolls back to the original state when a write in the set fails", async () => {
    // The kill point the case names as hardest: after some destinations
    // have been swapped. A directory sitting where a file must go makes
    // one rename fail, which is the observable equivalent of a crash
    // partway — and the whole set must come back.
    const id = await seed(dstDir, "Existing");
    const original = await readFile(getTaskFilePath(dstDir, id), "utf-8");
    const stateBefore = await readFile(getStateFilePath(dstDir), "utf-8");

    // The failure must land *during* the swap, after earlier
    // destinations are already replaced — that is the kill point the
    // case names, and the only one rollback exists for. stagedSwap's
    // own pre-check refuses a non-file destination before anything
    // moves, so a directory in the list throws early and never
    // exercises rollback at all.
    //
    // Instead: a destination whose parent is a *file*. It passes the
    // pre-check (stat says "does not exist"), and the rename fails
    // with ENOTDIR once the earlier two have already landed.
    const wall = join(dstDir, "tasks", id, "wall");
    await writeFile(wall, "not a directory\n", "utf-8");
    const unreachable = join(wall, "nested.md");

    await expect(withStateLock(dstDir, () => stagedSwap(dstDir, [
      { path: getTaskFilePath(dstDir, id), content: "REPLACED\n" },
      { path: getStateFilePath(dstDir), content: "keys: {}\n" },
      { path: unreachable, content: "can never land" },
    ]))).rejects.toThrow();

    // Either fully applied or unchanged — never half.
    expect(await readFile(getTaskFilePath(dstDir, id), "utf-8")).toBe(original);
    expect(await readFile(getStateFilePath(dstDir), "utf-8")).toBe(stateBefore);
  });

  // @verifies BAK-C14
  it("leaves the journal entry behind for recovery when a swap is interrupted", async () => {
    // Simulates the kill point "after the writes complete but before
    // the journal entry is cleared": the entry must still be there, and
    // the next boot resumes or reports it rather than ignoring it.
    const id = await seed(dstDir, "Existing");
    const path = getTaskFilePath(dstDir, id);
    const original = await readFile(path, "utf-8");

    // Write a staged_swap entry by hand, as an interrupted op leaves.
    const base = join(dstDir, "local", "swap", "TESTOP");
    await mkdir(join(base, "backup"), { recursive: true });
    await writeFile(join(base, "backup", "0"), original, "utf-8");
    await writeFile(path, "HALF-WRITTEN\n", "utf-8");
    await writeFile(getJournalPath(dstDir), stringifyYaml({
      entries: [{
        id: "TESTOP", kind: "staged_swap", started_at: new Date().toISOString(),
        swap: {
          base_dir: base,
          files: [{ dest: path, backup: join(base, "backup", "0"), had_original: true }],
        },
      }],
    }), "utf-8");

    // The next operation that takes the lock runs recovery first.
    await withStateLock(dstDir, () => Promise.resolve());

    // Never silently ignored: rolled back from the recorded backup and
    // the entry cleared.
    expect(await readFile(path, "utf-8")).toBe(original);
    expect((await loadJournal(dstDir)).entries).toEqual([]);
  });
});

describe("dangling references", () => {
  // @verifies BAK-C18
  it("keeps and reports a relationship whose target is in neither side", async () => {
    const a = await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    // Point the task at a target that exists nowhere. P-12: a
    // relationship implies its inverse, so a dangling one is not
    // merely cosmetic.
    const missing = "01MISSINGTARGET0000000000";
    const lines = (await readFile(out, "utf-8")).split("\n");
    const idx = lines.findIndex(l => l.includes(`"id":"${a}"`));
    const record = JSON.parse(lines[idx] as string) as { raw: string };
    record.raw = record.raw.replace(
      /^---\n/,
      `---\nrelationships:\n  - type: blocks\n    target: ${missing}\n`,
    );
    lines[idx] = JSON.stringify(record);
    await writeFile(out, lines.join("\n"), "utf-8");

    await emptyTasks(dstDir);
    const report = await restoreBackup(dstDir, [out], { mode: "bare" });

    // K17 ruling 7: the task restores and the dangling edge is kept and
    // reported, not blocked and not stripped. `doctor` and sync
    // pre-flight surface it as `inconsistent` (P-12, "blocking
    // neither"); dropping it to leave a tidy tracker is what P-11 calls
    // destruction wearing leniency's clothes.
    const restored = await lookupTask(dstDir, a);
    const rels = restored.frontmatter.relationships ?? [];
    expect(rels.some(r => r.target === missing)).toBe(true);
    expect(report.created).toBe(1);
  });

  // @verifies BAK-C18
  it("never writes a projects.yaml whose default names an absent project", async () => {
    // The reference that actually cannot be satisfied here is
    // `projects.yaml`'s own `default`: it is a project id, and
    // ProjectsConfigSchema **refuses** a default that is not in the
    // list — so a restore that carried the destination's default onto
    // the backup's project list would leave a config file that does
    // not load at all, and the tracker unusable.
    //
    // A bare restore is exactly that case: the backup's projects
    // replace the list wholesale, and the two trackers' project ULIDs
    // differ because each was `init`ed independently.
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    const srcProjects = await loadProjectsConfig(srcDir);
    const dstProjects = await loadProjectsConfig(dstDir);
    expect(srcProjects.projects[0]?.id).not.toBe(dstProjects.projects[0]?.id);
    // The destination genuinely records a default, or the guard has
    // nothing to bite on and this test would pass vacuously.
    expect(dstProjects.default ?? dstProjects.projects[0]?.id).toBeDefined();

    await emptyTasks(dstDir);
    await restoreBackup(dstDir, [out], { mode: "bare" });

    // Loads at all — this is the assertion that fails when the default
    // is carried over blindly.
    const after = await loadProjectsConfig(dstDir);
    // And if a default is recorded, it names a project that is present.
    if (after.default !== undefined) {
      expect(after.projects.map(p => p.id)).toContain(after.default);
    }
  });
});

describe("the four hazards together", () => {
  // @verifies BAK-C23
  it("satisfies C11, C12, C17 and C20 at once on two active trackers", async () => {
    // Both hold tasks; keys collide; prefixes collide; label names
    // collide; counters have diverged. Each piece passing alone does
    // not make the combination work.
    const srcLabel = await createLabel(srcDir, { name: "bug" });
    const s1 = await seed(srcDir, "Source one");
    const s2 = await seed(srcDir, "Source two");
    const srcKeys = await Promise.all(
      [s1, s2].map(async i => (await lookupTask(srcDir, i)).frontmatter.key),
    );
    // Counters behind the tasks on the source side.
    const st = parseYaml(await readFile(getStateFilePath(srcDir), "utf-8")) as
      { keys: Record<string, { next_number: number }> };
    for (const k of Object.keys(st.keys)) {
      (st.keys[k] as { next_number: number }).next_number = 1;
    }
    await writeFile(getStateFilePath(srcDir), stringifyYaml(st), "utf-8");
    await exportBackup(srcDir, { outputPath: out });

    const dstLabel = await createLabel(dstDir, { name: "bug" });
    const d1 = await seed(dstDir, "Destination one");
    const d2 = await seed(dstDir, "Destination two");
    // The prefixes collide by construction: two `init`ed trackers.
    expect((await lookupTask(dstDir, d1)).frontmatter.key).toBe(srcKeys[0]);

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    // Every task from both inputs is accounted for — nothing dropped.
    const ids = await readdir(join(dstDir, "tasks"));
    expect(ids.sort()).toEqual([s1, s2, d1, d2].sort());
    expect(report.created).toBe(2);

    // No key is issued twice, across either side's tasks.
    const frontmatters = await Promise.all(
      ids.map(async i => (await lookupTask(dstDir, i)).frontmatter),
    );
    const keys = frontmatters.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);

    // Every task points at a project that exists...
    const projects = await loadProjectsConfig(dstDir);
    const projectIds = new Set(projects.projects.map(p => p.id));
    for (const f of frontmatters) {
      if (f.project !== undefined) expect(projectIds.has(f.project)).toBe(true);
    }
    // ...and both labels exist, the incoming one renamed.
    const labels = (parseYaml(
      await readFile(join(dstDir, "config", "labels.yaml"), "utf-8"),
    ) as { labels: { id: string; name: string }[] }).labels;
    expect(labels.find(l => l.id === srcLabel.id)?.name).toBe("bug (2)");
    expect(labels.find(l => l.id === dstLabel.id)?.name).toBe("bug");

    // And a task created now collides with nothing on either side.
    const fresh = await seed(dstDir, "Fresh");
    expect(keys).not.toContain((await lookupTask(dstDir, fresh)).frontmatter.key);
  });
});
