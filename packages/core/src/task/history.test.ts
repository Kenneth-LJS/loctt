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

  describe("body_edited coalescing (CW-16)", () => {
    it("coalesces a same-actor body_edited burst into one entry", async () => {
      // Three appends within the 15-min window: only one entry on disk.
      const t0 = "2026-05-21T10:00:00Z";
      const t1 = "2026-05-21T10:05:00Z";
      const t2 = "2026-05-21T10:14:30Z";
      await appendHistory(locttDir, "t1", [{ timestamp: t0, kind: "body_edited" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: t1, kind: "body_edited" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: t2, kind: "body_edited" }]);
      const entries = await readHistory(locttDir, "t1");
      expect(entries).toHaveLength(1);
      // Timestamp rolled forward to the most recent.
      expect(entries[0]?.timestamp).toBe(t2);
    });

    it("starts a fresh entry when the window expires", async () => {
      const t0 = "2026-05-21T10:00:00Z";
      const t1 = "2026-05-21T10:20:00Z"; // 20 min later — past the window
      await appendHistory(locttDir, "t1", [{ timestamp: t0, kind: "body_edited" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: t1, kind: "body_edited" }]);
      const entries = await readHistory(locttDir, "t1");
      expect(entries).toHaveLength(2);
    });

    it("does not coalesce across actors", async () => {
      // Force-stamp distinct actors by passing them on the entry directly.
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:00:00Z", kind: "body_edited", actor: "u-ken" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:05:00Z", kind: "body_edited", actor: "u-sara" }]);
      const entries = await readHistory(locttDir, "t1");
      expect(entries).toHaveLength(2);
    });

    it("does not coalesce non-body_edited kinds", async () => {
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:00:00Z", kind: "field_change", field: "title", before: "a", after: "b" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:01:00Z", kind: "field_change", field: "title", before: "b", after: "c" }]);
      const entries = await readHistory(locttDir, "t1");
      expect(entries).toHaveLength(2);
    });

    it("never coalesces entries carrying bulk_op_id", async () => {
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:00:00Z", kind: "body_edited", bulk_op_id: "op1" }]);
      await appendHistory(locttDir, "t1", [{ timestamp: "2026-05-21T10:01:00Z", kind: "body_edited", bulk_op_id: "op2" }]);
      const entries = await readHistory(locttDir, "t1");
      expect(entries).toHaveLength(2);
    });
  });

  describe("pagination (CW-7)", () => {
    async function seedN(taskId: string, n: number): Promise<void> {
      const entries: HistoryEntry[] = Array.from({ length: n }, (_, i) => ({
        timestamp: `2026-05-21T10:${String(i).padStart(2, "0")}:00Z`,
        kind: i % 2 === 0 ? "field_change" : "label_added",
        ...(i % 2 === 0
          ? { field: "title", before: `a${i}`, after: `b${i}` }
          : { after: `l${i}` }),
      }));
      await appendHistory(locttDir, taskId, entries);
    }

    it("returns array when no options provided", async () => {
      await seedN("p1", 3);
      const result = await readHistory(locttDir, "p1");
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
    });

    it("returns page with total when options provided", async () => {
      await seedN("p2", 10);
      const page = await readHistory(locttDir, "p2", { limit: 3 });
      expect(page.entries).toHaveLength(3);
      expect(page.total).toBe(10);
    });

    it("offset + limit produce the right slice", async () => {
      await seedN("p3", 10);
      const page = await readHistory(locttDir, "p3", { offset: 5, limit: 3 });
      expect(page.entries).toHaveLength(3);
      expect(page.entries[0]?.timestamp).toBe("2026-05-21T10:05:00Z");
    });

    it("order: desc returns newest first", async () => {
      await seedN("p4", 5);
      const page = await readHistory(locttDir, "p4", { order: "desc", limit: 2 });
      expect(page.entries[0]?.timestamp).toBe("2026-05-21T10:04:00Z");
      expect(page.entries[1]?.timestamp).toBe("2026-05-21T10:03:00Z");
    });

    it("kinds filter applies before limit and total", async () => {
      await seedN("p5", 10);
      const page = await readHistory(locttDir, "p5", { kinds: ["label_added"] });
      expect(page.total).toBe(5);
      expect(page.entries.every(e => e.kind === "label_added")).toBe(true);
    });

    it("missing history file returns empty page when options provided", async () => {
      const page = await readHistory(locttDir, "nope", { limit: 5 });
      expect(page.entries).toEqual([]);
      expect(page.total).toBe(0);
    });
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
