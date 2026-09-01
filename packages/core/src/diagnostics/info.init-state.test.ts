import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/index.js";
import { getTrackerInfo } from "./info.js";

/**
 * `initState` exists because `exists` cannot answer the question two
 * cases ask in opposite directions.
 *
 * ONB-16: an **empty** `.loctt/` must be treated as uninitialized and
 * offered the init wizard.
 * SET-30: a `.loctt/` **holding tasks** but missing `.schema-version`
 * is *damaged*, and must never be offered init — "a `.loctt/` holding
 * tasks but no version file is damaged, not empty".
 *
 * `exists` is set from the directory being present, so both are
 * `true` and neither case can be served. These tests pin the four
 * states apart.
 */
describe("getTrackerInfo initState", () => {
  const roots: string[] = [];
  const mkroot = async (): Promise<string> => {
    const r = await mkdtemp(join(tmpdir(), "loctt-initstate-"));
    roots.push(r);
    return r;
  };
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true })));
  });

  // @verifies ONB-1
  it("reports `absent` when there is no .loctt at all", async () => {
    const root = await mkroot();
    const info = await getTrackerInfo(root);
    expect(info.exists).toBe(false);
    expect(info.initState).toBe("absent");
  });

  // @verifies ONB-16
  it("reports `empty` for a .loctt directory with nothing in it", async () => {
    const root = await mkroot();
    await mkdir(join(root, ".loctt"));
    const info = await getTrackerInfo(root);
    // The distinction the case turns on: present, but not a tracker.
    expect(info.exists).toBe(true);
    expect(info.initState).toBe("empty");
  });

  // @verifies ONB-16
  it("reports `empty` for a .loctt holding only files that are not a tracker", async () => {
    const root = await mkroot();
    await mkdir(join(root, ".loctt"));
    await writeFile(join(root, ".loctt", "notes.txt"), "left over", "utf8");
    const info = await getTrackerInfo(root);
    expect(info.initState).toBe("empty");
  });

  // @verifies ONB-16
  it("reports `ready` for a healthy tracker", async () => {
    const root = await mkroot();
    await initLoctt(root);
    const info = await getTrackerInfo(root);
    expect(info.initState).toBe("ready");
  });

  // This is the half that must NOT move. SET-30's bullet is explicit:
  // a `.loctt/` holding tasks but no version file is damaged, and the
  // remedy is `loctt migrate`/`--repair`, never a fresh init — which
  // would rewrite state.yaml with the key counter back at 1 and
  // reissue keys that already exist.
  it("reports `damaged`, not `empty`, when core files are missing but tasks survive", async () => {
    const root = await mkroot();
    await initLoctt(root);
    await unlink(join(root, ".loctt", ".schema-version"));
    await unlink(join(root, ".loctt", "state.yaml"));
    const info = await getTrackerInfo(root);
    expect(info.initState).toBe("damaged");
  });

  it("reports `damaged` when only a task directory survives", async () => {
    const root = await mkroot();
    await mkdir(join(root, ".loctt", "tasks", "01ABC"), { recursive: true });
    await writeFile(
      join(root, ".loctt", "tasks", "01ABC", "task.md"),
      "---\nid: 01ABC\nkey: T-1\ntitle: survivor\n---\n",
      "utf8",
    );
    const info = await getTrackerInfo(root);
    // No core files at all — but a task on disk is data to lose, so
    // this is never `empty`.
    expect(info.taskCount).toBe(1);
    expect(info.initState).toBe("damaged");
  });

  it("reports `damaged` when config survives without state", async () => {
    const root = await mkroot();
    await initLoctt(root);
    await unlink(join(root, ".loctt", "state.yaml"));
    const info = await getTrackerInfo(root);
    // A readable workflow.yaml is someone's configuration, even with
    // no tasks — initializing over it would discard it.
    expect(info.initState).toBe("damaged");
  });
});
