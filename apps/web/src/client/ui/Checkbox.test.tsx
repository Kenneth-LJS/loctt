// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./Checkbox.tsx";
import { Radio } from "./Radio.tsx";
import { Toggle } from "./Toggle.tsx";

afterEach(cleanup);

/**
 * Narrow a queried element to the real `<input>`.
 *
 * `screen.getByRole` returns `HTMLElement`; the input-specific props
 * (`type`, `checked`, `indeterminate`) live on `HTMLInputElement`. An
 * `as` cast is read as "unnecessary" by the eslint TS service but IS
 * needed by `tsc --build` (the two resolve the lib subtly differently),
 * so a runtime `instanceof` narrow is the one form both tools accept —
 * and it also asserts the element really is an input.
 */
function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`expected an <input>, got <${el.tagName.toLowerCase()}>`);
  }
  return el;
}

/**
 * The checkbox/radio/toggle keep the REAL native <input> painted with
 * appearance-none (Ken flagged native controls, but a <div role> would
 * drop Space-to-toggle, indeterminate, name grouping). Each test below
 * would fail if the primitive were a bare native element (no
 * appearance-none, no themed classes) OR if it dropped a native
 * behaviour (checked toggling, indeterminate, name grouping, testid
 * passthrough) — the two failure modes the spec names.
 */

describe("Checkbox", () => {
  it("is a native checkbox input painted appearance-none (not a div)", () => {
    render(<Checkbox aria-label="Pick" />);
    const box = screen.getByRole("checkbox", { name: "Pick" });
    expect(box.tagName).toBe("INPUT");
    expect(asInput(box).type).toBe("checkbox");
    // Would fail for a bare native checkbox — the whole restyle is this.
    expect(box.className).toContain("appearance-none");
  });

  it("carries the checked-state fill classes on the painted box", () => {
    // The state styling lives on the painted 16px box (a sibling of the
    // input), mirrored from the input via `peer-checked:` — the input
    // itself is now the transparent 24px hit layer.
    const { container } = render(<Checkbox aria-label="Pick" checked readOnly />);
    const box = container.querySelector('span[aria-hidden="true"]');
    expect(box?.className).toContain("peer-checked:bg-accent");
    expect(box?.className).toContain("peer-checked:border-accent");
  });

  it("shows a tick only when checked and a dash only when indeterminate", () => {
    const { rerender } = render(<Checkbox aria-label="P" />);
    expect(screen.queryByText("✓")).toBeNull();
    expect(screen.queryByText("–")).toBeNull();

    rerender(<Checkbox aria-label="P" checked readOnly />);
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.queryByText("–")).toBeNull();

    rerender(<Checkbox aria-label="P" indeterminate />);
    // Indeterminate wins the glyph even if not checked.
    expect(screen.getByText("–")).toBeTruthy();
  });

  it("sets the DOM indeterminate PROPERTY (BLK-3 select-all header)", () => {
    render(<Checkbox aria-label="all" indeterminate />);
    const box = asInput(screen.getByRole("checkbox"));
    // indeterminate is a property, not an attribute — asserting it proves
    // the ref effect ran. A bare checkbox with only the attr would be
    // false here.
    expect(box.indeterminate).toBe(true);
  });

  it("clears the indeterminate property when it flips to all-checked", () => {
    const { rerender } = render(<Checkbox aria-label="all" indeterminate />);
    const box = asInput(screen.getByRole("checkbox"));
    expect(box.indeterminate).toBe(true);
    rerender(<Checkbox aria-label="all" checked readOnly />);
    expect(box.indeterminate).toBe(false);
  });

  it("still toggles natively via change (Space key path)", () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="P" onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("carries the disabled treatment on the box and re-declares its focus ring", () => {
    const { container } = render(<Checkbox aria-label="P" disabled />);
    const input = screen.getByRole("checkbox");
    // The transparent input owns the not-allowed cursor.
    expect(input.className).toContain("disabled:cursor-not-allowed");
    const box = container.querySelector('span[aria-hidden="true"]');
    // The painted box mirrors disabled + the focus ring (appearance-none
    // removed the UA outline, so it reattaches one, peer-driven).
    expect(box?.className).toContain("peer-disabled:bg-bg-muted");
    expect(box?.className).toContain("peer-focus-visible:outline-2");
  });

  it("uses border-control as the resting boundary (K81 / A11Y-40 3:1 token)", () => {
    // --border-control is the ≥3:1 boundary token (K81). It lives on the
    // painted box now, not the transparent input.
    const { container } = render(<Checkbox aria-label="P" />);
    const box = container.querySelector('span[aria-hidden="true"]');
    expect(box?.className).toContain("border-border-control");
  });

  it("gives a ≥24px hit target with a 16px painted box, and no nested label (WCAG 2.5.8 — #15)", () => {
    // The real input fills a 24px wrapper transparently (the hit target);
    // the painted box is a 16px sibling. The wrapper is a <span>, NOT a
    // <label> — callers wrap this in their own text label, and nesting
    // labels is invalid HTML. Red-proof: reverting to the label wrapper
    // fails the "not a label" assertion; a 16px input fails the 24px one.
    const { container } = render(<Checkbox aria-label="Pick" />);
    const input = screen.getByRole("checkbox", { name: "Pick" });
    // The input is the full-size hit layer.
    expect(input.className).toContain("h-full");
    expect(input.className).toContain("w-full");
    // The 24px wrapper is a span, not a label.
    const wrapper = input.parentElement;
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.className).toContain("h-6");
    expect(wrapper?.className).toContain("w-6");
    expect(input.closest("label")).toBeNull();
    // The painted box is 16px.
    const box = container.querySelector('span[aria-hidden="true"]');
    expect(box?.className).toContain("h-4");
    expect(box?.className).toContain("w-4");
  });

  it("toggles when the 24px slop (not just the 16px glyph) is clicked", () => {
    // The input itself fills the 24px square, so a click anywhere in the
    // wrapper lands on the input and toggles it. Red-proof: a 16px input
    // would leave the surrounding slop dead.
    const onChange = vi.fn();
    render(<Checkbox aria-label="P" onChange={onChange} />);
    // The input IS the 24px target; clicking it is clicking the slop.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards the caller onClick to the input so row-nav guards catch clicks", () => {
    // The list row's `onClick={e => e.stopPropagation()}` fires on the
    // full-size input, which spans the whole 24px target. Red-proof:
    // dropping the onClick passthrough misses it.
    const onClick = vi.fn();
    render(<Checkbox aria-label="P" onClick={onClick} readOnly />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onClick).toHaveBeenCalled();
  });

  it("passes data-testid through to the input (mandatory for the form suite)", () => {
    render(<Checkbox aria-label="P" data-testid="estimation-enabled" />);
    const el = screen.getByTestId("estimation-enabled");
    expect(el.tagName).toBe("INPUT");
  });

  it("forwards ref to the input alongside its own indeterminate ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox aria-label="P" ref={ref} indeterminate />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.indeterminate).toBe(true);
  });
});

describe("Radio", () => {
  it("is a native radio input painted appearance-none", () => {
    render(<Radio aria-label="A" name="g" value="a" />);
    const r = screen.getByRole("radio", { name: "A" });
    expect(r.tagName).toBe("INPUT");
    expect(asInput(r).type).toBe("radio");
    expect(r.className).toContain("appearance-none");
  });

  it("keeps name grouping so one selection clears the sibling", () => {
    render(
      <>
        <Radio aria-label="A" name="grp" value="a" defaultChecked />
        <Radio aria-label="B" name="grp" value="b" />
      </>,
    );
    const a = asInput(screen.getByRole("radio", { name: "A" }));
    const b = asInput(screen.getByRole("radio", { name: "B" }));
    expect(a.checked).toBe(true);
    fireEvent.click(b);
    // Native grouping via `name` — would fail if name were dropped.
    expect(b.checked).toBe(true);
    expect(a.checked).toBe(false);
  });

  it("draws the inner dot via a thick accent border when checked", () => {
    render(<Radio aria-label="A" name="g" value="a" />);
    const cls = screen.getByRole("radio").className;
    expect(cls).toContain("checked:border-[5px]");
    expect(cls).toContain("checked:border-accent");
    expect(cls).toContain("rounded-full");
  });

  it("passes data-testid through", () => {
    render(<Radio aria-label="A" name="g" value="a" data-testid="backup-mode-git" />);
    expect(screen.getByTestId("backup-mode-git").tagName).toBe("INPUT");
  });
});

describe("Toggle", () => {
  it("is a native checkbox with role=switch (A11Y-21 announcement)", () => {
    render(<Toggle aria-label="Show archived" />);
    const sw = screen.getByRole("switch", { name: "Show archived" });
    expect(sw.tagName).toBe("INPUT");
    expect(asInput(sw).type).toBe("checkbox");
  });

  it("carries the checked track colour and appearance-none track", () => {
    render(<Toggle aria-label="x" />);
    const cls = screen.getByRole("switch").className;
    expect(cls).toContain("appearance-none");
    expect(cls).toContain("checked:bg-accent");
    expect(cls).toContain("rounded-full");
  });

  it("toggles natively and passes testId through", () => {
    const onChange = vi.fn();
    render(<Toggle aria-label="x" onChange={onChange} data-testid="timeline-arrows" />);
    fireEvent.click(screen.getByTestId("timeline-arrows"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
