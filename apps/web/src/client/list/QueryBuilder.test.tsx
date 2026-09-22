// @vitest-environment jsdom
import { act,cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { comboValuesOf, pickComboOn } from "../ui/selectComboboxTestUtils.ts";
import { type BuilderTree,builderTreeToQuery } from "./builderTree.ts";
import { buildBuilderConfig, type BuilderConfig,QueryBuilder } from "./QueryBuilder.tsx";

/**
 * The visual query builder FORM (K83, step 2). A controlled renderer over
 * a BuilderTree: the tests drive its controls, capture the tree the
 * component emits through `onChange`, and assert the DSL that
 * `builderTreeToQuery` derives from that tree — so builder edits are
 * checked against the same serializer the text editor round-trips
 * through, not a private expectation.
 */

afterEach(cleanup);

/** A small config: two statuses, so "constrained to config values" bites. */
const CONFIG: BuilderConfig = buildBuilderConfig({
  workflow: {
    // Only the fields the builder reads are set; the rest of
    // WorkflowConfig is irrelevant to these tests.
    statuses: [
      { key: "todo", label: "To do" },
      { key: "done", label: "Done" },
    ],
    priorities: [{ key: "high", label: "High" }],
    task_types: [{ key: "bug", label: "Bug" }],
    custom_fields: [],
  } as never,
  projects: [],
  users: [{ value: "u-alice", label: "Alice" }],
  labels: [{ value: "l-1", label: "Backend" }],
  milestones: [],
  sprints: [],
});

/** An empty AND group — the builder's starting tree. */
const EMPTY: BuilderTree = { kind: "group", op: "and", children: [] };

/**
 * Renders the builder as its parent would: local state seeded from
 * `initial`, updated on every onChange, and a spy exposing the latest
 * emitted tree. Returns a getter for the last tree and the derived q.
 */
function renderBuilder(initial: BuilderTree = EMPTY, config: BuilderConfig = CONFIG) {
  const onChange = vi.fn();
  let current = initial;
  const rerender = (tree: BuilderTree): void => {
    current = tree;
    view.rerender(<QueryBuilder tree={current} onChange={handle} config={config} />);
  };
  const handle = (tree: BuilderTree): void => {
    onChange(tree);
    rerender(tree);
  };
  const view = render(<QueryBuilder tree={current} onChange={handle} config={config} />);
  return {
    onChange,
    tree: () => current,
    q: (): string => {
      try { return builderTreeToQuery(current); } catch { return "<empty>"; }
    },
  };
}

/** The Nth control of a kind, asserting it exists (keeps lint off `!`). */
function nth(testId: string, i: number): HTMLElement {
  const el = screen.getAllByTestId(testId)[i];
  if (el === undefined) throw new Error(`no ${testId}[${i}]`);
  return el;
}
/**
 * The values a picker offers. K106 made the field/op pickers listbox
 * dropdowns rather than native `<select>`s, so the options exist only
 * while the panel is open — the helper opens it, reads, and closes it.
 */
const optionValues = comboValuesOf;

/**
 * Picks a value in the Nth constrained value picker — a `Combobox`
 * (A211), not a `<select>`: click the trigger, then the named option in
 * its listbox. The list closes on a single pick, stays open for multi.
 */
function pickValue(i: number, optionName: string): void {
  fireEvent.click(nth("qb-value", i));
  const list = screen.getByTestId("qb-value-options");
  fireEvent.click(within(list).getByRole("option", { name: optionName }));
}

describe("QueryBuilder", () => {
  it("builds a two-condition AND query with the right q", () => {
    const b = renderBuilder();

    // Add two conditions to the root AND group.
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // Row 0: status = done (enum picker).
    pickComboOn(nth("qb-field", 0), "status");
    pickComboOn(nth("qb-op", 0), "=");
    pickValue(0, "Done");

    // Row 1: title ~ "log in" — a value with a space, which dslAtom
    // quotes (a bare word would round-trip unquoted).
    pickComboOn(nth("qb-field", 1), "title");
    pickComboOn(nth("qb-op", 1), "~");
    fireEvent.change(nth("qb-value", 1), { target: { value: "log in" } });

    expect(b.q()).toBe('status = done and title ~ "log in"');
  });

  it("switches the group operator AND↔OR and it lands in q", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "status");
    pickValue(0, "To do");
    pickComboOn(nth("qb-field", 1), "status");
    pickValue(1, "Done");

    expect(b.q()).toBe("status = todo and status = done");

    fireEvent.click(screen.getByTestId("qb-and-or-or"));
    expect(b.q()).toBe("status = todo or status = done");
    const root = b.tree();
    expect(root.kind === "group" && root.op).toBe("or");
  });

  it("adds a nested group and removes the right node", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition")); // leaf 0
    fireEvent.click(screen.getByTestId("qb-add-group"));     // group 1

    let root = b.tree();
    expect(root.kind === "group" && root.children.length).toBe(2);
    expect(root.kind === "group" && root.children[1]?.kind).toBe("group");

    // Remove the first child (the leaf); the nested group must remain.
    fireEvent.click(nth("qb-remove", 0));

    root = b.tree();
    expect(root.kind === "group" && root.children.length).toBe(1);
    expect(root.kind === "group" && root.children[0]?.kind).toBe("group");
  });

  it("constrains an enum value to config values (no arbitrary typing)", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "status");

    // The value control is a Combobox trigger (A211 — the old test pinned
    // a native <select>, the control this replaced) offering only the two
    // configured statuses — not a free text input.
    const valueEl = nth("qb-value", 0);
    expect(valueEl.tagName).toBe("BUTTON");
    expect(valueEl.getAttribute("aria-haspopup")).toBe("listbox");
    fireEvent.click(valueEl);
    const list = screen.getByTestId("qb-value-options");
    expect(within(list).getAllByRole("option").map(o => o.textContent)).toEqual(["To do", "Done"]);
    // Two options is a small fixed set: no search box (the A211 rule).
    expect(within(list.parentElement as HTMLElement).queryByRole("combobox")).toBeNull();

    fireEvent.click(within(list).getByRole("option", { name: "Done" }));
    expect(b.q()).toBe("status = done");
  });

  // @verifies A211
  it("grows a search box once a constrained value set passes the threshold, and it filters", () => {
    const many: BuilderConfig = buildBuilderConfig({
      workflow: { statuses: [], priorities: [], task_types: [], custom_fields: [] } as never,
      projects: [],
      users: [],
      labels: Array.from({ length: 15 }, (_, i) => ({ value: `l-${String(i)}`, label: `label-${String(i).padStart(2, "0")}` })),
      milestones: [],
      sprints: [],
    });
    const b = renderBuilder(EMPTY, many);
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "labels");

    fireEvent.click(nth("qb-value", 0));
    const search = screen.getByRole("combobox", { name: /search value/i });
    fireEvent.change(search, { target: { value: "label-07" } });
    const list = screen.getByTestId("qb-value-options");
    expect(within(list).getAllByRole("option").map(o => o.textContent)).toEqual(["label-07"]);

    fireEvent.click(within(list).getByRole("option", { name: "label-07" }));
    expect(b.q()).toBe("labels = l-7");
  });

  it("hides the value control for `is empty`", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "assignee");
    pickComboOn(nth("qb-op", 0), "is empty");

    expect(screen.queryByTestId("qb-value")).toBeNull();
    expect(b.q()).toBe("assignee is empty");
  });

  it("filters the op picker by field kind", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // Text field: offers `~`, not ordering.
    pickComboOn(nth("qb-field", 0), "title");
    expect(optionValues(nth("qb-op", 0))).toContain("~");
    expect(optionValues(nth("qb-op", 0))).not.toContain("<");

    // Enum field: offers membership, not `~`.
    pickComboOn(nth("qb-field", 0), "status");
    expect(optionValues(nth("qb-op", 0))).toContain("in");
    expect(optionValues(nth("qb-op", 0))).not.toContain("~");

    // Date field: offers ordering.
    pickComboOn(nth("qb-field", 0), "due_date");
    expect(optionValues(nth("qb-op", 0))).toContain("<");
  });

  it("offers a field the config does not know as its raw token, rather than snapping to the first", () => {
    // A `q` parsed from the URL can name a field the current config has no
    // entry for (a removed custom field). The row must show that token as
    // the selection instead of silently becoming some other field — which
    // would rewrite the user's query behind their back.
    //
    // The option must be OFFERED, not merely be the trigger's data-value:
    // `data-value` reflects the tree either way, so asserting it alone
    // stopped covering this when the control became a button.
    renderBuilder({
      kind: "group",
      op: "and",
      children: [{ kind: "leaf", field: "fields.gone", op: "=", value: { type: "string", value: "x" } }],
    });

    expect(optionValues(nth("qb-field", 0))).toContain("fields.gone");
  });

  // @verifies QBLD-5
  it("narrows the `text` alias field to ONLY ~ (F3 — the validator rejects everything else)", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // The `text` alias (title + body substring) accepts only `~` in the
    // validator — so the builder offers only `~`, never =/!=/is empty,
    // which it would otherwise inherit from the `text` KIND.
    pickComboOn(nth("qb-field", 0), "text");
    expect(optionValues(nth("qb-op", 0))).toEqual(["~"]);

    // The sibling `title` field (same KIND, no per-field override) keeps
    // the full string set — proof the narrowing is field-specific, not a
    // regression of the whole `text` kind.
    pickComboOn(nth("qb-field", 0), "title");
    expect(optionValues(nth("qb-op", 0))).toContain("=");
    expect(optionValues(nth("qb-op", 0))).toContain("is empty");
  });

  // @verifies QBLD-5
  it("narrows `comment_mentions` to =/!=/in/not in — no presence or ordering (F4 / CMT-10)", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    pickComboOn(nth("qb-field", 0), "comment_mentions");
    const ops = optionValues(nth("qb-op", 0));
    expect(ops).toEqual(["=", "!=", "in", "not in"]);
    // Explicitly: the presence ops its `user` kind would offer are gone.
    expect(ops).not.toContain("is empty");
    expect(ops).not.toContain("is not empty");
    expect(ops).not.toContain("<");
  });

  // Bug: the condition row's controls were ragged — the value control
  // shrank to its content ("—") while field/operator kept their width, so
  // rows did not line up. The fix puts them in a stable column rhythm: a
  // `qb-leaf-row` flex row holding field + operator + a flex-filling value
  // column. This pins that structure (layout itself is hard to unit-test;
  // the structure the alignment relies on is not).
  it("lays each condition out as one row with field, operator and a filling value column", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "status");

    const row = screen.getByTestId("qb-leaf-row");
    // Field, operator and value all live in the one row container…
    expect(within(row).getByTestId("qb-field")).toBeTruthy();
    expect(within(row).getByTestId("qb-op")).toBeTruthy();
    const value = within(row).getByTestId("qb-value");
    // …and the value control sits in a flex-filling column, so it stops
    // shrinking to its "—" content and lines up with the row below. The
    // wrapper carries `flex-1` — red-proof: drop the wrapper (value emitted
    // bare, as before the fix) and this goes red.
    const valueColumn = value.closest("div.flex-1");
    expect(valueColumn).not.toBeNull();
    expect(row.contains(valueColumn)).toBe(true);
  });

  it("builds an `in (…)` list from a constrained multi-select picker", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "status");
    pickComboOn(nth("qb-op", 0), "in");

    // A multi Combobox, not a checkbox wall (A211 — the old test clicked
    // bare checkboxes, the control this replaced): open once, pick twice;
    // the list stays open between picks.
    fireEvent.click(nth("qb-value", 0));
    fireEvent.click(screen.getByTestId("qb-value-opt-todo"));
    fireEvent.click(screen.getByTestId("qb-value-opt-done"));
    expect(b.q()).toBe("status in (todo, done)");
    expect(screen.getByTestId("qb-value-opt-done").getAttribute("aria-selected")).toBe("true");
    // The trigger summarises the picks.
    expect(nth("qb-value", 0).textContent).toContain("To do, Done");

    // Picking again un-picks.
    fireEvent.click(screen.getByTestId("qb-value-opt-todo"));
    expect(b.q()).toBe("status in (done)");
  });
});

/**
 * K90 parity (A211, last bullet): the builder's entity value pickers search
 * the SERVER as the user types, rather than filtering the capped seed list
 * in memory — so a value outside the initial fetch window is findable and
 * selectable, matching the rest of the app.
 *
 * Red-proof: drop `search` from `buildBuilderConfig` and the picker falls
 * back to the client-side seed filter — `onQuery` is never called, the
 * out-of-seed value never renders, and both assertions below go red.
 */
describe("QueryBuilder — server-side entity value search (K90)", () => {
  /** A config whose assignee search returns a user NOT in the seed list. */
  function serverConfig(onQuery: (q: string) => Promise<readonly { value: string; label: string }[]>) {
    return buildBuilderConfig({
      workflow: { statuses: [], priorities: [], task_types: [], custom_fields: [] } as never,
      projects: [],
      // Seed is a single user — the capped list. The searched-for user is
      // deliberately absent from it, so only a server query can surface them.
      users: [{ value: "u-seed", label: "Seed User" }],
      labels: [],
      milestones: [],
      sprints: [],
      search: { users: onQuery },
    });
  }

  it("queries the server for an entity field and makes an out-of-seed result selectable", async () => {
    vi.useFakeTimers();
    const onQuery = vi.fn((q: string): Promise<readonly { value: string; label: string }[]> =>
      Promise.resolve(
        q === "zoe" ? [{ value: "u-zoe", label: "Zoe (not in seed)" }] : [],
      ));
    try {
      const b = renderBuilder(EMPTY, serverConfig(onQuery));
      fireEvent.click(screen.getByTestId("qb-add-condition"));
      pickComboOn(nth("qb-field", 0), "assignee");

      // Open the value picker. In server mode the search box is ALWAYS
      // present (the list is by definition too big to fetch whole), even
      // though the seed list holds a single user.
      fireEvent.click(nth("qb-value", 0));
      const search = screen.getByRole("combobox", { name: /search value/i });

      fireEvent.change(search, { target: { value: "zoe" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });

      // The server search ran with the typed query…
      expect(onQuery).toHaveBeenCalledWith("zoe");

      // …and its result — a user the capped seed list never held — is in
      // the list and selectable, which no client-side filter over the seed
      // could produce.
      const list = screen.getByTestId("qb-value-options");
      fireEvent.click(within(list).getByRole("option", { name: "Zoe (not in seed)" }));
      expect(b.q()).toBe("assignee = u-zoe");
    } finally {
      vi.useRealTimers();
    }
  });

  it("threads server search into the `in (…)` multi-value picker too", async () => {
    vi.useFakeTimers();
    const onQuery = vi.fn((q: string): Promise<readonly { value: string; label: string }[]> =>
      Promise.resolve(
        q === "zoe" ? [{ value: "u-zoe", label: "Zoe (not in seed)" }] : [],
      ));
    try {
      const b = renderBuilder(EMPTY, serverConfig(onQuery));
      fireEvent.click(screen.getByTestId("qb-add-condition"));
      pickComboOn(nth("qb-field", 0), "assignee");
      pickComboOn(nth("qb-op", 0), "in");

      fireEvent.click(nth("qb-value", 0));
      const search = screen.getByRole("combobox", { name: /search value/i });
      fireEvent.change(search, { target: { value: "zoe" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });

      expect(onQuery).toHaveBeenCalledWith("zoe");
      fireEvent.click(screen.getByTestId("qb-value-opt-u-zoe"));
      expect(b.q()).toBe("assignee in (u-zoe)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves enum fields on the static (client-filtered) picker — no server search", () => {
    // An enum field has no `search` even when entity search is configured,
    // so its picker stays the closed-config Select-like Combobox.
    const onQuery = vi.fn(() => Promise.resolve([]));
    const config = buildBuilderConfig({
      workflow: {
        statuses: [{ key: "todo", label: "To do" }, { key: "done", label: "Done" }],
        priorities: [], task_types: [], custom_fields: [],
      } as never,
      projects: [], users: [], labels: [], milestones: [], sprints: [],
      search: { users: onQuery, labels: onQuery },
    });
    renderBuilder(EMPTY, config);
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickComboOn(nth("qb-field", 0), "status");

    fireEvent.click(nth("qb-value", 0));
    // Two options is a small fixed set: no search box, and nothing queried.
    const list = screen.getByTestId("qb-value-options");
    expect(within(list.parentElement as HTMLElement).queryByRole("combobox")).toBeNull();
    expect(onQuery).not.toHaveBeenCalled();
  });
});
