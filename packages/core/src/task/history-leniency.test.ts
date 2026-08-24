import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { mergeHistory } from "../git/merge.js";
import { UnreadableFileError } from "../utils/read-state.js";
import {
  appendHistory,
  isMalformedHistoryEntry,
  readHistory,
  readHistoryRows,
} from "./history.js";

/**
 * P-11 for history, and V2's merge half.
 *
 * History is M2's recovery path — the thing that makes a lost merge
 * race recoverable — so discarding it is the worst available failure.
 * Two ways that used to happen:
 *
 *  - `readHistory` returned `[]` on any read failure, and
 *    `appendHistory` writes `[...existing, entry]` back. An unreadable
 *    file became a one-entry file.
 *  - `mergeHistory` keys on timestamp+kind+actor+field. An entry with
 *    no timestamp keys to "\0\0\0", so *every* such entry across both
 *    sides collapses into one and the rest are dropped.
 */

const TASK_ID = "01J0000000000000000000TASK";
let dir: string;

function historyPath(): string {
  return join(dir, "tasks", TASK_ID, "_history.yaml");
}

async function readRaw(): Promise<unknown[]> {
  return parseYaml(await readFile(historyPath(), "utf-8")) as unknown[];
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-history-p11-"));
  await mkdir(join(dir, "tasks", TASK_ID), { recursive: true });
});

afterEach(async () => {
  await chmod(historyPath(), 0o644).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

async function seed(kinds: string[]): Promise<void> {
  for (const [i, kind] of kinds.entries()) {
    await appendHistory(dir, TASK_ID, [{
      timestamp: `2026-01-0${String(i + 1)}T00:00:00.000Z`,
      kind: kind as never,
    }]);
  }
}

describe("an unreadable history file is never written over", () => {
  it("refuses to append rather than replacing it with one entry", async () => {
    await seed(["created", "status_changed", "body_edited"]);
    await chmod(historyPath(), 0o000);

    await expect(
      appendHistory(dir, TASK_ID, [{ timestamp: "2026-02-01T00:00:00.000Z", kind: "created" as never }]),
    ).rejects.toThrow(UnreadableFileError);

    await chmod(historyPath(), 0o644);
    expect(await readRaw()).toHaveLength(3);
  });

  it("refuses to read rather than reporting an unreadable file as empty", async () => {
    await seed(["created"]);
    await chmod(historyPath(), 0o000);
    await expect(readHistory(dir, TASK_ID)).rejects.toThrow(UnreadableFileError);
  });

  it("still reports an absent file as empty", async () => {
    // A task with no history yet is a real state and must stay
    // distinguishable from a failure.
    expect(await readHistory(dir, TASK_ID)).toEqual([]);
  });
});

describe("a malformed entry is kept and merged, not dropped", () => {
  async function seedWithMalformedMiddle(): Promise<void> {
    await seed(["created", "body_edited"]);
    const raw = await readRaw();
    raw.splice(1, 0, { note: "hand-edited, not an entry" });
    await writeFile(historyPath(), stringifyYaml(raw), "utf-8");
  }

  it("survives an append", async () => {
    await seedWithMalformedMiddle();

    await appendHistory(dir, TASK_ID, [{
      timestamp: "2026-03-01T00:00:00.000Z",
      kind: "status_changed" as never,
    }]);

    const raw = await readRaw();
    expect(raw).toContainEqual({ note: "hand-edited, not an entry" });
  });

  it("keeps its position relative to its neighbours", async () => {
    await seedWithMalformedMiddle();
    await appendHistory(dir, TASK_ID, [{
      timestamp: "2026-03-01T00:00:00.000Z",
      kind: "status_changed" as never,
    }]);

    // Index 1, where it was — not shunted to the end, which would be a
    // claim about when it happened.
    expect((await readRaw())[1]).toEqual({ note: "hand-edited, not an entry" });
  });

  it("is omitted from readHistory, which renders an activity log", async () => {
    await seedWithMalformedMiddle();
    const entries = await readHistory(dir, TASK_ID);
    // Omitted from the render, not from the file.
    expect(entries).toHaveLength(2);
    expect(entries.every(e => typeof e.timestamp === "string")).toBe(true);
  });

  it("is reported by readHistoryRows, which diagnostics read", async () => {
    await seedWithMalformedMiddle();
    const rows = await readHistoryRows(dir, TASK_ID);
    const malformed = rows.filter(isMalformedHistoryEntry);

    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.index).toBe(1);
  });

  it("does not break paging or ordering of the readable entries", async () => {
    await seedWithMalformedMiddle();
    // A malformed row has no timestamp; sorting on it would throw or
    // produce nonsense, so it must be excluded from the ordered set.
    const page = await readHistory(dir, TASK_ID, { order: "desc", limit: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});

describe("an unrecognised kind is malformed, not readable", () => {
  it("excludes it from readHistory", async () => {
    await seed(["created"]);
    const raw = await readRaw();
    // A hand-edit is the realistic source: `kind` is a closed union of
    // 17 values, and nothing LocTT writes produces anything else.
    raw.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath(), stringifyYaml(raw), "utf-8");

    // Before the schema, `isHistoryEntry` checked only that `kind` was
    // a *string*, so this rendered in `loctt log` and would reach a UI
    // that switches on kind for an icon with no case for it.
    const entries = await readHistory(dir, TASK_ID);
    expect(entries.map(e => e.kind)).toEqual(["created"]);
  });

  it("keeps it in the file and reports it (P-11)", async () => {
    await seed(["created"]);
    const raw = await readRaw();
    raw.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath(), stringifyYaml(raw), "utf-8");

    // Rejecting decides what is *readable*, never what is allowed to
    // exist — the row survives and `readHistoryRows` marks it.
    const rows = await readHistoryRows(dir, TASK_ID);
    expect(rows).toHaveLength(2);
    expect(rows.filter(isMalformedHistoryEntry)).toHaveLength(1);
  });

  it("still accepts a row carrying a field this build does not know", async () => {
    await seed(["created"]);
    const raw = await readRaw();
    // `.passthrough()`: a file written by a newer LocTT must stay
    // readable, or an upgrade in one clone makes history unreadable in
    // another.
    raw.push({
      timestamp: "2026-09-01T00:00:00.000Z",
      kind: "created",
      some_future_field: "x",
    });
    await writeFile(historyPath(), stringifyYaml(raw), "utf-8");

    expect(await readHistory(dir, TASK_ID)).toHaveLength(2);
  });
});

describe("mergeHistory keeps entries it cannot key (V2)", () => {
  it("does not collapse two timestamp-less entries into one", () => {
    const local = [{ kind: "created", note: "a" }] as never[];
    const incoming = [{ kind: "created", note: "b" }] as never[];

    // Both key to "\0\0\0" and the second was dropped — the real data
    // loss, happening before any ordering question.
    const merged = mergeHistory(local, incoming);
    expect(merged).toHaveLength(2);
  });

  it("still de-duplicates entries that do have a timestamp", () => {
    const entry = { timestamp: "2026-01-01T00:00:00.000Z", kind: "created" } as never;
    // Guards against "keep everything", which would double every entry
    // on every sync.
    expect(mergeHistory([entry], [entry])).toHaveLength(1);
  });

  it("keeps the keyed entries sorted and appends the unkeyed", () => {
    const b = { timestamp: "2026-02-01T00:00:00.000Z", kind: "created" } as never;
    const a = { timestamp: "2026-01-01T00:00:00.000Z", kind: "created" } as never;
    const orphan = { kind: "body_edited" } as never;

    const merged = mergeHistory([b, orphan], [a]);
    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(b);
    // Appended, not sorted in: there is no key to sort it by, and
    // inventing a position claims when it happened.
    expect(merged[2]).toBe(orphan);
  });
});
