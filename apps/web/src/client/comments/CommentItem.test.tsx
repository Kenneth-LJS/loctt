// @vitest-environment jsdom
import type { CommentResponse } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentItem } from "./CommentItem.tsx";
import { buildUserIndex } from "./users.ts";

afterEach(cleanup);

const AUTHOR = "01J000000000000000000AUTHR";

const comment: CommentResponse = {
  id: "01J000000000000000000CMNT1",
  author: AUTHOR,
  body: "hello world",
  created_at: "2026-01-01T00:00:00.000Z",
};

const users = buildUserIndex([
  { id: AUTHOR, name: "Ana Lopez" },
]);

function renderItem(
  overrides: {
    onCopyLink?: () => void;
    onStartEdit?: () => void;
    onDelete?: () => void;
  } = {},
): void {
  render(
    <CommentItem
      comment={comment}
      users={users}
      now={Date.parse("2026-01-01T01:00:00.000Z")}
      mentionCandidates={[]}
      editing={false}
      editError={undefined}
      editPending={false}
      resolveMention={() => undefined}
      onMentionActivate={() => {}}
      onStartEdit={overrides.onStartEdit ?? (() => {})}
      onCancelEdit={() => {}}
      onSaveEdit={() => {}}
      onDelete={overrides.onDelete ?? (() => {})}
      onCopyLink={overrides.onCopyLink ?? (() => {})}
    />,
  );
}

/**
 * The row-action trio (Copy link / Edit / Delete) migrated from raw
 * <button>s to the `Button` primitive during the component-library work.
 * These tests lock in the behaviour that must survive that swap: the
 * testids integration/e2e select by, the aria-label on Copy link, the
 * click wiring, and the ghost-vs-ghost-danger visual split (Delete
 * reddens on hover; Copy link / Edit hover neutral). They would fail if a
 * button reverted to a bare element, lost its testid, or got the wrong
 * variant.
 */
describe("CommentItem row actions", () => {
  it("keeps the three action testids/labels the selectors rely on", () => {
    renderItem();
    expect(screen.getByTestId("comment-copy-link")).toBeTruthy();
    expect(screen.getByTestId("comment-edit")).toBeTruthy();
    expect(screen.getByTestId("comment-delete")).toBeTruthy();
    // Copy link's accessible name (icon carries no text on its own).
    expect(
      screen.getByRole("button", { name: "Copy link to this comment" }),
    ).toBeTruthy();
  });

  it("wires each action's click handler", () => {
    const onCopyLink = vi.fn();
    const onStartEdit = vi.fn();
    const onDelete = vi.fn();
    renderItem({ onCopyLink, onStartEdit, onDelete });
    fireEvent.click(screen.getByTestId("comment-copy-link"));
    fireEvent.click(screen.getByTestId("comment-edit"));
    fireEvent.click(screen.getByTestId("comment-delete"));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders Copy link / Edit as ghost (neutral hover), Delete as ghost-danger (reddens on hover)", () => {
    renderItem();
    const copy = screen.getByTestId("comment-copy-link").className;
    const edit = screen.getByTestId("comment-edit").className;
    const del = screen.getByTestId("comment-delete").className;

    // Copy link + Edit: ghost — hover to neutral, never the danger tone.
    for (const cls of [copy, edit]) {
      expect(cls).toContain("hover:bg-bg-muted");
      expect(cls).toContain("hover:text-text-primary");
      expect(cls).not.toContain("hover:text-danger-fg");
    }

    // Delete: ghost-danger — ghost surface that reddens on hover, not a
    // filled danger button.
    expect(del).toContain("hover:text-danger-fg");
    expect(del).toContain("hover:bg-danger-fg/10");
    expect(del).not.toContain("bg-danger-fg text-accent-contrast");

    // All three are real buttons (not reverted to bare elements) at the
    // sm size.
    for (const el of [
      screen.getByTestId("comment-copy-link"),
      screen.getByTestId("comment-edit"),
      screen.getByTestId("comment-delete"),
    ]) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
      expect(el.className).toContain("h-7");
    }
  });
});
