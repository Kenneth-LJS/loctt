// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "./CommentComposer.tsx";

afterEach(cleanup);

describe("CommentComposer disabled reason — CMT-2", () => {
  // @verifies CMT-2
  it("describes why an empty comment cannot be posted, without a visible notice", async () => {
    render(
      <CommentComposer
        initial=""
        mentionCandidates={[]}
        submitLabel="Comment"
        ariaLabel="Add a comment"
        pending={false}
        error={undefined}
        onSubmit={vi.fn()}
        testId="comment-composer"
      />,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });

    const submit = screen.getByTestId<HTMLButtonElement>("comment-composer-submit");
    expect(submit.disabled).toBe(true);
    // CMT-2's "reason available": the button's accessible description.
    const describedBy = submit.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const reason = document.getElementById(describedBy ?? "");
    expect(reason?.textContent).toMatch(/needs some text/);
    // ...and only that. Ken: "i dont need the notice" — the reason is for
    // a screen reader, not a line printed beside the button.
    expect(reason?.className).toBe("sr-only");
  });
});
