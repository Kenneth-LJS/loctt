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

  it("carries the checked-state fill classes", () => {
    render(<Checkbox aria-label="Pick" checked readOnly />);
    const cls = screen.getByRole("checkbox").className;
    expect(cls).toContain("checked:bg-accent");
    expect(cls).toContain("checked:border-accent");
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

  it("carries the disabled treatment and re-declares its focus ring", () => {
    render(<Checkbox aria-label="P" disabled />);
    const cls = screen.getByRole("checkbox").className;
    expect(cls).toContain("disabled:cursor-not-allowed");
    expect(cls).toContain("disabled:bg-bg-muted");
    // appearance-none removed the UA outline, so it must reattach one.
    expect(cls).toContain("focus-visible:outline-2");
  });

  it("uses border-strong as the resting boundary (A11Y-40 3:1 token)", () => {
    render(<Checkbox aria-label="P" />);
    expect(screen.getByRole("checkbox").className).toContain(
      "border-border-strong",
    );
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
