// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MentionTarget } from "./renderMarkdown.tsx";
import { isSafeHref, renderCommentBody } from "./renderMarkdown.tsx";

/**
 * Comment body rendering: markdown, mention chips, and the injection
 * surface.
 *
 * **These assert what the DOM contains**, not that "nothing bad
 * happened". CMT-22's whole risk is that a body renders *and looks
 * fine* while having smuggled a node in — a test asserting "the page
 * still works" cannot see that, and would pass on a live `<script>`.
 * So every security assertion here names a tag and asks the document
 * whether it exists.
 */

afterEach(cleanup);

const USERS: Record<string, MentionTarget> = {
  u_ana: { id: "u_ana", name: "Ana Lopez", archived: false },
  u_bo: { id: "u_bo", name: "Bo Reed", archived: false },
  u_old: { id: "u_old", name: "Sam Gone", archived: true },
};

const resolveMention = (id: string): MentionTarget | undefined => USERS[id];

function draw(markdown: string): void {
  render(renderCommentBody(markdown, { resolveMention }));
}

describe("markdown rendering", () => {
  /** @verifies CMT-3 */
  it("renders bold, italics, inline code, fenced code, links and lists as formatted output", () => {
    const { container } = render(
      renderCommentBody(
        [
          "**bold text** and *italic text* and `inline code`",
          "",
          "```js",
          "const x = 1;",
          "```",
          "",
          "- first item",
          "- second item",
          "",
          "[a link](https://example.com/docs)",
        ].join("\n"),
        { resolveMention },
      ),
    );

    // Each is asserted as the *element* it should have become, not as
    // text that happens to appear: "**bold**" reaching the page
    // unparsed would satisfy a text-only assertion.
    expect(container.querySelector("strong")?.textContent).toBe("bold text");
    expect(container.querySelector("em")?.textContent).toBe("italic text");
    expect(screen.getByTestId("comment-code").textContent).toBe("inline code");
    expect(screen.getByTestId("comment-code-block").textContent).toBe("const x = 1;");

    const items = [...container.querySelectorAll("li")].map(li => li.textContent);
    expect(items).toEqual(["first item", "second item"]);

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.textContent).toBe("a link");

    // And the raw markers are gone — the counterpart to the positives
    // above, which would all still hold if the source were *also*
    // shown somewhere.
    expect(container.textContent).not.toContain("**bold text**");
    expect(container.textContent).not.toContain("```");
  });

  /**
   * GOAL 2: an attachment embedded from the composer must actually SHOW in
   * the read view, not render as its reference text. The file is a ticket
   * attachment referenced by its inline URL.
   */
  it("renders an embedded attachment with a safe src as a real <img>", () => {
    render(renderCommentBody(
      "![diagram.png](/api/tasks/T-1/attachments/diagram.png?inline=1)",
      { resolveMention },
    ));
    const img = screen.getByTestId<HTMLImageElement>("comment-image");
    // Red-proof: the pre-GOAL-2 reader rendered the embed as a
    // `<span>` of reference text, so there was no <img> at all.
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/api/tasks/T-1/attachments/diagram.png?inline=1");
    expect(img.getAttribute("alt")).toBe("diagram.png");
  });

  /** @verifies CMT-22 — an unsafe embed src never becomes an <img src="javascript:…">. */
  it("falls back to reference text for an unsafe embed src", () => {
    const { container } = render(renderCommentBody(
      "![x](javascript:alert(1))",
      { resolveMention },
    ));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("x");
  });
});

describe("mention chips", () => {
  /** @verifies CMT-9 */
  it("renders a resolved mention as a chip carrying the current display name", () => {
    draw("please look @user:u_ana");

    const chip = screen.getByTestId("mention-chip");
    expect(chip.textContent).toBe("@Ana Lopez");
    expect(chip.getAttribute("data-mention-id")).toBe("u_ana");

    // Distinguishable "by more than colour": it is its own element
    // with a border and a leading glyph, not a run of styled text.
    expect(chip.className).toContain("border");
    // The stored token is not what the reader sees.
    expect(chip.textContent).not.toContain("u_ana");
  });

  /** @verifies CMT-9 CMT-8 */
  it("renders an unresolvable @user token as plain text, not a broken chip", () => {
    draw("hello @user:nobody there");

    expect(screen.queryByTestId("mention-chip")).toBeNull();
    const plain = screen.getByTestId("mention-plain");
    expect(plain.textContent).toBe("@user:nobody");
    // Paired positive: the surrounding prose is intact, so this is
    // "rendered as text" rather than "the body failed to render".
    expect(screen.getByTestId("comment-body").textContent).toContain("hello");
    expect(screen.getByTestId("comment-body").textContent).toContain("there");
  });

  /** @verifies CMT-8 */
  it("still renders a chip for a user archived after being mentioned", () => {
    draw("thanks @user:u_old");

    const chip = screen.getByTestId("mention-chip");
    // Resolved, so historical attribution survives …
    expect(chip.textContent).toBe("@Sam Gone");
    // … and marked, so the reader can tell this person is archived.
    expect(chip.getAttribute("data-mention-archived")).toBe("true");
  });

  /** @verifies CMT-11 */
  it("renders one chip per mention, including a repeat of the same user", () => {
    draw("@user:u_ana and @user:u_bo and @user:u_ana again");

    const chips = screen.getAllByTestId("mention-chip");
    expect(chips.map(c => c.textContent)).toEqual([
      "@Ana Lopez",
      "@Bo Reed",
      "@Ana Lopez",
    ]);
  });

  /** @verifies CMT-10 */
  it("takes the chip's name from the resolver, so a rename changes it with no stored change", () => {
    const stored = "nice work @user:u_ana";

    const before = render(renderCommentBody(stored, { resolveMention }));
    expect(before.getByTestId("mention-chip").textContent).toBe("@Ana Lopez");
    cleanup();

    // The *same stored bytes*, a renamed user. This is the mechanism
    // CMT-10 rests on: nothing on disk changed.
    const renamed = (id: string): MentionTarget | undefined =>
      id === "u_ana" ? { id, name: "Ana Ruiz", archived: false } : undefined;
    const after = render(renderCommentBody(stored, { resolveMention: renamed }));
    expect(after.getByTestId("mention-chip").textContent).toBe("@Ana Ruiz");
  });
});

describe("injection", () => {
  /** @verifies CMT-22 */
  it("neutralises script tags and event-handler attributes in a comment body", () => {
    const { container } = render(
      renderCommentBody(
        "<script>window.PWNED = 1</script> and <img src=x onerror=\"window.PWNED = 2\">",
        { resolveMention },
      ),
    );

    // What the DOM *contains*, named explicitly. A body that rendered
    // "fine" while smuggling either of these in would pass a
    // "nothing bad happened" assertion.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(document.querySelectorAll("script").length).toBe(0);

    // And the paired positive: it is not silently dropped either. The
    // user sees the characters they wrote, as text.
    expect(container.textContent).toContain("<script>window.PWNED = 1</script>");
    expect(container.textContent).toContain("onerror");
    // Nothing executed: the payload would have set this.
    expect((window as unknown as { PWNED?: unknown }).PWNED).toBeUndefined();

    // The proof that it is *text*: no element carries it.
    expect(container.innerHTML).not.toContain("<script");
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });

  /** @verifies CMT-22 */
  it("refuses a javascript: URL as an href while still showing the link text", () => {
    /**
     * **Mixed case deliberately.** A lowercase `javascript:` is
     * refused by an allowlist and equally by the naive
     * `!href.startsWith("javascript:")` denylist that an allowlist
     * exists to replace — so a test using the lowercase form cannot
     * tell the two apart, and stays green on the weaker guard. This
     * spelling is refused only by the allowlist.
     */
    const { container } = render(
      renderCommentBody("[click me](JaVaScRiPt:window.__pwned=3)", { resolveMention }),
    );

    // No anchor at all, so there is nothing to click into a script
    // context — a React-built href executes exactly as an
    // innerHTML-built one does.
    expect(container.querySelector("a")).toBeNull();
    // And the URL reached no *attribute* of any kind — not `href`, and
    // not the `title` an earlier draft of this put it in. The only
    // place it appears is as a text node.
    expect(container.querySelector("[href]")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();

    // Paired positive: the words survive, and so does the URL — as
    // text the reader can see, so the refusal is visible rather than a
    // silent swallow.
    expect(container.textContent).toContain("click me");
    expect(screen.getByTestId("comment-unsafe-link").textContent)
      .toContain("JaVaScRiPt:window.__pwned=3");
  });

  /** @verifies CMT-22 */
  it("isSafeHref allows real schemes and refuses script-bearing ones however spelled", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.com")).toBe(true);
    expect(isSafeHref("/tasks/T-1")).toBe(true);
    expect(isSafeHref("#anchor")).toBe(true);
    expect(isSafeHref("relative/path")).toBe(true);

    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    // Case and embedded control characters are how a denylist is
    // defeated; the allowlist has to survive both.
    expect(isSafeHref("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeHref("  javascript:alert(1)")).toBe(false);
    expect(isSafeHref("java\tscript:alert(1)")).toBe(false);
    expect(isSafeHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
  });
});

describe("A295 — the comment reader renders underline and highlight", () => {
  // The comment composer is the SAME RichEditor + Toolbar as the task
  // body, so a commenter can author these. Without a case arm here the
  // author sees formatting while writing and loses it on post.
  it("renders <ins> for underline and <mark> for highlight", () => {
    const { container } = render(
      renderCommentBody("a <ins>under</ins> and ==high== b", { resolveMention }),
    );
    expect(container.querySelector("ins")?.textContent).toBe("under");
    expect(container.querySelector("mark")?.textContent).toBe("high");
  });
});
