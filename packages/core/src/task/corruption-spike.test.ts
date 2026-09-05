import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTaskDir, getTaskFilePath } from "../paths/index.js";
import { readTask, readTaskTolerant, writeTaskTolerant } from "./io.js";

/**
 * Phase-7 corruption-framework SPIKE — one cell, end to end at the core
 * layer: a task with a wrong-typed `due_date`, editing `status`.
 *
 * It exercises the three things the framework hinges on:
 *   - tolerant load: a field-local corruption does not make the whole
 *     task unreadable (north-star principle 5);
 *   - preserve-others: writing another field round-trips the corrupt
 *     value byte-for-byte;
 *   - override-on-direct-write: writing the corrupt field itself repairs
 *     it and clears the corruption.
 *
 * These tests are the artifact the Fable framework proposal reviews; they
 * are not tied to a published case id.
 */

const ID = "01SPIKE0000000000000000001";

let root: string;
let locttDir: string;

async function seedRawTask(frontmatter: string, body = "Body.\n"): Promise<void> {
  const dir = getTaskDir(locttDir, ID);
  await mkdir(dir, { recursive: true });
  await writeFile(getTaskFilePath(locttDir, ID), `---\n${frontmatter}---\n${body}`, "utf-8");
}

const GOOD_IDENTITY =
  `id: ${ID}\n`
  + "key: T-1\n"
  + "title: Spike task\n"
  + "created_at: 2026-01-01T00:00:00Z\n"
  + "updated_at: 2026-01-01T00:00:00Z\n"
  + "status: todo\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-spike-"));
  locttDir = join(root, ".loctt");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("corruption spike: wrong-typed due_date", () => {
  it("strict readTask throws on the corrupt task (the corruption is real)", async () => {
    // due_date must be YYYY-MM-DD or ISO; a bare number is wrong-typed.
    await seedRawTask(`${GOOD_IDENTITY}due_date: 42\n`);
    await expect(readTask(locttDir, ID)).rejects.toThrow();
  });

  it("tolerant read does not throw, keeps the raw value, and reports the corruption", async () => {
    await seedRawTask(`${GOOD_IDENTITY}due_date: 42\n`);
    const task = await readTaskTolerant(locttDir, ID);

    // The rest of the task loaded.
    expect(task.frontmatter.status).toBe("todo");
    expect(task.frontmatter.title).toBe("Spike task");
    // The corrupt field is kept under its raw value, not dropped.
    expect(task.frontmatter.due_date as unknown).toBe(42);
    // ...and reported so a surface can degrade + offer repair.
    expect(task.corruptions).toHaveLength(1);
    expect(task.corruptions?.[0]?.field).toBe("due_date");
    expect(task.corruptions?.[0]?.raw).toBe(42);
    expect(task.corruptions?.[0]?.error).toMatch(/YYYY-MM-DD|ISO|string/i);
  });

  it("preserve-others: editing status round-trips the corrupt due_date verbatim", async () => {
    await seedRawTask(`${GOOD_IDENTITY}due_date: 42\n`);
    const task = await readTaskTolerant(locttDir, ID);

    // Edit a different field, as bulkSetFields would.
    const edited = {
      ...task,
      frontmatter: { ...task.frontmatter, status: "in_progress" },
    };
    await writeTaskTolerant(locttDir, ID, edited);

    // On reload: status changed, the corrupt due_date is untouched.
    const after = await readTaskTolerant(locttDir, ID);
    expect(after.frontmatter.status).toBe("in_progress");
    expect(after.frontmatter.due_date as unknown).toBe(42);
    expect(after.corruptions).toHaveLength(1);

    // And the raw bytes of the corrupt field survived: the file still
    // carries `due_date: 42`, not a quoted string or a dropped key.
    const onDisk = await readFile(getTaskFilePath(locttDir, ID), "utf-8");
    expect(onDisk).toMatch(/due_date: 42\b/);
  });

  it("override-on-direct-write: setting a valid due_date repairs it and clears the corruption", async () => {
    await seedRawTask(`${GOOD_IDENTITY}due_date: 42\n`);
    const task = await readTaskTolerant(locttDir, ID);

    const repaired = {
      ...task,
      frontmatter: { ...task.frontmatter, due_date: "2026-03-01" },
    };
    await writeTaskTolerant(locttDir, ID, repaired);

    // Now even a STRICT read succeeds — the corruption is gone.
    const after = await readTask(locttDir, ID);
    expect(after.frontmatter.due_date).toBe("2026-03-01");
    const tolerant = await readTaskTolerant(locttDir, ID);
    expect(tolerant.corruptions).toHaveLength(0);
  });

  it("a wrong-typed value in a non-degradable field is still object-fatal", async () => {
    // `title` is identity-bearing; a wrong-typed title has no coherent
    // object to degrade around, so the tolerant read must still throw.
    await seedRawTask(
      `id: ${ID}\nkey: T-1\ntitle: []\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n`,
    );
    await expect(readTaskTolerant(locttDir, ID)).rejects.toThrow();
  });

  it("a corruption OUTSIDE the degradable set is object-fatal even when a degradable one is also present", async () => {
    // due_date is degradable; priority is NOT. The guard must refuse to
    // degrade the whole task just because one of its faults happens to be
    // degradable — a mixed corruption fails closed. This isolates the
    // "every issue must be degradable" guard from the reparse safety net:
    // priority is optional, so lifting it out WOULD reparse — the only
    // thing stopping a silent half-degrade is the guard itself.
    await seedRawTask(`${GOOD_IDENTITY}due_date: 42\npriority: [oops]\n`);
    await expect(readTaskTolerant(locttDir, ID)).rejects.toThrow();
  });

  it("a clean task loads with no corruptions (the tolerant path costs the common case nothing)", async () => {
    await seedRawTask(`${GOOD_IDENTITY}due_date: 2026-03-01\n`);
    const task = await readTaskTolerant(locttDir, ID);
    expect(task.frontmatter.due_date).toBe("2026-03-01");
    expect(task.corruptions).toHaveLength(0);
  });
});
