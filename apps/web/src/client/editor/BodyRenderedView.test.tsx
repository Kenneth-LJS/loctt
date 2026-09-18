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

  // @verifies TSK-66
  it("TSK-66: renders a GFM pipe table as a table, not literal text", () => {
    renderView("| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n");
    // A real table element with the header and body cells — not a
    // paragraph of `| Name | Qty |` characters, and not the `null` the
    // default node branch would give (which would drop it entirely).
    const table = document.querySelector("table");
    expect(table).not.toBeNull();
    expect(document.querySelectorAll("th")).toHaveLength(2);
    expect(document.querySelectorAll("td")).toHaveLength(2);
    expect(document.querySelector("th")?.textContent).toBe("Name");
    expect(document.querySelector("td")?.textContent).toBe("Apple");
    // The raw pipe syntax is not shown as visible text anywhere.
    expect(screen.queryByText(/\| Name \| Qty \|/)).toBeNull();
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
  it("TSK-70: clicking an image opens a lightbox and does not enter edit", () => {
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
  it("TSK-70: an EXTERNAL image loads inline as an <img>, with the referrer withheld", () => {
    // Ken's ruling (reversing A180): external images load inline like
    // GitHub/Jira. `referrerPolicy=no-referrer` withholds the referrer
    // (it does not stop the fetch — the accepted privacy tradeoff).
    const onEnterEdit = vi.fn();
    renderView("Look: ![a picture](https://example.com/pic.png)", onEnterEdit);
    const img = screen.getByTestId("body-image");
    expect(img.getAttribute("src")).toBe("https://example.com/pic.png");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.click(img);
    expect(onEnterEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-image-lightbox")).toBeTruthy();
  });

  // @verifies TSK-70
  it("TSK-70: an unsafe image scheme (javascript:/data:) is NOT rendered as an <img>", () => {
    // The XSS guard stays even though external http(s) now loads inline.
    renderView("![x](javascript:alert(1))");
    expect(screen.queryByTestId("body-image")).toBeNull();
    cleanup();
    renderView("![x](data:text/html,<script>alert(1)</script>)");
    expect(screen.queryByTestId("body-image")).toBeNull();
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
