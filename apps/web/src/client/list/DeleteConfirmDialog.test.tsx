// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DELETE_CONFIRM_WORD,
  DeleteConfirmDialog,
  deleteConfirmWord,
  LARGE_DELETE_THRESHOLD,
} from "./DeleteConfirmDialog.tsx";

/**
 * The delete confirmation, and how hard it is to get through.
 *
 * BLK-30's second bullet is the one with teeth: "the confirmation
 * string required is proportionate — deleting 1,280 tasks must not
 * require the same keystroke as deleting 2". A fixed word is muscle
 * memory by the third use, and muscle memory is exactly what should
 * not carry someone through deleting a thousand tasks.
 */

afterEach(cleanup);

describe("deleteConfirmWord", () => {
  /**
   * @verifies BLK-30
   */
  it("asks for the word on a small batch and the count on a large one", () => {
    expect(deleteConfirmWord(1)).toBe(DELETE_CONFIRM_WORD);
    expect(deleteConfirmWord(2)).toBe(DELETE_CONFIRM_WORD);
    expect(deleteConfirmWord(LARGE_DELETE_THRESHOLD)).toBe(DELETE_CONFIRM_WORD);

    // Above the threshold the string is the count, so it cannot be
    // typed without reading it.
    expect(deleteConfirmWord(LARGE_DELETE_THRESHOLD + 1))
      .toBe(String(LARGE_DELETE_THRESHOLD + 1));
    expect(deleteConfirmWord(1_280)).toBe("1280");

    // And two different large batches do not share a keystroke.
    expect(deleteConfirmWord(1_280)).not.toBe(deleteConfirmWord(42));
  });
});

describe("DeleteConfirmDialog", () => {
  /**
   * @verifies BLK-30
   *
   * "The modal says 1,280, not the visible page size." The count the
   * dialog is given is the selection's, and it is stated in both the
   * headline and the button.
   */
  it("names the actual scope in the headline and the button", () => {
    render(
      <DeleteConfirmDialog count={1280} onCancel={() => undefined} onConfirm={() => undefined} />,
    );

    expect(screen.getByRole("heading").textContent).toContain("1280");
    expect(
      screen.getByRole("button", { name: /Delete 1280 tasks/ }),
    ).toBeTruthy();
  });

  /**
   * @verifies BLK-30
   *
   * The proportionate string, end to end: typing the habitual word is
   * not enough for a large batch.
   */
  it("refuses the habitual word on a large batch and accepts the count", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog count={1280} onCancel={() => undefined} onConfirm={onConfirm} />,
    );

    const input = screen.getByLabelText("Type 1280 to confirm");
    const button = screen.getByRole("button", { name: /Delete 1280 tasks/ });

    fireEvent.change(input, { target: { value: DELETE_CONFIRM_WORD } });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1280" } });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * @verifies BLK-11
   *
   * The small-batch path is unchanged: still a typed confirmation,
   * because delete is irreversible at any size.
   */
  it("still requires the word on a small batch", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog count={2} onCancel={() => undefined} onConfirm={onConfirm} />,
    );

    const button = screen.getByRole("button", { name: /Delete 2 tasks/ });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: DELETE_CONFIRM_WORD },
    });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  /**
   * @verifies BLK-30
   *
   * The app does not refuse beyond a threshold — it does not truncate
   * either, which is the failure that bullet actually guards against.
   * If a limit is introduced later it has to be stated; there is none
   * to state, so the dialog offers the full count.
   */
  it("does not cap or truncate a very large batch", () => {
    render(
      <DeleteConfirmDialog count={50_000} onCancel={() => undefined} onConfirm={() => undefined} />,
    );
    expect(screen.getByRole("heading").textContent).toContain("50000");
    expect(screen.getByRole("button", { name: /Delete 50000 tasks/ })).toBeTruthy();
  });
});
