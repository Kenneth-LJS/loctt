// @vitest-environment jsdom
import { type BuilderTree,builderTreeToQuery } from "@loctt/core/query/builderTree.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
function optionValues(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map(o => (o as HTMLOptionElement).value);
}

describe("QueryBuilder", () => {
  it("builds a two-condition AND query with the right q", () => {
    const b = renderBuilder();

    // Add two conditions to the root AND group.
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // Row 0: status = done (enum dropdown).
    fireEvent.change(nth("qb-field", 0), { target: { value: "status" } });
    fireEvent.change(nth("qb-op", 0), { target: { value: "=" } });
    fireEvent.change(nth("qb-value", 0), { target: { value: "done" } });

    // Row 1: title ~ "log in" — a value with a space, which dslAtom
    // quotes (a bare word would round-trip unquoted).
    fireEvent.change(nth("qb-field", 1), { target: { value: "title" } });
    fireEvent.change(nth("qb-op", 1), { target: { value: "~" } });
    fireEvent.change(nth("qb-value", 1), { target: { value: "log in" } });

    expect(b.q()).toBe('status = done and title ~ "log in"');
  });

  it("switches the group operator AND↔OR and it lands in q", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.change(nth("qb-field", 0), { target: { value: "status" } });
    fireEvent.change(nth("qb-value", 0), { target: { value: "todo" } });
    fireEvent.change(nth("qb-field", 1), { target: { value: "status" } });
    fireEvent.change(nth("qb-value", 1), { target: { value: "done" } });

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
    fireEvent.change(nth("qb-field", 0), { target: { value: "status" } });

    // The value control is a <select> offering only the two configured
    // statuses (plus the blank placeholder) — not a free text input.
    const valueEl = nth("qb-value", 0);
    expect(valueEl.tagName).toBe("SELECT");
    expect(optionValues(valueEl).filter(v => v.length > 0)).toEqual(["todo", "done"]);

    fireEvent.change(valueEl, { target: { value: "done" } });
    expect(b.q()).toBe("status = done");
  });

  it("hides the value control for `is empty`", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.change(nth("qb-field", 0), { target: { value: "assignee" } });
    fireEvent.change(nth("qb-op", 0), { target: { value: "is empty" } });

    expect(screen.queryByTestId("qb-value")).toBeNull();
    expect(b.q()).toBe("assignee is empty");
  });

  it("filters the op picker by field kind", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // Text field: offers `~`, not ordering.
    fireEvent.change(nth("qb-field", 0), { target: { value: "title" } });
    expect(optionValues(nth("qb-op", 0))).toContain("~");
    expect(optionValues(nth("qb-op", 0))).not.toContain("<");

    // Enum field: offers membership, not `~`.
    fireEvent.change(nth("qb-field", 0), { target: { value: "status" } });
    expect(optionValues(nth("qb-op", 0))).toContain("in");
    expect(optionValues(nth("qb-op", 0))).not.toContain("~");

    // Date field: offers ordering.
    fireEvent.change(nth("qb-field", 0), { target: { value: "due_date" } });
    expect(optionValues(nth("qb-op", 0))).toContain("<");
  });

  // @verifies QBLD-5
  it("narrows the `text` alias field to ONLY ~ (F3 — the validator rejects everything else)", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // The `text` alias (title + body substring) accepts only `~` in the
    // validator — so the builder offers only `~`, never =/!=/is empty,
    // which it would otherwise inherit from the `text` KIND.
    fireEvent.change(nth("qb-field", 0), { target: { value: "text" } });
    expect(optionValues(nth("qb-op", 0))).toEqual(["~"]);

    // The sibling `title` field (same KIND, no per-field override) keeps
    // the full string set — proof the narrowing is field-specific, not a
    // regression of the whole `text` kind.
    fireEvent.change(nth("qb-field", 0), { target: { value: "title" } });
    expect(optionValues(nth("qb-op", 0))).toContain("=");
    expect(optionValues(nth("qb-op", 0))).toContain("is empty");
  });

  // @verifies QBLD-5
  it("narrows `comment_mentions` to =/!=/in/not in — no presence or ordering (F4 / CMT-10)", () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    fireEvent.change(nth("qb-field", 0), { target: { value: "comment_mentions" } });
    const ops = optionValues(nth("qb-op", 0));
    expect(ops).toEqual(["=", "!=", "in", "not in"]);
    // Explicitly: the presence ops its `user` kind would offer are gone.
    expect(ops).not.toContain("is empty");
    expect(ops).not.toContain("is not empty");
    expect(ops).not.toContain("<");
  });

  it("builds an `in (…)` list from constrained checkboxes", () => {
    const b = renderBuilder();
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.change(nth("qb-field", 0), { target: { value: "status" } });
    fireEvent.change(nth("qb-op", 0), { target: { value: "in" } });

    fireEvent.click(screen.getByTestId("qb-value-opt-todo"));
    fireEvent.click(screen.getByTestId("qb-value-opt-done"));
    expect(b.q()).toBe("status in (todo, done)");
  });
});
