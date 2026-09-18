// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardLayoutPanel } from "./CardLayoutPanel.tsx";

/**
 * Card layout editor (SET-12, SET-26).
 *
 * SET-12's fourth bullet is explicit that asserting the render is not
 * enough — "re-read the file and confirm the new `card_layout` array,
 * in order". At component level the far end is the PUT body, which is
 * what a `settings.yaml` read would be reading back. The UI spec
 * asserts the file itself.
 */

let SETTINGS: Record<string, unknown> = {};
let PUTS: Record<string, unknown>[] = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : String(input);
    const path = raw.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/user-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(
          typeof init.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>;
        PUTS.push(body);
        SETTINGS = body;
        return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: body }), {
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: SETTINGS }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 1000 }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
  }));
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CardLayoutPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => { SETTINGS = {}; PUTS = []; stubFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CardLayoutPanel", () => {
  // @verifies SET-12
  it("writes the reordered layout, in order, when a field is moved up", async () => {
    SETTINGS = { card_layout: ["labels", "assignee", "due_date"] };
    renderPanel();

    // Move assignee (index 1) above labels (index 0) with the keyboard
    // handle, which is the same `onMove` the drag path calls.
    const handle = await waitFor(() => {
      const h = document.querySelector('[data-testid="card-field-row-assignee"] [role="button"], [data-testid="card-field-row-assignee"] button');
      if (h === null) throw new Error("no handle");
      return h as HTMLElement;
    });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.keyDown(handle, { key: "ArrowUp" });

    await waitFor(() => { expect(PUTS.length).toBe(1); });
    // Order is the assertion, not mere membership.
    expect(PUTS[0]?.["card_layout"]).toEqual(["assignee", "labels", "due_date"]);
  });

  // @verifies SET-12
  it("writes the layout without a field that was hidden", async () => {
    SETTINGS = { card_layout: ["assignee", "labels", "due_date"] };
    renderPanel();

    (await screen.findByTestId("card-field-toggle-due_date")).click();

    await waitFor(() => { expect(PUTS.length).toBe(1); });
    expect(PUTS[0]?.["card_layout"]).toEqual(["assignee", "labels"]);
  });

  // @verifies SET-12
  it("previews the visible fields in their stored order", async () => {
    SETTINGS = { card_layout: ["due_date", "assignee"] };
    renderPanel();

    await screen.findByTestId("card-layout-preview");
    const shown = [...document.querySelectorAll("[data-preview-field]")]
      .map(e => e.getAttribute("data-preview-field"));
    expect(shown).toEqual(["due_date", "assignee"]);
  });

  // @verifies SET-26
  it("allows hiding every field and previews the empty card before saving", async () => {
    // One visible field left; hiding it empties the layout entirely.
    SETTINGS = { card_layout: ["assignee"] };
    renderPanel();

    (await screen.findByTestId("card-field-toggle-assignee")).click();

    // The outcome is visible in the panel rather than discovered on the
    // board later.
    const empty = await screen.findByTestId("card-layout-preview-empty");
    expect(empty.textContent).toContain("Title only");

    await waitFor(() => { expect(PUTS.length).toBe(1); });
    // An explicit empty array, not an absent key: absence means "use
    // the default layout", which is the opposite of what was asked.
    expect(PUTS[0]?.["card_layout"]).toEqual([]);
  });

  // @verifies SET-26
  it("keeps the title on the card when every field is hidden", async () => {
    SETTINGS = { card_layout: [] };
    renderPanel();

    const preview = await screen.findByTestId("card-layout-preview");
    // The title is the un-hideable anchor, so a card is never a blank
    // unclickable rectangle.
    expect(preview.textContent).toContain("Rewrite the export pipeline");
  });
});
