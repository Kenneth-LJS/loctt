import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { postComment } from "../task/comments.js";
import { blockingFindings, checkDataIntegrity } from "./integrity.js";

/**
 * The other half of P-11.
 *
 * Keeping a malformed entry without telling anyone means the bad entry
 * sits there forever and the ordering quietly stops meaning anything.
 * The same scan feeds `doctor` and sync pre-flight.
 *
 * The severity split is the load-bearing part:
 *
 *   unreadable — cannot vouch for the contents. Blocks a publish.
 *   malformed  — kept and merged, data intact. Reported, never blocks.
 *
 * Blocking on a malformed entry would make one hand-edit typo render a
 * tracker unpublishable, which is destruction by another route.
 */

const AUTHOR = "01J0000000000000000000USER";
const TASK_ID = "01J0000000000000000000TASK";
let dir: string;

function commentsPath(): string {
  return join(dir, "tasks", TASK_ID, "_comments.yaml");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-integrity-"));
  await mkdir(join(dir, "tasks", TASK_ID), { recursive: true });
});

afterEach(async () => {
  await chmod(commentsPath(), 0o644).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

async function seed(bodies: string[]): Promise<void> {
  for (const body of bodies) {
    await postComment({ locttDir: dir, taskId: TASK_ID, body, author: AUTHOR });
  }
}

async function insertMalformed(): Promise<void> {
  const raw = parseYaml(await readFile(commentsPath(), "utf-8")) as { comments: unknown[] };
  raw.comments.splice(1, 0, { note: "hand-edited, not a comment" });
  await writeFile(commentsPath(), stringifyYaml(raw), "utf-8");
}

describe("a clean tracker reports nothing", () => {
  it("finds nothing when every thread reads", async () => {
    await seed(["first", "second"]);
    expect(await checkDataIntegrity(dir)).toEqual([]);
  });

  it("finds nothing when a task has no comments at all", async () => {
    // An absent thread is a real state, not a finding — otherwise every
    // fresh task would be reported as damaged.
    expect(await checkDataIntegrity(dir)).toEqual([]);
  });
});

describe("a malformed entry is reported but does not block", () => {
  it("names the file and the entry position", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("malformed");
    expect(findings[0]?.path).toContain("_comments.yaml");
    expect(findings[0]?.message).toContain("entry 2");
  });

  it("says the entry is preserved, so the user is not told to panic", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    const findings = await checkDataIntegrity(dir);
    expect(findings[0]?.message).toMatch(/kept in place/i);
  });

  it("is not blocking", async () => {
    await seed(["first", "third"]);
    await insertMalformed();

    // The rule that matters: a hand-edit typo must not make the tracker
    // unpublishable. The data is intact and merges correctly.
    expect(blockingFindings(await checkDataIntegrity(dir))).toEqual([]);
  });
});

describe("history rows are reported too, not only comments", () => {
  it("reports a row with an unrecognised kind", async () => {
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    const rows = parseYaml(await readFile(historyPath, "utf-8")) as unknown[];
    rows.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath, stringifyYaml(rows), "utf-8");

    // History reporting was added after this file was written and was
    // never covered here: suppressing it entirely left all nine tests
    // green. Found by mutation 2026-08-17.
    const findings = await checkDataIntegrity(dir);
    const history = findings.filter(f => f.path.endsWith("_history.yaml"));
    expect(history).toHaveLength(1);
    expect(history[0]?.severity).toBe("malformed");
    expect(history[0]?.message).toContain("history entry 2");
  });

  it("does not block a publish on one", async () => {
    // Same rule as a malformed comment: the row is kept and merged, so
    // the data is intact and publishing it is safe.
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    const rows = parseYaml(await readFile(historyPath, "utf-8")) as unknown[];
    rows.push({ timestamp: "2026-09-01T00:00:00.000Z", kind: "not_a_real_kind" });
    await writeFile(historyPath, stringifyYaml(rows), "utf-8");

    expect(blockingFindings(await checkDataIntegrity(dir))).toEqual([]);
  });

  it("reports an unreadable history file as blocking", async () => {
    await seed(["first"]);
    const historyPath = join(dir, "tasks", TASK_ID, "_history.yaml");
    await chmod(historyPath, 0o000);

    const findings = await checkDataIntegrity(dir);
    const history = findings.filter(f => f.path.endsWith("_history.yaml"));
    expect(history[0]?.severity).toBe("unreadable");
    expect(blockingFindings(findings)).toHaveLength(1);

    await chmod(historyPath, 0o644);
  });
});

describe("an unreadable file is reported and blocks", () => {
  it("reports the file it could not read", async () => {
    await seed(["first"]);
    await chmod(commentsPath(), 0o000);

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("unreadable");
    expect(findings[0]?.path).toContain("_comments.yaml");
  });

  it("blocks, because a publish would mirror content nobody read", async () => {
    await seed(["first"]);
    await chmod(commentsPath(), 0o000);

    // Publishing here turns one machine's damage into everyone's.
    expect(blockingFindings(await checkDataIntegrity(dir))).toHaveLength(1);
  });

  it("reports a file that will not parse as unreadable too", async () => {
    await writeFile(commentsPath(), "comments: [unclosed\n", "utf-8");

    const findings = await checkDataIntegrity(dir);
    expect(findings[0]?.severity).toBe("unreadable");
    expect(blockingFindings(findings)).toHaveLength(1);
  });
});

describe("the two severities stay distinguishable", () => {
  it("reports both without collapsing them", async () => {
    // One task with a malformed entry, one unreadable.
    await seed(["first", "third"]);
    await insertMalformed();

    const otherTask = "01J000000000000000000TSK2";
    await mkdir(join(dir, "tasks", otherTask), { recursive: true });
    await postComment({ locttDir: dir, taskId: otherTask, body: "x", author: AUTHOR });
    await chmod(join(dir, "tasks", otherTask, "_comments.yaml"), 0o000);

    const findings = await checkDataIntegrity(dir);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.severity).sort()).toEqual(["malformed", "unreadable"]);
    // Only the unreadable one stops a publish.
    expect(blockingFindings(findings)).toHaveLength(1);

    await chmod(join(dir, "tasks", otherTask, "_comments.yaml"), 0o644);
  });
});
