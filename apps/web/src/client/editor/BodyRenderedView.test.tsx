// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BodyRenderedView } from "./BodyRenderedView.tsx";

/**
 * The K33 read state (TSK-68/69/70). This surface is deterministic —
 * it renders markdown to React elements with no TipTap — so it is
 * exercised directly rather than through the e2e spec, which covers the
 * enter/leave gestures against the real editor.
 */

afterEach(cleanup);

const noop = (): void => {};

function renderView(body: string, onEnterEdit = noop) {
  return render(
    <BodyRenderedView
      body={body}
      placeholder="Describe this task…"
      mentionCandidates={[{ id: "u1", name: "Ada" }]}
      onEnterEdit={onEnterEdit}
    />,
  );
}

describe("BodyRenderedView — K33 read state", () => {
  // @verifies TSK-68
  it("TSK-68: renders formatted output with no toolbar and no editable field", () => {
    renderView("# Title\n\n- one\n- two\n\nSome **bold** text.");

    // Formatted: a heading and a list are in the DOM, not literal `#`/`-`.
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.querySelector("strong")?.textContent).toBe("bold");

    // No toolbar, no mode toggle, no editable surface in the read view.
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByTestId("mode-rich")).toBeNull();
    expect(screen.queryByTestId("mode-raw")).toBeNull();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
    expect(screen.queryByTestId("markdown-editor")).toBeNull();

    // The `body-editor` wrapper is preserved (test contract).
    expect(screen.getByTestId("body-editor")).toBeTruthy();
    expect(screen.getByTestId("body-rendered")).toBeTruthy();
  });

  // @verifies TSK-68
  it("TSK-68: an empty body shows the placeholder in the read state", () => {
    renderView("   \n  ");
    expect(screen.getByTestId("body-rendered-placeholder").textContent).toBe(
      "Describe this task…",
    );
  });

  // @verifies TSK-69
  it("TSK-69: clicking the rendered text enters edit", () => {
    const onEnterEdit = vi.fn();
    renderView("Plain paragraph of text.", onEnterEdit);

    fireEvent.click(screen.getByText("Plain paragraph of text."));
    expect(onEnterEdit).toHaveBeenCalledTimes(1);
  });

  // @verifies TSK-69
  it("TSK-69: Enter/Space on the focused read view enters edit", () => {
    const onEnterEdit = vi.fn();
    renderView("Text.", onEnterEdit);
    const view = screen.getByTestId("body-rendered");

    fireEvent.keyDown(view, { key: "Enter" });
    fireEvent.keyDown(view, { key: " " });
    expect(onEnterEdit).toHaveBeenCalledTimes(2);
  });

  // @verifies TSK-70
  it("TSK-70: a link renders with target=_blank rel=noreferrer noopener and does not enter edit", () => {
    const onEnterEdit = vi.fn();
    renderView("A [link](https://example.com/page) here.", onEnterEdit);

    const anchor = screen.getByRole("link", { name: "link" });
    expect(anchor.getAttribute("href")).toBe("https://example.com/page");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noreferrer noopener");

    // Clicking the link is a read action; it must not enter edit.
    fireEvent.click(anchor);
    expect(onEnterEdit).not.toHaveBeenCalled();
  });

  // @verifies TSK-70
  it("TSK-70: an unsafe link scheme is refused (no anchor, shown as text)", () => {
    renderView("A [bad](javascript:alert(1)) link.");
    // No anchor is emitted for a javascript: href.
    expect(screen.queryByRole("link")).toBeNull();
    // The URL is shown as visible text rather than becoming an href,
    // and the refusal is stated.
    expect(document.body.textContent).toContain("javascript:");
    expect(document.body.textContent).toContain("link not followed");
  });

  // @verifies TSK-70
  it("TSK-70: clicking a LOCAL image opens a lightbox and does not enter edit", () => {
    // A local/relative src (a LocTT attachment) — this is what becomes a
    // real, clickable <img>. External image URLs are NOT auto-loaded (see
    // the external-image test below and A180).
    const onEnterEdit = vi.fn();
    renderView("Look: ![a picture](/attachments/pic.png)", onEnterEdit);

    const img = screen.getByTestId("body-image");
    expect(img.getAttribute("src")).toBe("/attachments/pic.png");
    expect(screen.queryByTestId("body-image-lightbox")).toBeNull();

    fireEvent.click(img);
    expect(onEnterEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-image-lightbox")).toBeTruthy();
  });

  // @verifies TSK-70
  it("TSK-70: an EXTERNAL image is a click-to-open link, not an auto-loaded <img> (A180)", () => {
    // Privacy: rendering an <img src="https://other-host/…"> would fetch a
    // remote resource the instant the task is viewed (IP/referrer leak,
    // tracking pixel). An external image renders as a safe link instead.
    const onEnterEdit = vi.fn();
    renderView("Look: ![a picture](https://example.com/pic.png)", onEnterEdit);
    // No auto-loading <img> for the external src…
    expect(screen.queryByTestId("body-image")).toBeNull();
    // …a click-to-open link instead, and clicking it does not enter edit.
    const link = screen.getByTestId("body-image-link");
    expect(link.getAttribute("href")).toBe("https://example.com/pic.png");
    expect(link.getAttribute("target")).toBe("_blank");
    fireEvent.click(link);
    expect(onEnterEdit).not.toHaveBeenCalled();
    // Protocol-relative is also treated as external (no auto-load).
    cleanup();
    renderView("![x](//evil.example/p.png)");
    expect(screen.queryByTestId("body-image")).toBeNull();
    expect(screen.getByTestId("body-image-link")).toBeTruthy();
  });

  // @verifies TSK-70
  it("TSK-70: the lightbox dismisses on click and on Escape", () => {
    renderView("![x](/attachments/pic.png)");

    // Open, then dismiss with a click on the overlay.
    fireEvent.click(screen.getByTestId("body-image"));
    fireEvent.click(screen.getByTestId("body-image-lightbox"));
    expect(screen.queryByTestId("body-image-lightbox")).toBeNull();

    // Open again, then dismiss with Escape.
    fireEvent.click(screen.getByTestId("body-image"));
    expect(screen.getByTestId("body-image-lightbox")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("body-image-lightbox")).toBeNull();
  });

  // @verifies TSK-70
  it("TSK-70: an unsafe image src does not become an <img>", () => {
    renderView("![x](javascript:alert(1))");
    expect(screen.queryByTestId("body-image")).toBeNull();
  });
});
