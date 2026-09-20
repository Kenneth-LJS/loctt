/**
 * Restore's three modes and the collisions a merge actually hits.
 *
 * The merge rules here are `git/merge.ts`'s, not a second set: sync and
 * restore are the same problem, and two implementations of it would
 * silently disagree about rules Ken already settled (BAK-C24). These
 * tests assert the *behaviour* each function encodes, never that it was
 * called — a test asserting "it calls mergeById" is a code-review item.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { createLabel } from "../labels/manage.js";
import {
  getCommentsFilePath,
  getPrefixRenameStatePath,
  getSchemaMigrationInProgressPath,
  getStateFilePath,
  getTaskFilePath,
  resolveLocttDir,
} from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { loadKeyIndex, lookupKeyInIndex } from "../state/key-index.js";
import { postComment } from "../task/comments.js";
import { createTask } from "../task/create.js";
import { lookupTask } from "../task/lookup.js";
import { exportBackup } from "./export.js";
import { restoreBackup, RestoreRefusedError } from "./restore.js";

let src: string;
let srcDir: string;
let dst: string;
let dstDir: string;
let out: string;

beforeEach(async () => {
  src = await mkdtemp(join(tmpdir(), "loctt-res-src-"));
  dst = await mkdtemp(join(tmpdir(), "loctt-res-dst-"));
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

async function setBody(locttDir: string, id: string, body: string): Promise<void> {
  const p = getTaskFilePath(locttDir, id);
  const content = await readFile(p, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  await writeFile(p, `${m?.[0] ?? ""}${body}`, "utf-8");
}

async function emptyTasks(locttDir: string): Promise<void> {
  await rm(join(locttDir, "tasks"), { recursive: true, force: true });
  await mkdir(join(locttDir, "tasks"), { recursive: true });
}

describe("bare restore", () => {
  // @verifies BAK-C9
  it("refuses a non-empty tracker, naming the count and both flags", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });
    for (let i = 0; i < 42; i += 1) await seed(dstDir, `D${String(i)}`);
    const before = (await readdir(join(dstDir, "tasks"))).sort();

    await expect(restoreBackup(dstDir, [out], { mode: "bare" }))
      .rejects.toThrow(RestoreRefusedError);
    await expect(restoreBackup(dstDir, [out], { mode: "bare" }))
      .rejects.toThrow(/42 tasks.*--merge.*--overwrite/s);

    // Nothing written.
    expect((await readdir(join(dstDir, "tasks"))).sort()).toEqual(before);
  });
});

describe("--merge", () => {
  // @verifies BAK-C10
  it("creates absent ids, leaves present ones byte-identical, counts both", async () => {
    const shared = await seed(srcDir, "Shared");
    const onlyInBackup = await seed(srcDir, "OnlyBackup");
    await exportBackup(srcDir, { outputPath: out });

    // The destination holds `shared` with a body of its own, and has
    // moved on since the backup.
    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "tasks", shared), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, shared),
      await readFile(getTaskFilePath(srcDir, shared), "utf-8"),
    );
    await setBody(dstDir, shared, "Local edit made after the backup.\n");
    const before = await readFile(getTaskFilePath(dstDir, shared), "utf-8");

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    // Never edits what is present — byte-identical, compared on disk.
    expect(await readFile(getTaskFilePath(dstDir, shared), "utf-8")).toBe(before);
    // Adds what is absent.
    expect(await stat(getTaskFilePath(dstDir, onlyInBackup))
      .then(() => true, () => false)).toBe(true);
    // Created and skipped, separately.
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1);
  });

  // @verifies BAK-C10
  it("restores a task the destination hard-deleted since the backup", async () => {
    const gone = await seed(srcDir, "Deleted later");
    const kept = await seed(srcDir, "Kept");
    await exportBackup(srcDir, { outputPath: out });

    // The destination has both, then hard-deletes one and moves on:
    // later updated_at on the survivor, and further keys allocated.
    await emptyTasks(dstDir);
    for (const id of [gone, kept]) {
      await mkdir(join(dstDir, "tasks", id), { recursive: true });
      await writeFile(
        getTaskFilePath(dstDir, id),
        await readFile(getTaskFilePath(srcDir, id), "utf-8"),
      );
    }
    await rm(join(dstDir, "tasks", gone), { recursive: true, force: true });
    await seed(dstDir, "Since");

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    // The recover-my-deleted-tasks journey.
    expect(await stat(getTaskFilePath(dstDir, gone))
      .then(() => true, () => false)).toBe(true);
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1);
  });
});

describe("--overwrite", () => {
  // @verifies BAK-C13
  it("replaces carried ids, preserves the displaced body, and names it", async () => {
    const overwritten = await seed(srcDir, "Overwritten");
    await setBody(srcDir, overwritten, "The backup's version.\n");
    await exportBackup(srcDir, { outputPath: out });

    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "tasks", overwritten), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, overwritten),
      await readFile(getTaskFilePath(srcDir, overwritten), "utf-8"),
    );
    const localText = "Paragraphs the user wrote after the backup.\n";
    await setBody(dstDir, overwritten, localText);
    const untouched = await seed(dstDir, "Not in the backup");

    const report = await restoreBackup(dstDir, [out], { mode: "overwrite" });

    // Replaced.
    expect((await lookupTask(dstDir, overwritten)).body)
      .toContain("The backup's version.");
    // Ids absent from the backup are untouched.
    expect(await stat(getTaskFilePath(dstDir, untouched))
      .then(() => true, () => false)).toBe(true);
    expect(report.overwritten).toBe(1);

    // K17 ruling 6: the displaced text is recoverable and named, not
    // merely counted. Asserting the count alone passes while the text
    // is gone — the failure mergeTask's own comment calls the costliest.
    expect(report.displacedBodies).toHaveLength(1);
    const path = report.displacedBodies[0]?.path as string;
    expect(await readFile(path, "utf-8")).toContain(localText.trim());
  });

  // @verifies BAK-C13
  // The displaced-body file is task-dir content, so a subsequent backup
  // must carry it and a restore elsewhere must re-land it. Before the fix
  // the exporter carried only task.md/_comments/_history/attachments, so
  // "overwrite-restore → backup → restore elsewhere" lost the text.
  it("carries a displaced body through a later backup and restore (BAK-C13)", async () => {
    // 1) Create a displaced body in `dst` via an overwrite-restore.
    const id = await seed(srcDir, "Carried");
    await setBody(srcDir, id, "The backup's version.\n");
    await exportBackup(srcDir, { outputPath: out });

    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "tasks", id), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, id),
      await readFile(getTaskFilePath(srcDir, id), "utf-8"),
    );
    const displacedText = "Text the user wrote that got displaced.\n";
    await setBody(dstDir, id, displacedText);
    const firstRestore = await restoreBackup(dstDir, [out], { mode: "overwrite" });
    expect(firstRestore.displacedBodies).toHaveLength(1);
    const displacedName = basename(firstRestore.displacedBodies[0]!.path);

    // 2) Back up `dst` (which now holds the displaced-body file).
    const out2 = join(dst, "backup2.jsonl");
    await exportBackup(dstDir, { outputPath: out2 });

    // 3) Restore into a fresh third tracker.
    const third = await mkdtemp(join(tmpdir(), "loctt-res-third-"));
    try {
      await initLoctt(third, { docs: false });
      const thirdDir = resolveLocttDir(third);
      await restoreBackup(thirdDir, [out2], { mode: "bare" });

      // The displaced-body file survived the round-trip, text intact.
      const landed = join(thirdDir, "tasks", id, displacedName);
      expect(await readFile(landed, "utf-8")).toContain(displacedText.trim());
    } finally {
      await rm(third, { recursive: true, force: true });
    }
  });
});

describe("key, prefix and slug collisions", () => {
  // @verifies BAK-C11
  it("reallocates a colliding key, keeps the old one resolving, rebuilds the index", async () => {
    // Two trackers that independently allocated the same key.
    const a = await seed(srcDir, "Source T-1");
    const srcKey = (await lookupTask(srcDir, a)).frontmatter.key;
    await exportBackup(srcDir, { outputPath: out });

    const b = await seed(dstDir, "Destination T-1");
    const dstTask = await lookupTask(dstDir, b);
    expect(dstTask.frontmatter.key).toBe(srcKey);

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    const restored = await lookupTask(dstDir, a);
    // A fresh key from the destination project's counter.
    expect(restored.frontmatter.key).not.toBe(srcKey);
    // The original is in key_history (P-7)...
    expect(restored.frontmatter.key_history).toContain(srcKey);
    // ...and the destination's existing holder is untouched.
    expect((await lookupTask(dstDir, b)).frontmatter.key).toBe(srcKey);
    expect(report.reallocatedKeys.some(r => r.from === srcKey)).toBe(true);

    // The index is rebuilt and resolves the new key — not merely a
    // key_history scan. A96 excludes the index precisely so a stale
    // one cannot be restored.
    const index = await loadKeyIndex(dstDir);
    expect(index).toBeDefined();
    expect(lookupKeyInIndex(index as never, restored.frontmatter.key)).toBe(a);
    expect(lookupKeyInIndex(index as never, srcKey)).toBe(b);
  });

  // @verifies BAK-C12
  it("derives counters past the tasks even when both sides' counters are stale", async () => {
    const a = await seed(srcDir, "A");
    const b = await seed(srcDir, "B");
    const c = await seed(srcDir, "C");
    const highest = [a, b, c].map(() => 0);
    void highest;

    // Seed both counters BEHIND the tasks — a hand-edited state.yaml,
    // or one restored from an older backup. A max-of-counters
    // implementation passes a max-only test and collides later; this is
    // the fixture that separates the two.
    const srcState = parseYaml(
      await readFile(getStateFilePath(srcDir, ), "utf-8"),
    ) as { keys: Record<string, { prefix: string; next_number: number }> };
    for (const k of Object.keys(srcState.keys)) {
      (srcState.keys[k] as { next_number: number }).next_number = 1;
    }
    await writeFile(getStateFilePath(srcDir), stringifyYaml(srcState), "utf-8");
    await exportBackup(srcDir, { outputPath: out });

    await emptyTasks(dstDir);
    const dstState = parseYaml(
      await readFile(getStateFilePath(dstDir), "utf-8"),
    ) as { keys: Record<string, { prefix: string; next_number: number }> };
    for (const k of Object.keys(dstState.keys)) {
      (dstState.keys[k] as { next_number: number }).next_number = 2;
    }
    await writeFile(getStateFilePath(dstDir), stringifyYaml(dstState), "utf-8");

    await restoreBackup(dstDir, [out], { mode: "bare" });

    // Counter is past the highest key actually in use, not max(1, 2).
    const after = parseYaml(
      await readFile(getStateFilePath(dstDir), "utf-8"),
    ) as { keys: Record<string, { prefix: string; next_number: number }> };
    const restored = await Promise.all(
      (await readdir(join(dstDir, "tasks")))
        .map(async i => (await lookupTask(dstDir, i)).frontmatter),
    );
    const keys = restored.map(f => f.key);
    const highestInUse = Math.max(...keys.map(k => Number(/(\d+)$/.exec(k)?.[1] ?? 0)));
    // The counter to check is the one belonging to the project that
    // actually holds the tasks. Two independently-init-ed trackers mint
    // different project ULIDs, so `state.yaml` carries an entry for
    // each — reading whichever comes first checks the wrong one.
    const project = restored[0]?.project as string;
    expect(after.keys[project]?.next_number).toBeGreaterThan(highestInUse);
    // Specifically max(1, 1, highest + 1): both counters were seeded
    // behind the tasks, so a max-of-counters-only rule yields 2 here.
    expect(after.keys[project]?.next_number).toBe(highestInUse + 1);

    // And creating a task collides with nothing.
    const fresh = await seed(dstDir, "Fresh");
    const freshKey = (await lookupTask(dstDir, fresh)).frontmatter.key;
    expect(keys).not.toContain(freshKey);
  });

  // @verifies BAK-C12
  it("keeps retired_keys, so a deleted project's keys are never reissued", async () => {
    await seed(srcDir, "A");
    const state = parseYaml(
      await readFile(getStateFilePath(srcDir), "utf-8"),
    ) as Record<string, unknown>;
    // retired_keys is .optional(), so absent-on-one-side is a real
    // input: the destination has none.
    state["retired_keys"] = { GONE: { prefix: "GONE", next_number: 99 } };
    await writeFile(getStateFilePath(srcDir), stringifyYaml(state), "utf-8");
    await exportBackup(srcDir, { outputPath: out });

    await emptyTasks(dstDir);
    await restoreBackup(dstDir, [out], { mode: "bare" });

    const after = parseYaml(
      await readFile(getStateFilePath(dstDir), "utf-8"),
    ) as { retired_keys?: Record<string, { next_number: number }> };
    // The high-water mark survives and still guards.
    expect(after.retired_keys?.["GONE"]?.next_number).toBe(99);
  });

  // @verifies BAK-C20
  it("reassigns a colliding prefix and slug, and rewrites that project's keys", async () => {
    // Two independently init-ed trackers both mint prefix `T-` and
    // slug `tasks` for *different* project ULIDs.
    const a = await seed(srcDir, "Source task");
    const srcKey = (await lookupTask(srcDir, a)).frontmatter.key;
    const srcProjects = await loadProjectsConfig(srcDir);
    const dstProjects = await loadProjectsConfig(dstDir);
    expect(srcProjects.projects[0]?.prefix).toBe(dstProjects.projects[0]?.prefix);
    expect(srcProjects.projects[0]?.id).not.toBe(dstProjects.projects[0]?.id);
    await exportBackup(srcDir, { outputPath: out });

    await seed(dstDir, "Destination task");
    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    // Both projects survive with their own ULIDs (P-1)...
    const merged = await loadProjectsConfig(dstDir);
    const ids = merged.projects.map(p => p.id);
    expect(ids).toContain(srcProjects.projects[0]?.id);
    expect(ids).toContain(dstProjects.projects[0]?.id);

    // ...with distinct prefixes, so the two do not both issue T-n...
    const prefixes = merged.projects.map(p => p.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(report.reassignedPrefixes.length).toBeGreaterThan(0);

    // ...and distinct slugs. ProjectsConfigSchema rejects a duplicate,
    // so loadProjectsConfig succeeding above is itself the assertion
    // that assignProvisionalSlugs ran; this pins it explicitly.
    const slugs = merged.projects.map(p => p.slug).filter(s => s !== undefined);
    expect(new Set(slugs).size).toBe(slugs.length);

    // The moved project's keys are rewritten, old key kept resolving.
    const restored = await lookupTask(dstDir, a);
    const index = await loadKeyIndex(dstDir);
    if (restored.frontmatter.key !== srcKey) {
      expect(restored.frontmatter.key_history).toContain(srcKey);
      // key-index.yaml is rebuilt after the rewrite (BAK-C11).
      expect(lookupKeyInIndex(index as never, restored.frontmatter.key)).toBe(a);
    }
  });
});

describe("config collisions", () => {
  // @verifies BAK-C17
  it("keeps both same-named labels and renames the incoming one, non-collidingly", async () => {
    const srcLabel = await createLabel(srcDir, { name: "bug" });
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    // Already a legal state: LabelsConfigSchema dedupes on id, not name.
    const dstLabel = await createLabel(dstDir, { name: "bug" });
    expect(srcLabel.id).not.toBe(dstLabel.id);

    const report = await restoreBackup(dstDir, [out], { mode: "merge" });

    const labels = (parseYaml(
      await readFile(join(dstDir, "config", "labels.yaml"), "utf-8"),
    ) as { labels: { id: string; name: string }[] }).labels;

    // Both survive with their own ids (K17 ruling 4).
    expect(labels.find(l => l.id === srcLabel.id)).toBeDefined();
    expect(labels.find(l => l.id === dstLabel.id)).toBeDefined();
    // The destination keeps the plain name; the incoming one is renamed.
    expect(labels.find(l => l.id === dstLabel.id)?.name).toBe("bug");
    expect(labels.find(l => l.id === srcLabel.id)?.name).toBe("bug (2)");
    // Every rename is named in the report.
    expect(report.renamedEntities).toContainEqual({
      type: "labels", from: "bug", to: "bug (2)",
    });
  });

  // @verifies BAK-C17
  it("a second merge yields (3), not a second (2)", async () => {
    await createLabel(dstDir, { name: "bug" });
    await createLabel(dstDir, { name: "bug (2)" });

    await createLabel(srcDir, { name: "bug" });
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    await restoreBackup(dstDir, [out], { mode: "merge" });
    const labels = (parseYaml(
      await readFile(join(dstDir, "config", "labels.yaml"), "utf-8"),
    ) as { labels: { name: string }[] }).labels;
    const names = labels.map(l => l.name);
    expect(names).toContain("bug (3)");
    // The suffix is non-colliding, so no name appears twice.
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("merge engine parity (BAK-C24)", () => {
  // @verifies BAK-C24
  it("keeps the later updated_at when one comment is edited on both sides", async () => {
    const a = await seed(srcDir, "A");
    const posted = await postComment({ locttDir: srcDir, taskId: a, body: "original" });
    await exportBackup(srcDir, { outputPath: out });

    // The destination holds the same comment id, edited later.
    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "tasks", a), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, a),
      await readFile(getTaskFilePath(srcDir, a), "utf-8"),
    );
    const local = (parseYaml(
      await readFile(getCommentsFilePath(srcDir, a), "utf-8"),
    ) as { comments: Record<string, unknown>[] }).comments;
    // The destination's copy of the shared comment is the EARLIER one.
    // mergeComments walks local-then-incoming, so the destination copy
    // is inserted first and survives a no-op; only the `updated_at`
    // comparison replaces it with the backup's later text. Making the
    // destination the later side would let a dropped comparison pass.
    const stale = { ...(local[0] as Record<string, unknown>) };
    stale["body"] = "the destination's older text";
    stale["updated_at"] = "2000-01-01T00:00:00.000Z";
    // A second comment only the destination has, to prove nothing is lost.
    await writeFile(
      getCommentsFilePath(dstDir, a),
      stringifyYaml({
        comments: [
          stale,
          { ...stale, id: `${String(posted.id)}-other`, body: "only local" },
        ],
      }),
      "utf-8",
    );

    await restoreBackup(dstDir, [out], { mode: "overwrite" });

    const merged = (parseYaml(
      await readFile(getCommentsFilePath(dstDir, a), "utf-8"),
    ) as { comments: Record<string, unknown>[] }).comments;
    const same = merged.find(c => c["id"] === posted.id);
    // The later updated_at wins — here that is the backup's copy...
    expect(same?.["body"]).toBe("original");
    expect(same?.["updated_at"]).not.toBe("2000-01-01T00:00:00.000Z");
    // ...and neither side is lost (P-11).
    expect(merged).toHaveLength(2);
    expect(merged.map(c => c["body"])).toContain("only local");
  });

  // @verifies BAK-C24
  it("merges history into one timeline in timestamp order", async () => {
    const a = await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "tasks", a), { recursive: true });
    await writeFile(
      getTaskFilePath(dstDir, a),
      await readFile(getTaskFilePath(srcDir, a), "utf-8"),
    );
    // Two destination-only entries straddling the backup's, so the
    // merged file can only come out ordered if it was actually sorted.
    // `mergeHistory` concatenates local-then-incoming before sorting;
    // a destination entry that already sorted first would leave
    // concatenation and sorting indistinguishable.
    await writeFile(
      join(dstDir, "tasks", a, "_history.yaml"),
      stringifyYaml([
        { timestamp: "2999-01-01T00:00:00.000Z", kind: "field_change", field: "late" },
        { timestamp: "2000-01-01T00:00:00.000Z", kind: "field_change", field: "early" },
      ]),
      "utf-8",
    );

    await restoreBackup(dstDir, [out], { mode: "overwrite" });

    const merged = parseYaml(
      await readFile(join(dstDir, "tasks", a, "_history.yaml"), "utf-8"),
    ) as { timestamp: string }[];
    // One timeline, not two concatenated: the backup's own entries sit
    // between the destination's two, which concatenation cannot produce.
    expect(merged.length).toBeGreaterThan(2);
    const stamps = merged.map(e => e.timestamp);
    expect([...stamps].sort()).toEqual(stamps);
    expect(stamps[0]).toBe("2000-01-01T00:00:00.000Z");
    expect(stamps.at(-1)).toBe("2999-01-01T00:00:00.000Z");
  });

  // @verifies BAK-C24
  it("keeps the local entity when an id is present on both sides", async () => {
    const label = await createLabel(srcDir, { name: "shared" });
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });

    // Same id, different colour, on the destination.
    const dstLabels = { labels: [{ ...label, color: "#ff0000" }] };
    await writeFile(
      join(dstDir, "config", "labels.yaml"), stringifyYaml(dstLabels), "utf-8",
    );

    await restoreBackup(dstDir, [out], { mode: "merge" });

    const after = (parseYaml(
      await readFile(join(dstDir, "config", "labels.yaml"), "utf-8"),
    ) as { labels: { id: string; color?: string }[] }).labels;
    // Local wins — settled by Ken 2026-08-16.
    expect(after.find(l => l.id === label.id)?.color).toBe("#ff0000");
  });
});

describe("guards", () => {
  // @verifies BAK-C22
  it("refuses a destination mid prefix-rename, naming the sentinel", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });
    await emptyTasks(dstDir);
    await mkdir(join(dstDir, "local"), { recursive: true });
    await writeFile(getPrefixRenameStatePath(dstDir), "from: T-\nto: X-\n", "utf-8");

    await expect(restoreBackup(dstDir, [out], { mode: "merge" }))
      .rejects.toThrow(/prefix-rename\.yaml[\s\S]*doctor/);
    expect(await readdir(join(dstDir, "tasks"))).toEqual([]);
  });

  // @verifies BAK-C22
  it("refuses a destination mid schema-migration, naming the sentinel", async () => {
    await seed(srcDir, "A");
    await exportBackup(srcDir, { outputPath: out });
    await emptyTasks(dstDir);
    await writeFile(getSchemaMigrationInProgressPath(dstDir), "in progress\n", "utf-8");

    await expect(restoreBackup(dstDir, [out], { mode: "merge" }))
      .rejects.toThrow(/schema-migration-in-progress[\s\S]*migrate/);
    expect(await readdir(join(dstDir, "tasks"))).toEqual([]);
  });
});

describe("--dry-run", () => {
  // @verifies BAK-C15
  it("predicts the real counts and changes nothing, in all three modes", async () => {
    const shared = await seed(srcDir, "Shared");
    await seed(srcDir, "OnlyBackup");
    await exportBackup(srcDir, { outputPath: out });

    for (const mode of ["bare", "merge", "overwrite"] as const) {
      // A fresh destination per mode, since a real run mutates it.
      const d = await mkdtemp(join(tmpdir(), "loctt-dry-"));
      await initLoctt(d, { docs: false });
      const dDir = resolveLocttDir(d);
      await emptyTasks(dDir);
      if (mode !== "bare") {
        await mkdir(join(dDir, "tasks", shared), { recursive: true });
        await writeFile(
          getTaskFilePath(dDir, shared),
          await readFile(getTaskFilePath(srcDir, shared), "utf-8"),
        );
      }

      const snapshot = await snapshotTree(dDir);
      const predicted = await restoreBackup(dDir, [out], { mode, dryRun: true });
      // Byte-identical after a dry run.
      expect(await snapshotTree(dDir)).toEqual(snapshot);

      const real = await restoreBackup(dDir, [out], { mode });
      expect(predicted.created).toBe(real.created);
      expect(predicted.skipped).toBe(real.skipped);
      expect(predicted.overwritten).toBe(real.overwritten);
      await rm(d, { recursive: true, force: true });
    }
  });
});

/** Every file under a tracker, with its bytes — for a byte-identical check. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(p: string, rel: string): Promise<void> {
    for (const entry of await readdir(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
      // The lock and journal churn by design; they are not tracker data.
      if (r.startsWith("local/")) continue;
      if (entry.isDirectory()) await walk(full, r);
      else out[r] = (await readFile(full)).toString("base64");
    }
  }
  await walk(dir, "");
  return out;
}

describe("restore refuses a path-traversal (zip-slip) backup (Phase Z SEC-1/SEC-2)", () => {
  // A backup is an "import from elsewhere" operation; a crafted one must
  // not write outside the tracker. Restore historically joined a record's
  // attacker-controlled `name`/`path` straight onto the tracker dir, so a
  // `../` entry wrote an arbitrary file (→ RCE via a git hook / shell rc).
  // Each case injects one malicious record into an otherwise-valid backup
  // and asserts restore REFUSES the whole thing and nothing escapes.
  async function assertNoEscape(): Promise<void> {
    // No file with our marker name should exist anywhere near the tracker.
    const outside = join(dst, "..", "PWNED-phase-z.txt");
    await expect(stat(outside)).rejects.toThrow();
  }

  // The refusal must land BEFORE any write (Phase Z fix-review): the
  // per-site guards originally ran after stagedSwap, so a traversal
  // attachment still let every task/config/state file land — a
  // half-applied restore — before throwing. These assert the destination
  // is untouched, not merely that it threw.
  async function assertDestUntouched(): Promise<void> {
    const taskDirs = await readdir(join(dstDir, "tasks")).catch(() => [] as string[]);
    expect(taskDirs).toEqual([]); // emptyTasks() left it empty; nothing was written
    await assertNoEscape();
  }

  it("refuses a config record whose path escapes the tracker, writing nothing (SEC-2)", async () => {
    await seed(srcDir, "keep");
    await exportBackup(srcDir, { outputPath: out });
    const lines = (await readFile(out, "utf-8")).trimEnd().split("\n");
    lines.push(JSON.stringify({
      kind: "config",
      path: "../../PWNED-phase-z.txt",
      content: "owned: true\n",
    }));
    await writeFile(out, lines.join("\n") + "\n", "utf-8");

    await emptyTasks(dstDir);
    await expect(restoreBackup(dstDir, [out], { mode: "bare" }))
      .rejects.toThrow(RestoreRefusedError);
    // The legitimate task in the same backup must NOT have landed — the
    // refusal is up front, before any write.
    await assertDestUntouched();
  });

  it("refuses a task attachment whose name escapes, writing nothing (SEC-1)", async () => {
    const id = await seed(srcDir, "keep");
    await exportBackup(srcDir, { outputPath: out });
    const lines = (await readFile(out, "utf-8")).trimEnd().split("\n");
    const patched = lines.map(line => {
      const rec = JSON.parse(line) as { kind?: string; id?: string; attachments?: unknown[] };
      if (rec.kind === "task" && rec.id === id) {
        rec.attachments = [{ name: "../../../PWNED-phase-z.txt", bytes: Buffer.from("owned").toString("base64") }];
        return JSON.stringify(rec);
      }
      return line;
    });
    await writeFile(out, patched.join("\n") + "\n", "utf-8");

    await emptyTasks(dstDir);
    await expect(restoreBackup(dstDir, [out], { mode: "bare" }))
      .rejects.toThrow(RestoreRefusedError);
    await assertDestUntouched();
  });

  it("refuses a traversal backup on a DRY RUN too (the check is not write-time)", async () => {
    await seed(srcDir, "keep");
    await exportBackup(srcDir, { outputPath: out });
    const lines = (await readFile(out, "utf-8")).trimEnd().split("\n");
    lines.push(JSON.stringify({
      kind: "config", path: "../../PWNED-phase-z.txt", content: "owned: true\n",
    }));
    await writeFile(out, lines.join("\n") + "\n", "utf-8");

    await emptyTasks(dstDir);
    // The dry run reported nothing before the fix, because the per-site
    // guard sat past the dryRun return. It must refuse here too.
    await expect(restoreBackup(dstDir, [out], { mode: "bare", dryRun: true }))
      .rejects.toThrow(RestoreRefusedError);
    await assertNoEscape();
  });
});
