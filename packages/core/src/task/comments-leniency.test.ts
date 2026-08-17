import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { UnreadableFileError } from "../utils/read-state.js";
import {
  CommentError,
  deleteComment,
  editComment,
  isMalformedComment,
  listCommentEntries,
  listComments,
  postComment,
} from "./comments.js";

/**
 * P-11 for comment threads: leniency means keeping, never destroying.
 *
 * Two halves, and the reverted fix had only the first:
 *
 *  - A file LocTT *cannot read* must never be written over. Returning
 *    `[]` and appending to it turned a three-comment thread into one,
 *    reported as success, with no recovery. Reproduced 2026-08-17.
 *  - A file it *can* read holding a malformed entry keeps that entry,
 *    positioned where it was, and writes it back untouched.
 */

const AUTHOR = "01J0000000000000000000USER";
let dir: string;
let taskId: string;

/** Path layout mirrors `getCommentsFilePath`. */
function commentsPath(): string {
  return join(dir, "tasks", taskId, "_comments.yaml");
}

async function seedThread(bodies: string[]): Promise<void> {
  for (const body of bodies) {
    await postComment({ locttDir: dir, taskId, body, author: AUTHOR });
  }
}

async function readRaw(): Promise<{ comments: unknown[] }> {
  return parseYaml(await readFile(commentsPath(), "utf-8")) as { comments: unknown[] };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-comments-p11-"));
  taskId = "01J0000000000000000000TASK";
  await mkdir(join(dir, "tasks", taskId), { recursive: true });
});

afterEach(async () => {
  await chmod(commentsPath(), 0o644).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe("an unreadable thread is never written over", () => {
  it("refuses to post rather than replacing the thread with one comment", async () => {
    await seedThread(["first", "second", "third"]);
    await chmod(commentsPath(), 0o000);

    await expect(
      postComment({ locttDir: dir, taskId, body: "fourth", author: AUTHOR }),
    ).rejects.toThrow(UnreadableFileError);

    // The load-bearing assertion. Before the fix this file held one
    // comment — "fourth" — and the post had reported success.
    await chmod(commentsPath(), 0o644);
    const bodies = (await readRaw()).comments.map(c => (c as { body: string }).body);
    expect(bodies).toEqual(["first", "second", "third"]);
  });

  it("refuses to list rather than reporting an unreadable thread as empty", async () => {
    await seedThread(["first"]);
    await chmod(commentsPath(), 0o000);

    // `[]` here is a factual claim about a file nobody read, and the
    // claim is what callers then act on.
    await expect(listComments(dir, taskId)).rejects.toThrow(UnreadableFileError);
  });

  it("names the file so the user knows what to fix", async () => {
    await seedThread(["first"]);
    await chmod(commentsPath(), 0o000);

    await expect(listComments(dir, taskId)).rejects.toThrow(/_comments\.yaml/);
  });

  it("still reports an absent thread as empty", async () => {
    // Absent is a real state — nobody has commented — and must stay
    // distinguishable from a failure.
    expect(await listComments(dir, taskId)).toEqual([]);
  });

  it("refuses a thread that will not parse rather than discarding it", async () => {
    await writeFile(commentsPath(), "comments: [unclosed\n", "utf-8");

    await expect(
      postComment({ locttDir: dir, taskId, body: "new", author: AUTHOR }),
    ).rejects.toThrow(CommentError);

    // The damaged text is still on disk, available to repair by hand.
    expect(await readFile(commentsPath(), "utf-8")).toContain("unclosed");
  });

  it("refuses a `comments` key that is not a list", async () => {
    await writeFile(commentsPath(), "comments: not-a-list\n", "utf-8");

    await expect(
      postComment({ locttDir: dir, taskId, body: "new", author: AUTHOR }),
    ).rejects.toThrow(/not a list/);
    expect(await readFile(commentsPath(), "utf-8")).toContain("not-a-list");
  });
});

describe("a malformed entry is kept and merged, not dropped", () => {
  /** Seeds a thread whose middle entry has no id, author or body. */
  async function seedWithMalformedMiddle(): Promise<void> {
    await seedThread(["first", "third"]);
    const raw = await readRaw();
    raw.comments.splice(1, 0, { note: "hand-edited, not a comment" });
    await writeFile(commentsPath(), stringifyYaml(raw), "utf-8");
  }

  it("survives a post that appends after it", async () => {
    await seedWithMalformedMiddle();

    await postComment({ locttDir: dir, taskId, body: "fourth", author: AUTHOR });

    const raw = await readRaw();
    expect(raw.comments).toHaveLength(4);
    // Kept, and still between its original neighbours.
    expect(raw.comments[1]).toEqual({ note: "hand-edited, not a comment" });
    const bodies = raw.comments.map(c => (c as { body?: string }).body);
    expect(bodies).toEqual(["first", undefined, "third", "fourth"]);
  });

  it("survives deleting one of its neighbours", async () => {
    await seedWithMalformedMiddle();
    const [first] = await listComments(dir, taskId);
    if (!first) throw new Error("expected a first comment");

    await deleteComment({ locttDir: dir, taskId, commentId: first.id });

    const raw = await readRaw();
    // Deleting a comment must not take an uninterpretable neighbour
    // with it — that is destruction, which P-11 forbids.
    expect(raw.comments).toContainEqual({ note: "hand-edited, not a comment" });
    expect(raw.comments).toHaveLength(2);
  });

  it("survives editing one of its neighbours", async () => {
    await seedWithMalformedMiddle();
    const comments = await listComments(dir, taskId);
    const third = comments[1];
    if (!third) throw new Error("expected a second valid comment");

    await editComment({ locttDir: dir, taskId, commentId: third.id, body: "third, edited" });

    const raw = await readRaw();
    expect(raw.comments).toHaveLength(3);
    expect(raw.comments[1]).toEqual({ note: "hand-edited, not a comment" });
  });

  it("is omitted from listComments, which renders a thread", async () => {
    await seedWithMalformedMiddle();
    const bodies = (await listComments(dir, taskId)).map(c => c.body);
    // Omitted from the *render*, not from the file — the two
    // assertions together are the whole rule.
    expect(bodies).toEqual(["first", "third"]);
  });

  it("is reported by listCommentEntries, which diagnostics read", async () => {
    await seedWithMalformedMiddle();
    const entries = await listCommentEntries(dir, taskId);

    expect(entries).toHaveLength(3);
    const malformed = entries.filter(isMalformedComment);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.index).toBe(1);
    expect(malformed[0]?.raw).toEqual({ note: "hand-edited, not a comment" });
  });

  it("keeps an entry whose timestamp is unusable but is otherwise a comment", async () => {
    await seedThread(["first"]);
    const raw = await readRaw();
    raw.comments.push({
      id: "01J0000000000000000000CMNT",
      author: AUTHOR,
      body: "timestamp is nonsense",
      created_at: "not-a-date",
    });
    await writeFile(commentsPath(), stringifyYaml(raw), "utf-8");

    // A bad timestamp does not make an entry unusable: it has a body
    // and an author, so it renders. P-11 positions it by its
    // neighbours rather than discarding it.
    const bodies = (await listComments(dir, taskId)).map(c => c.body);
    expect(bodies).toEqual(["first", "timestamp is nonsense"]);
  });
});
