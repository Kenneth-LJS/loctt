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
});
