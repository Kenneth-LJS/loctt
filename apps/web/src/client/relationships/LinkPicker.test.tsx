// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskSearchHit } from "../api/hooks/useTaskSearch.ts";

/**
 * LinkPicker read only `results.data` and `results.isSuccess` — a search
 * that was *in flight* rendered a blank void (no "no results" yet, and the
 * data was undefined), and a search that *failed* rendered nothing at all,
 * silently, indistinguishable from "no match". Both are ERR-1-adjacent
 * failures the picker now surfaces:
 *
 *  - isFetching (first page) → an announced "Searching…" (role=status)
 *  - isError → an actionable error, distinct from the "no task matches"
 *    empty result.
 *
 * The hook is mocked so each React-Query state can be driven directly.
 * Every assertion is red-proven against the pre-fix component: `Searching…`
 * and the search-error row did not exist, so the search box sat blank.
 */

type SearchState = {
  data?: readonly TaskSearchHit[];
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
};

let SEARCH: SearchState;
const refetch = vi.fn();

vi.mock("../api/hooks/useTaskSearch.ts", () => ({
  useTaskSearch: () => SEARCH,
}));

const { LinkPicker } = await import("./LinkPicker.tsx");

const WORKFLOW = {
  statuses: [],
  priorities: [],
  task_types: [],
  relationships: [
    {
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
      graph: "acyclic",
      ranked: true,
    },
  ],
  custom_fields: [],
} as unknown as WorkflowConfig;

function renderPicker() {
  return render(
    <LinkPicker
      workflow={WORKFLOW}
      statusOf={() => undefined}
      selfId="01SELF0000000000000000000A"
      selfKey="WEB-1"
      selfTitle="The current task"
      selfKeyHistory={[]}
      pending={false}
      error={undefined}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
}

/** Type into the target search so the results block (gated on a non-empty
 *  query) renders. */
function type(query: string) {
  fireEvent.change(screen.getByTestId("link-target"), { target: { value: query } });
}

afterEach(() => {
  cleanup();
  refetch.mockClear();
});

describe("LinkPicker search states", () => {
  it("announces Searching… while the first page is in flight", () => {
    SEARCH = { data: undefined, isFetching: true, isError: false, isSuccess: false, refetch };
    renderPicker();
    type("web");

    const searching = screen.getByTestId("link-searching");
    expect(searching.textContent).toMatch(/Searching/i);
    // Announced (not a silent blank): role=status, so a screen reader
    // hears the picker working.
    expect(searching.getAttribute("role")).toBe("status");
    // It is not the "no match" empty state (that is a different fact).
    expect(screen.queryByTestId("link-no-results")).toBeNull();
  });

  it("shows an actionable, distinct error when the search request fails", () => {
    SEARCH = { data: undefined, isFetching: false, isError: true, isSuccess: false, refetch };
    renderPicker();
    type("web");

    const err = screen.getByTestId("link-search-error");
    expect(err.getAttribute("role")).toBe("alert");
    // Distinct from "no task matches" — the picker never claims nothing
    // was found when the search itself broke.
    expect(err.textContent).toMatch(/Could not search/i);
    expect(screen.queryByTestId("link-no-results")).toBeNull();

    // The error carries a repeatable action wired to the query refetch.
    fireEvent.click(screen.getByTestId("link-search-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("still shows the no-match empty state on a successful empty result", () => {
    SEARCH = { data: [], isFetching: false, isError: false, isSuccess: true, refetch };
    renderPicker();
    type("nope");

    // A genuine empty result is unchanged — neither Searching nor the
    // search-error row appears.
    expect(screen.getByTestId("link-no-results")).toBeTruthy();
    expect(screen.queryByTestId("link-searching")).toBeNull();
    expect(screen.queryByTestId("link-search-error")).toBeNull();
  });
});
