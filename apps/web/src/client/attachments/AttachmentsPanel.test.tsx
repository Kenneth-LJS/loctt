// @vitest-environment jsdom
import type { AttachmentResponse } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentsPanel } from "./AttachmentsPanel.tsx";

/**
 * Phase-7B / S7. The attachments panel against the two corruption
 * shapes it must survive, turned on what the panel RENDERS from its
 * props (server + core tests cover the wire against a real tracker).
 *
 * The design point being locked here: **the panel is health-agnostic.**
 * It reads `attachments` + `attachmentsError` + `onRetry` and nothing
 * else — never `task.health`, never frontmatter. So a task with
 * field-local corruption (loaded via tolerant core, `health` carried
 * beside a clean projection) reaches this panel with exactly the same
 * props a healthy task would, and its attachments panel opens normally.
 * There is no task-health input to pass because attachments are
 * orthogonal to frontmatter health.
 *
 * REL-49 is the one attachments-side corruption: an unreadable
 * `attachments/` directory degrades THIS SECTION (an error affordance
 * with retry) while the task otherwise renders — never blanking it and
 * never claiming "no attachments" over a directory that may be full.
 *
 * The panel had no client test at all before this file.
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function attachment(over: Partial<AttachmentResponse> = {}): AttachmentResponse {
  return { name: "spec.pdf", size: 2048, mime: "application/pdf", ...over };
}

/** An attachment with no inferred MIME (a name with no known extension). */
function attachmentNoMime(name: string): AttachmentResponse {
  const a = attachment({ name });
  delete (a as { mime?: string }).mime;
  return a;
}

// No `globals: true` in this workspace's vitest config, so RTL's
// auto-cleanup afterEach is not registered — unmount explicitly, or one
// test's tiles leak into the next test's `screen` queries.
afterEach(() => { cleanup(); });

describe("AttachmentsPanel — corruption survival (S7)", () => {
  describe("a corrupt task's attachments panel opens normally", () => {
    // A field-local-corrupt task loads via tolerant core; its response
    // still carries a real `attachments` list. The panel is passed the
    // same props a healthy task's panel gets — it does not read health —
    // so it must render the grid, the tiles and the count with no crash
    // and no error affordance.
    // @verifies DEG-20
    it("renders the grid, tiles and count from attachments alone", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[attachment({ name: "a.pdf" }), attachment({ name: "b.png", mime: "image/png" })]}
        />,
        { wrapper: wrapper() },
      );

      expect(screen.getByTestId("attachment-grid")).toBeTruthy();
      const tiles = screen.getAllByTestId("attachment-tile");
      expect(tiles.map(t => t.getAttribute("data-name"))).toEqual(["a.pdf", "b.png"]);
      expect(screen.getByTestId("attachments-count").textContent).toContain("2 attachments");
      // Independent of any frontmatter health: no error, no empty claim.
      expect(screen.queryByTestId("attachments-error")).toBeNull();
      expect(screen.queryByTestId("attachments-empty")).toBeNull();
    });

    it("renders the empty state (not an error) when a corrupt task simply has no attachments", () => {
      render(
        <AttachmentsPanel taskRef="T-7" attachments={[]} />,
        { wrapper: wrapper() },
      );

      expect(screen.getByTestId("attachments-empty")).toBeTruthy();
      expect(screen.queryByTestId("attachments-error")).toBeNull();
      expect(screen.queryByTestId("attachment-grid")).toBeNull();
    });
  });

  describe("REL-49 — an unreadable attachments directory degrades the section", () => {
    // @verifies DEG-20
    it("shows the error affordance instead of the 'no attachments' claim", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[]}
          attachmentsError="EACCES: permission denied"
        />,
        { wrapper: wrapper() },
      );

      const err = screen.getByTestId("attachments-error");
      expect(err.textContent).toContain("Attachments could not be read");
      expect(err.textContent).toContain("EACCES: permission denied");
      // The point of REL-49: the empty list must NOT be reported as
      // "no attachments" — that would be a claim about a disk nothing
      // verified. The dropzone (add affordance) still renders, so the
      // section degraded rather than vanished.
      expect(screen.queryByTestId("attachments-empty")).toBeNull();
      expect(screen.getByTestId("attachment-dropzone")).toBeTruthy();
    });

    it("offers Retry only when onRetry is supplied, and calls it", () => {
      const onRetry = vi.fn();
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[]}
          attachmentsError="EIO"
          onRetry={onRetry}
        />,
        { wrapper: wrapper() },
      );

      fireEvent.click(screen.getByTestId("attachments-retry"));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("omits Retry when no onRetry handler is given", () => {
      render(
        <AttachmentsPanel taskRef="T-7" attachments={[]} attachmentsError="EIO" />,
        { wrapper: wrapper() },
      );
      expect(screen.queryByTestId("attachments-retry")).toBeNull();
    });
  });

  // REL-16 bullet 1 / K95: an image-family tile renders an inline
  // <img> (the full image, CSS-scaled) against the ?inline=1 bytes
  // endpoint; a non-image keeps its type icon; an <img> load error
  // falls back to the type icon (K14 pt 4), never a broken-image icon.
  describe("REL-16 — image tiles render an inline thumbnail", () => {
    // @verifies REL-16
    it("renders an <img> pointing at the ?inline=1 bytes for an image family, not a glyph", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[attachment({ name: "shot.png", mime: "image/png" })]}
        />,
        { wrapper: wrapper() },
      );
      const img = screen.getByTestId("attachment-thumb");
      expect(img.tagName).toBe("IMG");
      expect(img.getAttribute("src")).toBe(
        "/api/tasks/T-7/attachments/shot.png?inline=1",
      );
      // The type glyph is not shown while the image renders.
      expect(screen.queryByTestId("attachment-icon")).toBeNull();
    });

    // @verifies REL-16
    it("renders an inline <img> for an SVG too (safe under the <img> sandbox)", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[attachment({ name: "vector.svg", mime: "image/svg+xml" })]}
        />,
        { wrapper: wrapper() },
      );
      expect(screen.getByTestId("attachment-thumb")).toBeTruthy();
      expect(screen.queryByTestId("attachment-icon")).toBeNull();
    });

    // @verifies REL-16
    it("shows the type icon (not an <img>) for a non-image: pdf, mp4, and unknown", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[
            attachment({ name: "doc.pdf", mime: "application/pdf" }),
            attachment({ name: "clip.mp4", mime: "video/mp4" }),
            attachmentNoMime("blob"),
          ]}
        />,
        { wrapper: wrapper() },
      );
      // No inline images anywhere.
      expect(screen.queryByTestId("attachment-thumb")).toBeNull();
      // Every tile shows its type glyph.
      expect(screen.getAllByTestId("attachment-icon")).toHaveLength(3);
    });

    // @verifies REL-16
    it("falls back to the type icon when the <img> fails to load (K14 pt 4), not a broken-image icon", () => {
      render(
        <AttachmentsPanel
          taskRef="T-7"
          attachments={[attachment({ name: "corrupt.png", mime: "image/png" })]}
        />,
        { wrapper: wrapper() },
      );
      const img = screen.getByTestId("attachment-thumb");
      // Before the error the icon is absent.
      expect(screen.queryByTestId("attachment-icon")).toBeNull();
      // A file that fails to decode as an image fires onError.
      fireEvent.error(img);
      // The <img> is gone; the tile now shows the type icon instead —
      // "as if the image wasn't there", never a broken-image glyph.
      expect(screen.queryByTestId("attachment-thumb")).toBeNull();
      expect(screen.getByTestId("attachment-icon")).toBeTruthy();
    });
  });
});

/**
 * UI-22: the "Upload" affordance inside the dropzone sentence was
 * styled as a bordered/padded chip AND underlined text at once, reading
 * as neither. It stays a `<button>` (it proxies a click to a hidden
 * file input — an action, not navigation), but drops the box treatment
 * so it reads as inline underlined text matching the sentence around
 * it, the same shape `GroupError`'s Retry link already uses.
 */
describe("AttachmentsPanel Upload affordance (UI-22)", () => {
  it("has no border/box classes, only the inline-link treatment", () => {
    render(<AttachmentsPanel taskRef="T-7" attachments={[]} />, { wrapper: wrapper() });
    const upload = screen.getByTestId("attachment-upload");
    expect(upload.className).not.toMatch(/\bborder\b/);
    expect(upload.className).not.toMatch(/\brounded\b/);
    expect(upload.className).not.toMatch(/\bpx-1\.5\b/);
    expect(upload.className).not.toMatch(/\bpy-0\.5\b/);
    // Still reads as an inline text affordance.
    expect(upload.className).toMatch(/\bunderline\b/);
  });
});
