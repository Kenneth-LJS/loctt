import { extractMentions } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { mentionQuery } from "./MentionMenu.tsx";

/**
 * The @mention trigger rule.
 *
 * This is a **contract with core**, not a UI preference. `extractMentions`
 * (`packages/core/src/task/comments.ts`) decides what counts as a mention
 * when a body is read back; the picker decides where to offer to insert
 * one. If the two disagree, the picker inserts `@user:<id>` tokens in
 * positions core will not read as mentions — the user sees a mention,
 * and nothing downstream notifies anybody.
 *
 * So the cases below are core's own rules, asserted from the writing
 * side. `extractMentions` is imported and exercised alongside, which is
 * what makes this a comparison rather than two independent guesses.
 */
describe("mention trigger", () => {
  it("fires at the start of a line and after whitespace", () => {
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("@ali")).toBe("ali");
    expect(mentionQuery("hello @ali")).toBe("ali");
    expect(mentionQuery("hello\n@ali")).toBe("ali");
    expect(mentionQuery("(@ali")).toBe("ali");
  });

  it("does not fire inside an email address", () => {
    /**
     * Core's rule: the `@` must not follow a word character. Without
     * it, typing an email opens a user picker mid-address, and
     * accepting rewrites `bob@example.com` into a mention node.
     */
    expect(mentionQuery("bob@")).toBeNull();
    expect(mentionQuery("bob@example")).toBeNull();
    expect(mentionQuery("write to bob@exa")).toBeNull();

    // The paired check against core itself: core does not read that as
    // a mention either, so picker and reader agree.
    expect(extractMentions("write to bob@example.com")).toEqual([]);
  });

  it("does not fire on a doubled @", () => {
    expect(mentionQuery("@@")).toBeNull();
  });

  it("stops firing once the token ends", () => {
    // A space after the name closes the mention; the menu must not
    // stay open over the following words.
    expect(mentionQuery("@ali is here")).toBeNull();
  });

  it("agrees with core on what a written mention looks like", () => {
    /**
     * The positive half, and the one that makes the negatives mean
     * something: a token inserted at a position the picker fires on
     * *is* read back by core as a mention. A picker that never fired
     * would satisfy every "does not fire" case above.
     */
    expect(mentionQuery("cc @u1")).toBe("u1");
    expect(extractMentions("cc @user:u1 please")).toEqual(["u1"]);
  });

  it("core skips mentions in code spans, so the stored token is not read there", () => {
    // Documented behaviour worth pinning: an id in a code sample is
    // documentation, and notifying someone for it is a false positive
    // the author cannot avoid except by not writing the example.
    expect(extractMentions("`@user:u1`")).toEqual([]);
    expect(extractMentions("@user:u1")).toEqual(["u1"]);
  });
});
