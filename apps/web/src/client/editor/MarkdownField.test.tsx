// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownField } from "./MarkdownField.tsx";

/**
 * The shared editing shell (Ken: "why aren't we making it the same
 * component?"). The description body and the comment composer both render
 * `MarkdownField`, so the toolbar they show is the SAME toolbar by
 * construction. These pin what "the same" means: an always-visible icon
 * toolbar (not the composer's old focus-gated text-label one), an Attach
 * button when wired, and the icon mode toggle under the caller's testid
 * prefix.
 */

afterEach(cleanup);

const noop = (): void => {};

/** Wait a couple of frames for the TipTap editor to mount and publish. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}

describe("MarkdownField — the one shell both editors render", () => {
  it("shows the always-on icon toolbar immediately in rich mode, without needing focus", async () => {
    render(
      <MarkdownField
        mode="rich"
        onModeChange={noop}
        text="hi"
        onRichDoc={noop}
        onRawChange={noop}
        mentionCandidates={[]}
      />,
    );
    await settle();
    // The formatting toolbar is present WITHOUT any focus event — this is
    // the description body's always-on toolbar, now inherited by the
    // composer. Red-proof: the composer's pre-unification chrome was
    // RichEditor's focus-gated toolbar, absent until the surface focused.
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    const bold = screen.getByTestId("fmt-bold");
    // An icon glyph, not a text label (A208) — the affordance is drawn.
    expect(bold.textContent).toBe("");
    expect(bold.querySelector("svg")).toBeTruthy();
  });

  it("names the mode toggle under the caller's prefix (so two editors on a page do not collide)", async () => {
    render(
      <MarkdownField
        mode="rich"
        onModeChange={noop}
        text=""
        onRichDoc={noop}
        onRawChange={noop}
        mentionCandidates={[]}
        modeTestIdPrefix="comment-composer-mode"
      />,
    );
    await settle();
    expect(screen.getByTestId("comment-composer-mode-rich")).toBeTruthy();
    expect(screen.getByTestId("comment-composer-mode-raw")).toBeTruthy();
    // The mode toggle is an icon toggle (Ken: not "Rich"/"Markdown" text).
    expect(screen.getByTestId("comment-composer-mode-raw").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("comment-composer-mode-rich").querySelector("svg")).toBeTruthy();
  });

  it("shows an Attach button only when onAttachFiles is wired, and the picker feeds it", async () => {
    const onAttachFiles = vi.fn();
    const { rerender } = render(
      <MarkdownField
        mode="rich"
        onModeChange={noop}
        text=""
        onRichDoc={noop}
        onRawChange={noop}
        mentionCandidates={[]}
      />,
    );
    await settle();
    // No Attach affordance without the callback (the plain description edit,
    // or an edit composer with no upload wiring).
    expect(screen.queryByTestId("fmt-attach")).toBeNull();

    rerender(
      <MarkdownField
        mode="rich"
        onModeChange={noop}
        text=""
        onRichDoc={noop}
        onRawChange={noop}
        mentionCandidates={[]}
        onAttachFiles={onAttachFiles}
        attachInputTestId="comment-composer-attach-input"
      />,
    );
    await settle();
    expect(screen.getByTestId("fmt-attach")).toBeTruthy();

    // Choosing a file feeds onAttachFiles — the wiring GOAL 2 depends on.
    const input = screen.getByTestId<HTMLInputElement>("comment-composer-attach-input");
    const file = new File(["x"], "pic.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    const passed = onAttachFiles.mock.calls[0]?.[0] as readonly File[] | undefined;
    expect(passed?.[0]?.name).toBe("pic.png");
  });
});
