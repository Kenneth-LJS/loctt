// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilePicker } from "./FilePicker.tsx";

afterEach(cleanup);

function file(name: string): File {
  return new File(["x"], name, { type: "text/plain" });
}

describe("FilePicker", () => {
  it("renders a plain-node child inside a default Button, which opens the hidden input", () => {
    const onFiles = vi.fn();
    render(
      <FilePicker onFiles={onFiles} testId="fp-input" triggerTestId="fp-trigger">
        Choose file
      </FilePicker>,
    );
    const trigger = screen.getByTestId("fp-trigger");
    // The default form is a real <button>, not a styled div — required
    // for the input to stay reachable by click AND by keyboard.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.textContent).toBe("Choose file");

    // getByTestId is typed HTMLElement under tsc --build, so `.type`
    // below needs the input type; eslint's own TS program resolves it
    // differently and flags the cast as unnecessary (same known
    // disagreement documented in BackupPanel.test.tsx).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const input = screen.getByTestId("fp-input") as HTMLInputElement;
    expect(input.type).toBe("file");
    // Off-screen, not display:none/hidden — stays in the tab order.
    expect(input.className).toContain("sr-only");
    expect(input.hasAttribute("hidden")).toBe(false);
    expect(input.hasAttribute("aria-hidden")).toBe(false);
  });

  it("renders a render-function child's own element, called with the current state", () => {
    const onFiles = vi.fn();
    render(
      <FilePicker onFiles={onFiles} testId="fp-input">
        {(state) => (
          <a data-testid="fp-custom-trigger" href="#" onClick={(e) => { e.preventDefault(); state.open(); }}>
            {state.hasFile ? `Selected: ${state.filename}` : "Pick one"}
          </a>
        )}
      </FilePicker>,
    );
    // The caller's own element renders, not a wrapping Button — proves
    // the "meta" contract: a function child controls its own markup.
    const custom = screen.getByTestId("fp-custom-trigger");
    expect(custom.tagName).toBe("A");
    expect(custom.textContent).toBe("Pick one");
    // No default Button rendered alongside it.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("selecting a file surfaces the filename via FilePickerState, for a plain-child caller too", () => {
    const onFiles = vi.fn();
    let seenFilename: string | undefined;
    render(
      <FilePicker onFiles={onFiles} testId="fp-input">
        {(state) => {
          seenFilename = state.filename;
          return <button type="button" data-testid="fp-trigger" onClick={state.open}>{state.filename ?? "Choose"}</button>;
        }}
      </FilePicker>,
    );
    expect(seenFilename).toBeUndefined();
    const input = screen.getByTestId("fp-input");
    fireEvent.change(input, { target: { files: [file("backup.jsonl")] } });
    expect(screen.getByTestId("fp-trigger").textContent).toBe("backup.jsonl");
    expect(onFiles).toHaveBeenCalledTimes(1);
    const [firstCallArgs] = onFiles.mock.calls;
    const list = firstCallArgs?.[0] as FileList;
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("backup.jsonl");
  });

  it("calls onFiles(null) and clears filename when the selection is cleared", () => {
    const onFiles = vi.fn();
    render(
      <FilePicker onFiles={onFiles} testId="fp-input">
        {(state) => <span data-testid="fp-state">{state.hasFile ? state.filename : "none"}</span>}
      </FilePicker>,
    );
    const input = screen.getByTestId("fp-input");
    fireEvent.change(input, { target: { files: [file("a.txt")] } });
    expect(screen.getByTestId("fp-state").textContent).toBe("a.txt");

    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByTestId("fp-state").textContent).toBe("none");
    expect(onFiles).toHaveBeenLastCalledWith(null);
  });

  it("clears the input's value property after a selection (AttachmentsPanel's prior behaviour, preserved) so the browser lets the same file be re-picked", () => {
    // jsdom already reports `""` for a file input's `.value` before any
    // explicit clear (unlike a real browser, which keeps a fakepath
    // string until cleared) — so this cannot assert against the DOM
    // state alone. It instead replaces the instance's own `value`
    // accessor to record every write FilePicker's onChange handler
    // performs, which is the actual behaviour a real browser depends on
    // to accept the same filename twice in a row.
    const onFiles = vi.fn();
    render(<FilePicker onFiles={onFiles} testId="fp-input">Choose</FilePicker>);
    const input = screen.getByTestId("fp-input");
    const writes: string[] = [];
    let backing: string = (input as HTMLInputElement).value;
    Object.defineProperty(input, "value", {
      configurable: true,
      get: (): string => backing,
      set: (v: string) => { writes.push(v); backing = v; },
    });
    fireEvent.change(input, { target: { files: [file("a.txt")] } });
    expect(writes).toContain("");
  });

  it("forwards multiple/accept/disabled to the hidden input", () => {
    render(
      <FilePicker onFiles={() => {}} testId="fp-input" multiple accept=".jsonl" disabled>
        Choose
      </FilePicker>,
    );
    // Same tsc/eslint disagreement as above — see that comment.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const input = screen.getByTestId("fp-input") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".jsonl");
    expect(input.disabled).toBe(true);
  });
});
