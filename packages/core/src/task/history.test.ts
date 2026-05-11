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
