import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTaskDir, getTaskFilePath } from "../paths/index.js";
import { bulkArchive, bulkSetFields } from "./bulk.js";
import { CorruptWriteError, readTask, writeTask } from "./io.js";
import { archiveTask, unarchiveTask } from "./lifecycle.js";
import { loadAllTasks } from "./load-all.js";
import { lookupByKey, lookupTask, UnreadableTaskError } from "./lookup.js";
import { setField, unsetField } from "./update.js";

/**
 * Phase-7 corruption AUDIT (proposal § 11), executed as a table-driven
 * test. `seedCorruptTask` writes a task.md by hand — the way the real
 * world reaches a corrupt state (K21: hand edit) — then each row runs an
 * operation over it and asserts the § 11.3 verdict: **handled** (the op
 * completes and preserves untouched raw values, or refuses with a corrupt
 * -field error where § 3.2 says it must) or **defect**.
 *
 * The matrix this test enforces is documented in
 * `docs/dev/corruption-audit.md`; keep the two in sync.
 */

const ID = "01AUDIT0000000000000000001";
const ID2 = "01AUDIT0000000000000000002";

let root: string;
let locttDir: string;

const IDENTITY =
  `id: ${ID}\n`
  + "key: T-1\n"
  + "title: Audit task\n"
  + "created_at: 2026-01-01T00:00:00Z\n"
  + "updated_at: 2026-01-01T00:00:00Z\n"
  + "status: todo\n";

/**
 * Column → the raw frontmatter line(s) that make that corruption.
 * Each seeds a field-local corruption unless noted object-fatal.
 */
const COLUMN_LINES: Record<string, string> = {
  "wrong_type:due_date": "due_date: 42\n",
  "wrong_type:priority": "priority: [oops]\n",
  "wrong_type:archived": "archived: yes-please\n",
  "wrong_type:labels": "labels: urgent\n",
  "wrong_type:relationships": "relationships: not-a-list\n",
  "wrong_type:fields": "fields: 3\n",
  "wrong_type:board_rank": "board_rank: [1]\n",
  "wrong_type:key_history": "key_history: T-old\n",
  "missing_required:title": "", // seeded via IDENTITY_NO_TITLE below
  "unrecognised:jira_id": "jira_id: ABC-1\n",
};

const IDENTITY_NO_TITLE =
  `id: ${ID}\n`
  + "key: T-1\n"
  + "created_at: 2026-01-01T00:00:00Z\n"
  + "updated_at: 2026-01-01T00:00:00Z\n"
  + "status: todo\n";

async function seedCorruptTask(column: string, id = ID): Promise<void> {
  const dir = getTaskDir(locttDir, id);
  await mkdir(dir, { recursive: true });
  let fm: string;
  if (column === "missing_required:title") {
    fm = IDENTITY_NO_TITLE;
  } else if (column === "object_fatal:no_id") {
    fm = "key: T-1\ntitle: X\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n";
  } else if (column === "object_fatal:yaml") {
    fm = "id: " + id + "\nkey: T-1\ntitle: \"unterminated\n";
  } else {
    fm = (id === ID ? IDENTITY : IDENTITY.replace(ID, id).replace("T-1", "T-2"))
      + (COLUMN_LINES[column] ?? "");
  }
  await writeFile(getTaskFilePath(locttDir, id), `---\n${fm}---\nBody.\n`, "utf-8");
}

/** Reads the on-disk task.md raw text. */
async function onDisk(id = ID): Promise<string> {
  return readFile(getTaskFilePath(locttDir, id), "utf-8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-audit-"));
  locttDir = join(root, ".loctt");
  await mkdir(join(locttDir, "tasks"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---- READS -------------------------------------------------------------

describe("audit: reads open a field-local corrupt task (never unreadable)", () => {
  const fieldLocalColumns = [
    "wrong_type:due_date",
    "wrong_type:priority",
    "wrong_type:labels",
    "wrong_type:relationships",
    "wrong_type:fields",
    "wrong_type:board_rank",
    "wrong_type:key_history",
    "missing_required:title",
    "unrecognised:jira_id",
  ];

  for (const col of fieldLocalColumns) {
    it(`lookupById HANDLED: opens ${col} with health, not UnreadableTaskError`, async () => {
      await seedCorruptTask(col);
      const task = await lookupTask(locttDir, ID);
      expect(task.health).toBeDefined();
      expect((task.health ?? []).length).toBeGreaterThan(0);
    });

    it(`lookupByKey HANDLED: ${col} resolves by key (index folds a corrupt task)`, async () => {
      await seedCorruptTask(col);
      const task = await lookupByKey(locttDir, "T-1");
      expect(task.frontmatter.id).toBe(ID);
    });

    it(`loadAllTasks HANDLED: ${col} appears in the list with health`, async () => {
      await seedCorruptTask(col);
      const all = await loadAllTasks(locttDir);
      expect(all).toHaveLength(1);
      expect((all[0]?.health ?? []).length).toBeGreaterThan(0);
    });
  }

  // @verifies DEG-1
  it("object-fatal (no id) stays UnreadableTaskError (blocks nothing else)", async () => {
    await seedCorruptTask("object_fatal:no_id");
    await expect(lookupById(locttDir, ID)).rejects.toBeInstanceOf(UnreadableTaskError);
  });

  // @verifies DEG-1
  it("object-fatal (YAML syntax) stays UnreadableTaskError", async () => {
    await seedCorruptTask("object_fatal:yaml");
    await expect(lookupById(locttDir, ID)).rejects.toBeInstanceOf(UnreadableTaskError);
  });
});

async function lookupById(dir: string, id: string) {
  // Small shim so the object-fatal assertions read naturally.
  return lookupTask(dir, id);
}

// ---- SINGLE-TASK WRITES: preserve-others + override --------------------

describe("audit: setField on another field preserves the corrupt one", () => {
  for (const col of ["wrong_type:due_date", "unrecognised:jira_id", "wrong_type:labels"]) {
    // @verifies DEG-3
    it(`HANDLED: set status, ${col} raw survives byte-for-byte`, async () => {
      await seedCorruptTask(col);
      await setField({ locttDir, taskId: ID, field: "status", value: "in_progress" });
      const after = await readTask(locttDir, ID);
      expect(after.frontmatter.status).toBe("in_progress");
      // The corrupt/unrecognised field is still present in health...
      const stillThere = (after.health ?? []).some(h =>
        col.endsWith("due_date") ? h.field === "due_date"
          : col.endsWith("jira_id") ? h.field === "jira_id"
            : h.field === "labels");
      expect(stillThere).toBe(true);
      // ...and its raw value survived on disk.
      const disk = await onDisk();
      if (col.endsWith("due_date")) expect(disk).toMatch(/due_date: 42\b/);
      if (col.endsWith("jira_id")) expect(disk).toContain("jira_id: ABC-1");
      if (col.endsWith("labels")) expect(disk).toContain("labels: urgent");
    });
  }
});

describe("audit: set-over repairs the corrupt field (override-on-direct-write)", () => {
  // @verifies DEG-4
  it("HANDLED: setting a valid due_date clears the wrong_type finding", async () => {
    await seedCorruptTask("wrong_type:due_date");
    await setField({ locttDir, taskId: ID, field: "due_date", value: "2026-03-01" });
    const after = await readTask(locttDir, ID);
    expect(after.frontmatter.due_date).toBe("2026-03-01");
    expect((after.health ?? []).some(h => h.field === "due_date")).toBe(false);
  });
});

describe("audit: unset removes the corrupt/unrecognised field", () => {
  // @verifies DEG-4
  it("HANDLED: unset an unrecognised top-level key removes it", async () => {
    await seedCorruptTask("unrecognised:jira_id");
    await unsetField(locttDir, ID, "jira_id");
    const after = await readTask(locttDir, ID);
    expect((after.health ?? []).some(h => h.field === "jira_id")).toBe(false);
    expect(await onDisk()).not.toContain("jira_id");
  });

  // @verifies DEG-4
  it("HANDLED: unset a wrong-typed known field removes it", async () => {
    await seedCorruptTask("wrong_type:due_date");
    await unsetField(locttDir, ID, "due_date");
    const after = await readTask(locttDir, ID);
    expect((after.health ?? []).some(h => h.field === "due_date")).toBe(false);
    expect(await onDisk()).not.toMatch(/due_date:/);
  });
});

// ---- The derived operation rule (§ 3.2) --------------------------------

describe("audit: an op that must READ a structurally-broken field refuses", () => {
  // @verifies DEG-6
  it("HANDLED: linkTask refuses over a wrong-typed relationships (source)", async () => {
    await seedCorruptTask("wrong_type:relationships");
    await seedCorruptTask("wrong_type:due_date", ID2); // a valid-enough target
    const { linkTask } = await import("./relationships.js");
    await expect(
      linkTask({ locttDir, taskId: ID, type: "blocks", target: ID2 }),
    ).rejects.toThrow(/relationships/);
  });

  // @verifies DEG-6
  it("HANDLED: unlinkTask refuses over a wrong-typed relationships (source)", async () => {
    await seedCorruptTask("wrong_type:relationships");
    const { unlinkTask } = await import("./relationships.js");
    await expect(
      unlinkTask({ locttDir, taskId: ID, type: "blocks", target: ID2 }),
    ).rejects.toThrow(/relationships/);
  });
});

describe("audit: archive/unarchive over a wrong-typed archived (idempotency read)", () => {
  // @verifies DEG-6
  it("HANDLED: archive proceeds and repairs a wrong-typed archived", async () => {
    await seedCorruptTask("wrong_type:archived");
    await archiveTask(locttDir, ID);
    const after = await readTask(locttDir, ID);
    expect(after.frontmatter.archived).toBe(true);
    // The corrupt archived value was the write's own target — repaired.
    expect((after.health ?? []).some(h => h.field === "archived")).toBe(false);
  });

  // @verifies DEG-6
  it("HANDLED: unarchive over a wrong-typed archived is a correct no-op-or-repair", async () => {
    // A corrupt `archived` reads as "not archived", so unarchive either
    // no-ops (already unarchived from the user's view) or writes archived
    // =false; either way it must NOT persist the corrupt value.
    await seedCorruptTask("wrong_type:archived");
    await unarchiveTask(locttDir, ID);
    const after = await readTask(locttDir, ID);
    expect((after.health ?? []).some(h => h.field === "archived")).toBe(false);
    expect(await onDisk()).not.toContain("archived: yes-please");
  });
});

// ---- BULK --------------------------------------------------------------

describe("audit: bulk writes preserve untouched corrupt fields", () => {
  it("HANDLED: bulkSetFields(status) on a task with a bad due_date preserves it", async () => {
    await seedCorruptTask("wrong_type:due_date");
    const res = await bulkSetFields({
      locttDir,
      taskRefs: [ID],
      changes: [{ field: "status", value: "in_progress" }],
    });
    expect(res.succeeded).toContain(ID);
    expect(await onDisk()).toMatch(/due_date: 42\b/);
  });

  it("HANDLED: bulkArchive on a task with an unrecognised key preserves it", async () => {
    await seedCorruptTask("unrecognised:jira_id");
    const res = await bulkArchive({ locttDir, taskRefs: [ID], archive: true });
    expect(res.succeeded).toContain(ID);
    expect(await onDisk()).toContain("jira_id: ABC-1");
  });
});

// ---- WRITE GUARD -------------------------------------------------------

describe("audit: the write guard forbids introducing corruption", () => {
  // @verifies DEG-5
  it("HANDLED (rule 1): a write that introduces a new finding is refused", async () => {
    await seedCorruptTask("wrong_type:due_date");
    const t = await readTask(locttDir, ID);
    // Author a write that puts a brand-new wrong-typed value on a field
    // that was healthy before (start_date), declaring nothing corrupt.
    const bad = {
      ...t,
      frontmatter: { ...t.frontmatter, start_date: 99 as unknown as string },
    };
    await expect(
      writeTask(locttDir, ID, bad, new Set(["start_date", "updated_at"])),
    ).rejects.toBeInstanceOf(CorruptWriteError);
    // Nothing was written: the original bytes stand.
    expect(await onDisk()).toMatch(/due_date: 42\b/);
    expect(await onDisk()).not.toMatch(/start_date: 99\b/);
  });

  // @verifies DEG-5
  it("HANDLED (rule 2): a write that DROPS an untouched corrupt field is refused", async () => {
    // This is the review's B1 defect: a merge-style writer that defaults a
    // corrupt structure away (`?? {}`) and discards its raw value while
    // touching only some other field. The guard must refuse — the corrupt
    // value the write did not touch may not silently vanish.
    await seedCorruptTask("wrong_type:due_date");
    const t = await readTask(locttDir, ID);
    // Simulate the loss: drop the corrupt due_date from health AND from
    // the (already-healthy) frontmatter, and claim to touch only status.
    const dropped = {
      frontmatter: { ...t.frontmatter, status: "done" },
      body: t.body,
      health: [], // the writer "forgot" the corruption
    };
    await expect(
      writeTask(locttDir, ID, dropped, new Set(["status", "updated_at"])),
    ).rejects.toBeInstanceOf(CorruptWriteError);
    // The corrupt value survives on disk — nothing was dropped.
    expect(await onDisk()).toMatch(/due_date: 42\b/);
  });

  // @verifies DEG-5
  it("HANDLED (rule 2 exemption): a whole-record write (touched='*') may author freely", async () => {
    await seedCorruptTask("wrong_type:due_date");
    const t = await readTask(locttDir, ID);
    // A restore/create-style write owns the whole record; passing the
    // default ALL_FIELDS_TOUCHED lets it drop the corrupt field on purpose
    // (here by carrying health forward, the value is preserved anyway).
    await expect(
      writeTask(locttDir, ID, t),
    ).resolves.toBeUndefined();
  });
});
