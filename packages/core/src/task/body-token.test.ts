import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/index.js";
import { createTask } from "./create.js";
import { appendTaskBody, bodyToken, readTask, StaleBodyWriteError, writeTaskBody } from "./io.js";

/**
 * @verifies CMT-C3
 *
 * `withStateLock` serialises one call's read-modify-write; it cannot see
 * that the caller's buffer is stale. Two agents that both read a task
 * and both write it therefore both succeed, and the second silently
 * discards the first's paragraphs — the P1 violation named in
 * ui-test-cases/README.md.
 *
 * The token is optional: omitting it keeps the old last-write-wins
 * behaviour, so existing callers are unaffected.
 */
describe("body writes can be guarded by a concurrency token", () => {
  let root: string;
  let locttDir: string;
  let taskId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-body-token-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    const state = await loadState(locttDir);
    const task = await createTask({
      locttDir, state, options: { project: Object.keys(state.keys)[0] ?? "", title: "subject" },
    });
    await saveState(locttDir, state);
    taskId = task.frontmatter.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts a write whose token still matches", async () => {
    const token = await bodyToken(locttDir, taskId);
    await writeTaskBody(locttDir, taskId, "first draft", { expectedToken: token });
    expect((await readTask(locttDir, taskId)).body).toContain("first draft");
  });

  it("refuses a write whose token is stale, and keeps the stored body", async () => {
    // Both agents read, capturing the same token.
    const tokenA = await bodyToken(locttDir, taskId);
    const tokenB = tokenA;

    await writeTaskBody(locttDir, taskId, "A's paragraphs", { expectedToken: tokenA });

    // B's buffer predates A's write. Last-write-wins would discard A's
    // work with nothing said.
    await expect(
      writeTaskBody(locttDir, taskId, "B's paragraphs", { expectedToken: tokenB }),
    ).rejects.toThrow(/changed since|stale|conflict/i);

    expect((await readTask(locttDir, taskId)).body).toContain("A's paragraphs");
  });

  it("says plainly that nothing was written", async () => {
    const stale = await bodyToken(locttDir, taskId);
    await writeTaskBody(locttDir, taskId, "winner");

    let message = "";
    try {
      await writeTaskBody(locttDir, taskId, "loser", { expectedToken: stale });
    } catch (err) {
      message = (err as Error).message;
    }
    // The user has to know their text did not land, or they close the
    // tab believing it did.
    expect(message).toMatch(/not (been )?(saved|written)/i);
  });

  it("still overwrites when no token is supplied", async () => {
    // Existing callers pass nothing and must keep working.
    await writeTaskBody(locttDir, taskId, "one");
    await writeTaskBody(locttDir, taskId, "two");
    expect((await readTask(locttDir, taskId)).body).toContain("two");
  });

  it("issues a new token after each write", async () => {
    const before = await bodyToken(locttDir, taskId);
    await writeTaskBody(locttDir, taskId, "changed");
    expect(await bodyToken(locttDir, taskId)).not.toBe(before);
  });
});

/**
 * K10. `appendTaskBody` took no options at all until the CLI and MCP
 * needed the guard — the token was enforced on replace and silently
 * ignored on append, which is the more dangerous half: an append reads
 * the existing text in order to add to it, so a concurrent edit is
 * incorporated-then-overwritten rather than merely replaced.
 */
describe("appendTaskBody honours the precondition", () => {
  let root: string;
  let locttDir: string;
  let taskId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-append-token-"));
    await initLoctt(root, { docs: false });
    locttDir = resolveLocttDir(root);
    const state = await loadState(locttDir);
    const task = await createTask({
      locttDir, state, options: { project: Object.keys(state.keys)[0] ?? "", title: "subject" },
    });
    await saveState(locttDir, state);
    taskId = task.frontmatter.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a stale append and leaves the body untouched", async () => {
    await writeTaskBody(locttDir, taskId, "original");
    const stale = await bodyToken(locttDir, taskId);
    await writeTaskBody(locttDir, taskId, "theirs");

    await expect(
      appendTaskBody(locttDir, taskId, "mine", { expectedToken: stale }),
    ).rejects.toThrow(StaleBodyWriteError);

    const after = await readTask(locttDir, taskId);
    expect(after.body).toContain("theirs");
    expect(after.body).not.toContain("mine");
  });

  it("accepts an append carrying the current token", async () => {
    await writeTaskBody(locttDir, taskId, "original");
    await appendTaskBody(locttDir, taskId, "added", {
      expectedToken: await bodyToken(locttDir, taskId),
    });
    const after = await readTask(locttDir, taskId);
    expect(after.body).toContain("original");
    expect(after.body).toContain("added");
  });
});
