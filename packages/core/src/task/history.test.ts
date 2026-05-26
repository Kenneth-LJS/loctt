import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getHistoryFilePath } from "../paths/index.js";
import { appendHistory, readHistory } from "./history.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("task history", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-history-test-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const entry1: HistoryEntry = {
    timestamp: "2026-04-16T10:00:00Z",
    kind: "created",
  };

  const entry2: HistoryEntry = {
    timestamp: "2026-04-16T11:00:00Z",
    kind: "field_change",
    field: "status",
    before: "not_started",
    after: "in_progress",
  };

  const entry3: HistoryEntry = {
    timestamp: "2026-04-16T12:00:00Z",
    kind: "link_added",
    meta: { type: "blocks", target: "T-2" },
  };

  it("returns [] for a missing history file", async () => {
    const entries = await readHistory(locttDir, "nonexistent");
    expect(entries).toEqual([]);
  });

  it("round-trips: append entries then read them back", async () => {
    await appendHistory(locttDir, "task1", [entry1, entry2]);
    const entries = await readHistory(locttDir, "task1");

    expect(entries).toHaveLength(2);
    expect(entries).toEqual([
      { timestamp: "2026-04-16T10:00:00Z", kind: "created" },
      {
        timestamp: "2026-04-16T11:00:00Z",
        kind: "field_change",
        field: "status",
        before: "not_started",
        after: "in_progress",
      },
    ]);
  });

  it("multiple appends accumulate correctly", async () => {
    await appendHistory(locttDir, "task1", [entry1]);
    await appendHistory(locttDir, "task1", [entry2]);
    await appendHistory(locttDir, "task1", [entry3]);

    const entries = await readHistory(locttDir, "task1");
    expect(entries).toHaveLength(3);
    expect(entries).toEqual([entry1, entry2, entry3]);
  });

  it("skips append when entries array is empty", async () => {
    await appendHistory(locttDir, "task1", [entry1]);
    await appendHistory(locttDir, "task1", []);

    const entries = await readHistory(locttDir, "task1");
    expect(entries).toHaveLength(1);
  });

  it("writes to _history.yaml", async () => {
    await appendHistory(locttDir, "task1", [entry1]);
    expect(await exists(getHistoryFilePath(locttDir, "task1"))).toBe(true);
  });

  it("concurrent appends to the same task do not lose entries", async () => {
    // Without the per-task lock, two simultaneous append calls would
    // both read the empty baseline, both write, and the second rename
    // would clobber the first — losing one entry. Five concurrent
    // writers is enough to deterministically expose the race in the
    // unlocked implementation while staying well under the lock retry
    // budget on CI.
    const N = 5;
    const entries: HistoryEntry[] = Array.from({ length: N }, (_, i) => ({
      timestamp: `2026-04-16T10:00:${String(i).padStart(2, "0")}Z`,
      kind: "created",
    }));
    await Promise.all(
      entries.map(e => appendHistory(locttDir, "task-concurrent", [e])),
    );
    const final = await readHistory(locttDir, "task-concurrent");
    expect(final).toHaveLength(N);
    const seenTimestamps = new Set(final.map(e => e.timestamp));
    expect(seenTimestamps.size).toBe(N);
  });
});

describe("history actor attribution", () => {
  // Phase 6: appendHistory auto-stamps `actor` (current user id) on
  // entries that don't already carry one. Switching the active user
  // mid-flow yields entries attributed to distinct actors.

  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-history-actor-"));
    // Use a fully initialized tracker so users/ exists.
    const { initLoctt } = await import("../init/init.js");
    const { resolveLocttDir } = await import("../paths/index.js");
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stamps actor from the active user when one exists", async () => {
    // initLoctt creates a default user and sets them as current.
    const { readCurrentUserId } = await import("../users/current.js");
    const activeId = await readCurrentUserId(locttDir);
    expect(activeId).toBeTruthy();

    await appendHistory(locttDir, "t1", [{
      timestamp: "2026-04-16T10:00:00Z",
      kind: "created",
    }]);
    const entries = await readHistory(locttDir, "t1");
    expect(entries[0]?.actor).toBe(activeId);
  });

  it("two ops separated by a user switch attribute to different actors", async () => {
    // The whole point of the feature: audit trails distinguish who
    // did what across user switches.
    const { createUser } = await import("../users/lifecycle.js");
    const { switchCurrentUser } = await import("../users/manage.js");
    const { readCurrentUserId } = await import("../users/current.js");
    const aliceId = await readCurrentUserId(locttDir);
    expect(aliceId).toBeTruthy();
    const bob = await createUser(locttDir, { name: "Bob" });

    await appendHistory(locttDir, "t1", [{
      timestamp: "2026-04-16T10:00:00Z",
      kind: "created",
    }]);

    await switchCurrentUser(locttDir, bob.id);

    await appendHistory(locttDir, "t1", [{
      timestamp: "2026-04-16T11:00:00Z",
      kind: "field_change",
      field: "status",
      before: "not_started",
      after: "in_progress",
    }]);

    const entries = await readHistory(locttDir, "t1");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.actor).toBe(aliceId);
    expect(entries[1]?.actor).toBe(bob.id);
  });

  it("preserves an explicit actor when the caller supplies one", async () => {
    // Migration / recovery / import paths can pass actor in the
    // entry; we don't overwrite it with the current user.
    await appendHistory(locttDir, "t1", [{
      timestamp: "2026-04-16T10:00:00Z",
      kind: "created",
      actor: "explicit-actor-id",
    }]);
    const entries = await readHistory(locttDir, "t1");
    expect(entries[0]?.actor).toBe("explicit-actor-id");
  });

  it("leaves actor absent when there is no current user", async () => {
    // Headless flow: remove the .current-user pointer so
    // readCurrentUserId returns null. appendHistory must not stamp.
    const { rm: rmFs } = await import("node:fs/promises");
    const { getCurrentUserPath } = await import("../paths/index.js");
    await rmFs(getCurrentUserPath(locttDir), { force: true });

    await appendHistory(locttDir, "t1", [{
      timestamp: "2026-04-16T10:00:00Z",
      kind: "created",
    }]);
    const entries = await readHistory(locttDir, "t1");
    expect(entries[0]).not.toHaveProperty("actor");
  });

  it("stamps each entry in a multi-entry batch with the same actor", async () => {
    // A single setField call may emit multiple history entries (e.g.
    // labels added + labels removed). All entries in one append must
    // share the actor — they're a single logical operation.
    const { readCurrentUserId } = await import("../users/current.js");
    const activeId = await readCurrentUserId(locttDir);

    await appendHistory(locttDir, "t1", [
      { timestamp: "2026-04-16T10:00:00Z", kind: "label_added", meta: { label: "a" } },
      { timestamp: "2026-04-16T10:00:00Z", kind: "label_added", meta: { label: "b" } },
      { timestamp: "2026-04-16T10:00:00Z", kind: "label_removed", meta: { label: "c" } },
    ]);
    const entries = await readHistory(locttDir, "t1");
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(e.actor).toBe(activeId);
  });

  it("round-trips bulk_op_id through write + read", async () => {
    // CW-11: bulk operations stamp every entry in one logical bulk call
    // with a shared bulk_op_id. The UI uses this to collapse entries.
    const opId = "01HXBULK000000000000000001";
    await appendHistory(locttDir, "t1", [
      { timestamp: "2026-05-21T10:00:00Z", kind: "field_change", field: "status", before: "backlog", after: "doing", bulk_op_id: opId },
      { timestamp: "2026-05-21T10:00:00Z", kind: "field_change", field: "status", before: "backlog", after: "doing", bulk_op_id: opId },
    ]);
    const entries = await readHistory(locttDir, "t1");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.bulk_op_id).toBe(opId);
    expect(entries[1]?.bulk_op_id).toBe(opId);
  });
});
