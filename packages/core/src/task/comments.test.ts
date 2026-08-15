import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { getCurrentUserPath, resolveLocttDir } from "../paths/index.js";
import { writeCurrentUserId } from "../users/current.js";
import {
  CommentError,
  deleteComment,
  editComment,
  extractMentions,
  formatCommentEditors,
  listComments,
  postComment,
} from "./comments.js";
import { readHistory } from "./history.js";

let root: string;
let locttDir: string;
const taskId = "task_id_1";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-comments-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  await writeCurrentUserId(locttDir, "u_alice");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("extractMentions", () => {
  it("captures the id from the documented @user:<id> form", () => {
    // The old pattern had no colon, so `@user:01J…` captured the
    // literal token `user` — every mention in a tracker collapsed to
    // the same meaningless value, then stored as if it were a user id.
    expect(extractMentions("cc @user:u_alice")).toEqual(["u_alice"]);
  });

  it("returns ids in document order, deduped", () => {
    expect(extractMentions("hi @user:alice and @user:bob and @user:alice again"))
      .toEqual(["alice", "bob"]);
  });

  it("uses the resolver to map ids to canonical user ids", () => {
    const resolve = (t: string) => ({ alice: "u_alice", bob: "u_bob" }[t]);
    expect(extractMentions("ping @user:alice and @user:ghost", resolve)).toEqual(["u_alice"]);
  });

  it("returns empty list when no mentions", () => {
    expect(extractMentions("nothing here")).toEqual([]);
  });

  it("ignores a bare @token without the user: prefix", () => {
    // `@alice` is not the documented syntax. Accepting it is what let
    // an email address register as a mention.
    expect(extractMentions("hi @alice")).toEqual([]);
  });

  it("does not fire inside an email address", () => {
    // Previously yielded `example.com` as a mention token.
    expect(extractMentions("mail bob@example.com about it")).toEqual([]);
    expect(extractMentions("bob@user:alice")).toEqual([]);
  });

  it("ignores mentions inside an inline code span", () => {
    // An id in a code sample is documentation. Notifying someone for
    // it is a false positive the author cannot avoid except by not
    // writing the example.
    expect(extractMentions("write `@user:alice` to mention")).toEqual([]);
  });

  it("ignores mentions inside a fenced block", () => {
    expect(extractMentions("```\n@user:alice\n```")).toEqual([]);
  });

  it("still catches a real mention alongside a code sample", () => {
    expect(extractMentions("use `@user:bob` — and really, @user:alice"))
      .toEqual(["alice"]);
  });

  it("catches a mention at the very start of the body", () => {
    // The lookbehind must not reject a leading @.
    expect(extractMentions("@user:alice please look")).toEqual(["alice"]);
  });

  it("stops the id at punctuation", () => {
    expect(extractMentions("thanks @user:alice!")).toEqual(["alice"]);
    expect(extractMentions("(@user:alice)")).toEqual(["alice"]);
  });
});

describe("comments lifecycle", () => {
  it("postComment writes a comment with id, author, created_at", async () => {
    const c = await postComment({ locttDir, taskId, body: "first comment" });
    expect(c.id).toBeTruthy();
    expect(c.author).toBe("u_alice");
    expect(c.body).toBe("first comment");
    expect(c.created_at).toBeTruthy();
    expect((await listComments(locttDir, taskId))[0]?.id).toBe(c.id);
  });

  it("postComment captures mentions when a resolver is supplied", async () => {
    const c = await postComment({
      locttDir, taskId, body: "ping @user:bob",
      mentionResolver: t => ({ bob: "u_bob" }[t]),
    });
    expect(c.mentions).toEqual(["u_bob"]);
  });

  it("postComment rejects empty body", async () => {
    await expect(postComment({ locttDir, taskId, body: "" })).rejects.toThrow(CommentError);
    await expect(postComment({ locttDir, taskId, body: "   " })).rejects.toThrow(CommentError);
  });

  it("editComment marks edited and bumps updated_at", async () => {
    const c = await postComment({ locttDir, taskId, body: "v1" });
    const edited = await editComment({ locttDir, taskId, commentId: c.id, body: "v2" });
    expect(edited.body).toBe("v2");
    expect(edited.edited).toBe(true);
    expect(edited.updated_at).toBeTruthy();
  });

  it("editComment recomputes mentions on edit", async () => {
    const c = await postComment({
      locttDir, taskId, body: "@user:alice",
      mentionResolver: t => ({ alice: "u_alice" }[t]),
    });
    expect(c.mentions).toEqual(["u_alice"]);
    const edited = await editComment({
      locttDir, taskId, commentId: c.id, body: "no mention now",
      mentionResolver: t => ({ alice: "u_alice" }[t]),
    });
    expect(edited.mentions).toBeUndefined();
  });

  it("editComment rejects unknown id", async () => {
    await expect(
      editComment({ locttDir, taskId, commentId: "nope", body: "x" }),
    ).rejects.toThrow(CommentError);
  });

  it("deleteComment removes the entry", async () => {
    const c = await postComment({ locttDir, taskId, body: "x" });
    await deleteComment({ locttDir, taskId, commentId: c.id });
    expect(await listComments(locttDir, taskId)).toEqual([]);
  });

  it("deleteComment rejects unknown id", async () => {
    await expect(
      deleteComment({ locttDir, taskId, commentId: "nope" }),
    ).rejects.toThrow(CommentError);
  });

  it("listComments returns [] when file is missing", async () => {
    expect(await listComments(locttDir, "absent_task")).toEqual([]);
  });

  it("comments preserve append order", async () => {
    const a = await postComment({ locttDir, taskId, body: "a" });
    const b = await postComment({ locttDir, taskId, body: "b" });
    const c = await postComment({ locttDir, taskId, body: "c" });
    const list = await listComments(locttDir, taskId);
    expect(list.map(x => x.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("comment attribution", () => {
  // Anyone may edit anyone's comment — that's intended. The point of
  // logging it is that an unexpected change stays traceable.
  describe("editors list", () => {
    it("records a cross-user edit without blocking it", async () => {
      const posted = await postComment({ locttDir, taskId, body: "alice's comment" });
      await writeCurrentUserId(locttDir, "u_bob");
      const edited = await editComment({
        locttDir, taskId, commentId: posted.id, body: "bob's edit",
      });
      // Original author is preserved; bob is recorded as an editor.
      expect(edited.author).toBe("u_alice");
      expect(edited.editors).toEqual(["u_bob"]);
      expect(edited.edited).toBe(true);
    });

    it("omits editors when the author edits their own comment", async () => {
      const posted = await postComment({ locttDir, taskId, body: "mine" });
      const edited = await editComment({
        locttDir, taskId, commentId: posted.id, body: "mine, revised",
      });
      expect(edited.edited).toBe(true);
      expect(edited.editors).toBeUndefined();
    });

    it("dedupes repeat editors and keeps first-edit order", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await writeCurrentUserId(locttDir, "u_bob");
      await editComment({ locttDir, taskId, commentId: posted.id, body: "v2" });
      await writeCurrentUserId(locttDir, "u_carol");
      await editComment({ locttDir, taskId, commentId: posted.id, body: "v3" });
      await writeCurrentUserId(locttDir, "u_bob");
      const final = await editComment({
        locttDir, taskId, commentId: posted.id, body: "v4",
      });
      expect(final.editors).toEqual(["u_bob", "u_carol"]);
    });

    it("survives the YAML round trip", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await writeCurrentUserId(locttDir, "u_bob");
      await editComment({ locttDir, taskId, commentId: posted.id, body: "v2" });
      const [reread] = await listComments(locttDir, taskId);
      expect(reread?.editors).toEqual(["u_bob"]);
    });

    it("honours an explicit actor override", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      const edited = await editComment({
        locttDir, taskId, commentId: posted.id, body: "v2", actor: "u_script",
      });
      expect(edited.editors).toEqual(["u_script"]);
    });
  });

  describe("history entries", () => {
    it("logs comment_added with the author", async () => {
      const posted = await postComment({ locttDir, taskId, body: "hello" });
      const entries = await readHistory(locttDir, taskId);
      const added = entries.filter(e => e.kind === "comment_added");
      expect(added).toHaveLength(1);
      expect(added[0]?.actor).toBe("u_alice");
      expect(added[0]?.meta?.comment_id).toBe(posted.id);
    });

    // The traceability case: bob changed alice's comment, and the log
    // records both parties.
    it("logs comment_edited with the actor and the original author", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await writeCurrentUserId(locttDir, "u_bob");
      await editComment({ locttDir, taskId, commentId: posted.id, body: "v2" });
      const entries = await readHistory(locttDir, taskId);
      const edit = entries.find(e => e.kind === "comment_edited");
      expect(edit?.actor).toBe("u_bob");
      expect(edit?.meta?.author).toBe("u_alice");
    });

    it("logs comment_deleted with the actor and the original author", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await writeCurrentUserId(locttDir, "u_bob");
      await deleteComment({ locttDir, taskId, commentId: posted.id });
      const entries = await readHistory(locttDir, taskId);
      const del = entries.find(e => e.kind === "comment_deleted");
      expect(del?.actor).toBe("u_bob");
      expect(del?.meta?.author).toBe("u_alice");
    });

    // Was "captures no comment body — activity only, matching
    // body_edited", asserting the absence this now records. M3 reverses
    // that: an entry that names an event without its content cannot
    // reconstruct anything, and for a deletion the words are otherwise
    // gone from the tracker entirely.
    it("captures the comment text on add, edit and delete", async () => {
      const posted = await postComment({ locttDir, taskId, body: "first text" });
      await editComment({ locttDir, taskId, commentId: posted.id, body: "second text" });
      await deleteComment({ locttDir, taskId, commentId: posted.id });

      const entries = await readHistory(locttDir, taskId);
      const added = entries.find(e => e.kind === "comment_added");
      const edited = entries.find(e => e.kind === "comment_edited");
      const deleted = entries.find(e => e.kind === "comment_deleted");

      expect(added?.after).toBe("first text");
      // An edit records both sides, so the prior wording survives.
      expect(edited?.before).toBe("first text");
      expect(edited?.after).toBe("second text");
      // A delete is destructive — `before` is the only remaining copy.
      expect(deleted?.before).toBe("second text");
      expect(deleted?.after).toBeUndefined();
    });
  });

  describe("headless callers", () => {
    // postComment throws without a current user. Edit/delete must not:
    // that would break scripts and migrations that work today.
    it("edits without a current user, leaving the entry unattributed", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await rm(getCurrentUserPath(locttDir), { force: true });
      const edited = await editComment({
        locttDir, taskId, commentId: posted.id, body: "v2",
      });
      expect(edited.edited).toBe(true);
      expect(edited.editors).toBeUndefined();
    });

    it("deletes without a current user", async () => {
      const posted = await postComment({ locttDir, taskId, body: "v1" });
      await rm(getCurrentUserPath(locttDir), { force: true });
      await expect(
        deleteComment({ locttDir, taskId, commentId: posted.id }),
      ).resolves.toBeUndefined();
      expect(await listComments(locttDir, taskId)).toEqual([]);
    });
  });
});

describe("formatCommentEditors", () => {
  it("returns undefined for a comment that was never edited", () => {
    expect(formatCommentEditors({})).toBeUndefined();
  });

  it("returns a bare Edited for a self-edit", () => {
    expect(formatCommentEditors({ edited: true })).toBe("Edited");
  });

  it.each([
    [["u_bob"], "Edited by Bob"],
    [["u_bob", "u_carol"], "Edited by Bob and Carol"],
    [["u_bob", "u_carol", "u_dan"], "Edited by Bob, Carol, and Dan"],
  ])("formats %j as %s", (editors, expected) => {
    const names: Record<string, string> = {
      u_bob: "Bob", u_carol: "Carol", u_dan: "Dan",
    };
    expect(formatCommentEditors({ edited: true, editors }, id => names[id])).toBe(expected);
  });

  it("falls back to the raw id when a user can't be resolved", () => {
    // A deleted user is more honest as an id than silently dropped.
    expect(formatCommentEditors({ edited: true, editors: ["u_ghost"] }, () => undefined))
      .toBe("Edited by u_ghost");
  });
});
