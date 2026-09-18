import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { pushRecent, readRecents, RECENTS_CAP, removeRecent } from "./recents.js";

let locttDir: string;
let root: string;
const userId = "u1";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-recents-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("recents", () => {
  it("returns empty list when no file exists", async () => {
    expect(await readRecents(locttDir, userId)).toEqual([]);
  });

  it("pushes a task to the front", async () => {
    await pushRecent(locttDir, userId, "t1", "2026-05-26T10:00:00Z");
    await pushRecent(locttDir, userId, "t2", "2026-05-26T10:01:00Z");
    const list = await readRecents(locttDir, userId);
    expect(list.map(e => e.id)).toEqual(["t2", "t1"]);
  });

  it("moves an existing id to the front and updates its timestamp", async () => {
    await pushRecent(locttDir, userId, "t1", "2026-05-26T10:00:00Z");
    await pushRecent(locttDir, userId, "t2", "2026-05-26T10:01:00Z");
    await pushRecent(locttDir, userId, "t1", "2026-05-26T10:02:00Z");
    const list = await readRecents(locttDir, userId);
    expect(list.map(e => e.id)).toEqual(["t1", "t2"]);
    expect(list[0]?.at).toBe("2026-05-26T10:02:00Z");
  });

  it("caps the list at RECENTS_CAP entries", async () => {
    for (let i = 0; i < RECENTS_CAP + 5; i++) {
      await pushRecent(locttDir, userId, `t${i}`, `2026-05-26T10:00:${String(i).padStart(2, "0")}Z`);
    }
    const list = await readRecents(locttDir, userId);
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0]?.id).toBe(`t${RECENTS_CAP + 4}`);
  });

  it("removeRecent drops a single id and is a no-op when absent", async () => {
    await pushRecent(locttDir, userId, "t1");
    await pushRecent(locttDir, userId, "t2");
    await removeRecent(locttDir, userId, "t1");
    expect((await readRecents(locttDir, userId)).map(e => e.id)).toEqual(["t2"]);
    await removeRecent(locttDir, userId, "absent");
    expect((await readRecents(locttDir, userId)).map(e => e.id)).toEqual(["t2"]);
  });

  it("recents are per-user", async () => {
    await pushRecent(locttDir, "alice", "t1");
    await pushRecent(locttDir, "bob", "t2");
    expect((await readRecents(locttDir, "alice")).map(e => e.id)).toEqual(["t1"]);
    expect((await readRecents(locttDir, "bob")).map(e => e.id)).toEqual(["t2"]);
  });
});
