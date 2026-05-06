import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import {
  getHistoryFilePath,
  getLegacyHistoryFilePath,
  getTaskDir,
} from "../paths/index.js";
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

  it("writes to _history.yaml, not history.yaml", async () => {
    await appendHistory(locttDir, "task1", [entry1]);
    expect(await exists(getHistoryFilePath(locttDir, "task1"))).toBe(true);
    expect(await exists(getLegacyHistoryFilePath(locttDir, "task1"))).toBe(false);
  });

  it("reads from legacy history.yaml when _history.yaml is absent", async () => {
    const taskDir = getTaskDir(locttDir, "task1");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      getLegacyHistoryFilePath(locttDir, "task1"),
      stringifyYaml([entry1, entry2]),
      "utf-8",
    );

    const entries = await readHistory(locttDir, "task1");
    expect(entries).toEqual([entry1, entry2]);
  });

  it("dual-read: legacy entries are picked up, then the next append consolidates onto _history.yaml and removes history.yaml", async () => {
    const taskDir = getTaskDir(locttDir, "task1");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      getLegacyHistoryFilePath(locttDir, "task1"),
      stringifyYaml([entry1]),
      "utf-8",
    );

    // Read works from legacy.
    expect(await readHistory(locttDir, "task1")).toEqual([entry1]);

    // Next append flips us onto the new file.
    await appendHistory(locttDir, "task1", [entry2]);

    expect(await exists(getHistoryFilePath(locttDir, "task1"))).toBe(true);
    expect(await exists(getLegacyHistoryFilePath(locttDir, "task1"))).toBe(false);

    const entries = await readHistory(locttDir, "task1");
    expect(entries).toEqual([entry1, entry2]);
  });

  it("prefers _history.yaml when both files exist", async () => {
    const taskDir = getTaskDir(locttDir, "task1");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      getLegacyHistoryFilePath(locttDir, "task1"),
      stringifyYaml([entry3]),
      "utf-8",
    );
    await writeFile(
      getHistoryFilePath(locttDir, "task1"),
      stringifyYaml([entry1, entry2]),
      "utf-8",
    );

    const entries = await readHistory(locttDir, "task1");
    expect(entries).toEqual([entry1, entry2]);
  });
});
