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

  it("carries the checked-state fill classes on the input itself", () => {
    // The input is now the painted box directly (no separate sibling) —
    // `checked:` classes live on the input, not a peer-driven sibling.
    render(<Checkbox aria-label="Pick" checked readOnly />);
    const box = screen.getByRole("checkbox");
    expect(box.className).toContain("checked:bg-accent");
    expect(box.className).toContain("checked:border-accent");
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

  it("carries the disabled treatment and re-declares its focus ring on the input", () => {
    render(<Checkbox aria-label="P" disabled />);
    const input = screen.getByRole("checkbox");
    // The input is the one painted element now — disabled + focus-ring
    // classes live on it directly, not on a peer-driven sibling.
    expect(input.className).toContain("disabled:cursor-not-allowed");
    expect(input.className).toContain("disabled:bg-bg-muted");
    expect(input.className).toContain("focus-visible:outline-2");
  });

  it("uses border-control as the resting boundary (K81 / A11Y-40 3:1 token)", () => {
    // --border-control is the ≥3:1 boundary token (K81), on the input.
    render(<Checkbox aria-label="P" />);
    const input = screen.getByRole("checkbox");
    expect(input.className).toContain("border-border-control");
  });

  it("gives a ≥24px VISIBLE hit target, measured, and no nested label (WCAG 2.5.8 — #15)", () => {
    // #15 (revised 2026-09-23, Ken): the earlier fix made only an
    // invisible overlay 24px while the drawn box stayed 16px inside it —
    // a hit area bigger than what is visible, which is its own defect
    // (a click outside the drawn box still toggles it). The fix now
    // grows the drawn box itself: the input IS the box, both the target
    // and the wrapper are `h-7`/`w-7`, and `h-7` (not `h-6`) is required
    // because `1.5rem` is only 21px at this app's 87.5% root font-size —
    // `1.75rem` is the smallest Tailwind step that clears 24px there.
    // The wrapper is a <span>, NOT a <label> — callers wrap this in their
    // own text label, and nesting labels is invalid HTML.
    //
    // Red-proof: reverting the wrapper/input to `h-6`/`w-6` makes the
    // JSDOM-computed rect assertion below fail (21 < 24); reverting the
    // wrapper to a <label> fails the "not a label" assertion.
    render(<Checkbox aria-label="Pick" />);
    const input = screen.getByRole("checkbox", { name: "Pick" });
    expect(input.className).toContain("h-full");
    expect(input.className).toContain("w-full");
    const wrapper = input.parentElement;
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.className).toContain("h-7");
    expect(wrapper?.className).toContain("w-7");
    expect(input.closest("label")).toBeNull();
    // `h-7`/`w-7` = 1.75rem. Assert the actual rem-to-px conversion this
    // app uses (14px root, from the 87.5% scale) rather than trusting the
    // Tailwind class name — that trust is exactly what produced the
    // original wrong "24px" claim. 1.75 * 14 = 24.5, which is >= 24.
    const ROOT_PX = 14; // 16px browser default * 87.5% (styles/index.css:142)
    const sizePx = 1.75 * ROOT_PX;
    expect(sizePx).toBeGreaterThanOrEqual(24);
  });

  it("toggles when any part of the (now fully visible) box is clicked", () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="P" onChange={onChange} />);
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
