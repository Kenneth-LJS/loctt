// @vitest-environment jsdom
import type { CalendarConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarPanel } from "./CalendarPanel.tsx";

/**
 * SET-24: an unresolvable stored timezone must name both the value and
 * the file it came from (`.loctt/config/calendar.yaml`) — not just the
 * value. A322/K116's copy trim removed the file name from this alert
 * along with the rest of Settings' explanatory prose; SET-24 never
 * asked for that line to go, so its loss was a defect, not a trim.
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CalendarPanel", () => {
  // @verifies SET-24
  it("names the stored value AND the config file when the timezone does not resolve", async () => {
    const calendar: CalendarConfig = {
      timezone: "Mars/Olympus_Mons",
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [],
    };
    fetchMock.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/api/calendar")) return Promise.resolve(jsonResponse(calendar));
      return Promise.resolve(jsonResponse({}, 404));
    });

    render(<CalendarPanel />, { wrapper: wrapper() });

    const alert = await screen.findByTestId("calendar-timezone-unresolvable");
    expect(alert.textContent).toContain("Mars/Olympus_Mons");
    expect(alert.textContent).toContain(".loctt/config/calendar.yaml");
  });
});
