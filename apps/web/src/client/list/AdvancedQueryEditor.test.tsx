// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdvancedQueryEditor } from "./AdvancedQueryEditor.tsx";

/**
 * The advanced editor's rendered behaviour (VUE-8, VUE-9, VUE-11,
 * VUE-23, VUE-28, VUE-31..34, A11Y-53).
 *
 * The validation *verdict* is the server's, so it is stubbed here with
 * the exact envelopes `/api/query/validate` was measured to return —
 * see the route's own integration test, which pins those against real
 * core errors. What this file asserts is that four different verdicts
 * render as four visibly different states, and that the marker lands
 * on the right character.
 */

/** The real envelopes, captured from the route against a real tracker. */
const ENVELOPES: Record<string, unknown> = {
  "status = = done": {
    valid: false, kind: "syntax",
    message: 'expected value but got "=" at position 9', position: 9, suggestions: [],
  },
  "assignne = alice": {
    valid: false, kind: "unknown_field",
    message: 'unknown field "assignne" at position 0 — did you mean "assignee"?',
    position: 0, suggestions: ["assignee"],
  },
  "status = frobnik": {
    valid: false, kind: "unknown_value",
    message: 'unknown status value "frobnik" at position 0', position: 0, suggestions: [],
  },
  'text ~ "unclosed': {
    valid: false, kind: "syntax",
    message: "unterminated string at position 7", position: 7, suggestions: [],
  },
  "(status = done and priority = high": {
    valid: false, kind: "syntax",
    message: "unexpected end of query at position 30", position: 30, suggestions: [],
  },
  "status = wont_do": { valid: true },
};

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : String(input);
    if (raw.includes("/api/query/validate")) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { query: string };
      const env = ENVELOPES[body.query] ?? { valid: true };
      return Promise.resolve(new Response(JSON.stringify(env), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  }));
}

/** Renders with a settled validation for `query`. */
async function renderWith(query: string) {
  const onChange = vi.fn();
  render(<AdvancedQueryEditor value={query} onChange={onChange} onSwitchToBasic={() => {}} />);
  await waitFor(() => {
    expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).not.toBe(null);
  });
  return onChange;
}

beforeEach(() => { stubFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("live parse-error markers", () => {
  // @verifies VUE-8
  it("marks an invalid query and clears the marker for a valid one", async () => {
    await renderWith("status = = done");
    await waitFor(() => {
      expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).toBe("syntax");
    });
    cleanup();

    await renderWith("status = wont_do");
    // VUE-28: a valid query that matches nothing is *not* an error —
    // no marker at all, which is what makes the empty state readable
    // as "no matches" rather than "your query is broken".
    await waitFor(() => {
      expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).toBe("none");
    });
    expect(screen.queryByTestId("dsl-error-caret")).toBeNull();
  });

  // @verifies VUE-28
  it("shows no error marker for a well-formed query", async () => {
    await renderWith("status = wont_do");
    expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).toBe("none");
    expect(screen.getByTestId("dsl-input").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("the four error states are distinct", () => {
  // @verifies VUE-31
  // @verifies VUE-32
  // @verifies VUE-33
  it("renders syntax, unknown-field and unknown-value as different kinds", async () => {
    const kinds: string[] = [];
    for (const q of ["status = = done", "assignne = alice", "status = frobnik"]) {
      await renderWith(q);
      await waitFor(() => {
        expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).not.toBe("none");
      });
      kinds.push(screen.getByTestId("dsl-error").getAttribute("data-error-kind") ?? "");
      cleanup();
    }
    // Three distinct messages, not one shared "no results" (VUE-33).
    expect(new Set(kinds).size).toBe(3);
    expect(kinds).toEqual(["syntax", "unknown_field", "unknown_value"]);
  });

  // @verifies VUE-32
  it("suggests a close match for an unknown field", async () => {
    await renderWith("assignne = alice");
    await waitFor(() => {
      expect(screen.getByTestId("dsl-error-suggestions").textContent).toContain("assignee");
    });
    // It says the *field* is unknown, not a generic syntax error.
    expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).toBe("unknown_field");
  });

  // @verifies VUE-31
  it("places the caret at the reported offset, not off by one", async () => {
    await renderWith("status = = done");
    await waitFor(() => { screen.getByTestId("dsl-error-caret"); });
    const caret = screen.getByTestId("dsl-error-caret").textContent ?? "";
    // position 9 is the second "=". The caret must sit under exactly
    // that character — this is the off-by-one the case calls a failure.
    expect(caret.indexOf("^")).toBe(9);
    expect("status = = done".charAt(caret.indexOf("^"))).toBe("=");
  });

  // @verifies VUE-34
  it("reports an unterminated string at its opening position", async () => {
    await renderWith('text ~ "unclosed');
    await waitFor(() => { screen.getByTestId("dsl-error-caret"); });
    const caret = screen.getByTestId("dsl-error-caret").textContent ?? "";
    // Position 7 is the opening quote, not the end of input — the
    // case's whole point is that the user can find the quote.
    expect(caret.indexOf("^")).toBe(7);
    expect('text ~ "unclosed'.charAt(7)).toBe('"');
  });

  // @verifies VUE-34
  it("gives the unbalanced parenthesis a different message from the unterminated string", async () => {
    await renderWith('text ~ "unclosed');
    // Wait for the *message* to land, not merely for the container:
    // an empty container equals an empty container, and the assertion
    // below would pass on two blanks while asserting nothing.
    await waitFor(() => {
      expect(screen.getByTestId("dsl-error").textContent ?? "").not.toBe("");
    });
    const a = screen.getByTestId("dsl-error").textContent ?? "";
    cleanup();
    await renderWith("(status = done and priority = high");
    await waitFor(() => {
      expect(screen.getByTestId("dsl-error").textContent ?? "").not.toBe("");
    });
    const b = screen.getByTestId("dsl-error").textContent ?? "";
    expect(a).not.toBe("");
    // Distinct and specific, not a shared generic parse failure.
    expect(a).not.toEqual(b);
    expect(a).toMatch(/unterminated/i);
  });
});

describe("the error is conveyed without the highlight", () => {
  // @verifies A11Y-53
  it("names the offending token as text and ties the message to the input", async () => {
    await renderWith("assignne = alice");
    await waitFor(() => { screen.getByTestId("dsl-error-token"); });

    // The non-colour equivalent: the token itself, in words.
    expect(screen.getByTestId("dsl-error-token").textContent).toContain("assignne");

    const input = screen.getByTestId("dsl-input");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Associated with the input, so it reads as the field's error.
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBe(screen.getByTestId("dsl-error").getAttribute("id"));

    // Announced politely — not on every keystroke.
    expect(screen.getByTestId("dsl-error").getAttribute("aria-live")).toBe("polite");
  });
});

describe("the basic toggle", () => {
  // @verifies VUE-11
  it("is disabled with a stated reason for a nested disjunction", () => {
    render(
      <AdvancedQueryEditor
        value="(status = done or priority = high) and assignee = alice"
        onChange={() => {}}
        onSwitchToBasic={() => {}}
      />,
    );
    // toHaveJSProperty-equivalent: read the DOM property directly.
    // `toBeDisabled()` retargets inside a <label>, so the property is
    // the honest check.
    const btn = screen.getByTestId<HTMLButtonElement>("switch-to-basic");
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("switch-to-basic-reason").textContent ?? "").toMatch(/or/i);
  });

  // @verifies VUE-11
  it("is enabled for an expressible query and hands back the filters", () => {
    const onSwitch = vi.fn();
    render(
      <AdvancedQueryEditor
        value="status in (backlog, done) and assignee = alice"
        onChange={() => {}}
        onSwitchToBasic={onSwitch}
      />,
    );
    const btn = screen.getByTestId<HTMLButtonElement>("switch-to-basic");
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("switch-to-basic-reason")).toBeNull();

    fireEvent.click(btn);
    expect(onSwitch).toHaveBeenCalledWith({
      status: ["backlog", "done"],
      assignee: ["alice"],
    });
  });
});

describe("syntax help", () => {
  // @verifies VUE-9
  it("opens, dismisses on Esc, and does not discard the query in progress", () => {
    const onChange = vi.fn();
    render(
      <AdvancedQueryEditor value="status = wont_do" onChange={onChange} onSwitchToBasic={() => {}} />,
    );
    expect(screen.queryByTestId("dsl-help-popover")).toBeNull();

    fireEvent.click(screen.getByTestId("dsl-help-toggle"));
    const pop = screen.getByTestId("dsl-help-popover");
    expect(pop).toBeTruthy();
    // It documents the grammar, including the two relationship calls.
    expect(pop.textContent ?? "").toContain("has_link");
    expect(pop.textContent ?? "").toContain("link_count");
    expect(pop.textContent ?? "").toContain("status.category");

    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByTestId("dsl-help-popover")).toBeNull();

    // The query survives: the box still holds it and nothing cleared it.
    expect(screen.getByTestId<HTMLTextAreaElement>("dsl-input").value)
      .toBe("status = wont_do");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a very long query", () => {
  // @verifies VUE-23
  it("keeps a 2,000-character query intact and unclipped", () => {
    const long = `${"status = wont_do or ".repeat(120)}status = wont_do`;
    expect(long.length).toBeGreaterThan(2000);
    render(<AdvancedQueryEditor value={long} onChange={() => {}} onSwitchToBasic={() => {}} />);

    const box = screen.getByTestId<HTMLTextAreaElement>("dsl-input");
    // Not truncated on the way in, and no maxLength to truncate on save.
    expect(box.value).toBe(long);
    expect(box.value.length).toBe(long.length);
    expect(box.getAttribute("maxlength")).toBeNull();
  });
});

describe("keyboard operation", () => {
  // @verifies VUE-29
  it("runs on Ctrl/Cmd-Enter but leaves plain Enter to the textarea", () => {
    const onRun = vi.fn();
    render(
      <AdvancedQueryEditor
        value="status = wont_do" onChange={() => {}} onRun={onRun} onClose={() => {}}
      />,
    );
    const box = screen.getByTestId("dsl-input");

    // Plain Enter must stay available: the box holds multi-line
    // queries, so hijacking it would make them unwritable.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  // @verifies VUE-29
  it("the run action is reachable by keyboard, not mouse-only", () => {
    render(
      <AdvancedQueryEditor value="status = wont_do" onChange={() => {}} onRun={() => {}} />,
    );
    const run = screen.getByTestId("dsl-run");
    // A <button> is focusable and Enter/Space-activatable by default;
    // a div-with-onClick would not be, which is the failure mode.
    expect(run.tagName).toBe("BUTTON");
    expect(run.getAttribute("disabled")).toBeNull();
  });

  // @verifies VUE-29
  it("Esc closes immediately when clean, but warns first when dirty", () => {
    const onCloseClean = vi.fn();
    const { unmount } = render(
      <AdvancedQueryEditor
        value="status = wont_do" onChange={() => {}} onClose={onCloseClean} dirty={false}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("dsl-input"), { key: "Escape" });
    expect(onCloseClean).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dsl-close-confirm")).toBeNull();
    unmount();

    const onCloseDirty = vi.fn();
    render(
      <AdvancedQueryEditor
        value="status = wont_do" onChange={() => {}} onClose={onCloseDirty} dirty={true}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("dsl-input"), { key: "Escape" });
    // Warned, not closed — the work is not discarded silently.
    expect(onCloseDirty).not.toHaveBeenCalled();
    expect(screen.getByTestId("dsl-close-confirm")).toBeTruthy();

    // And the user can still get out deliberately.
    fireEvent.click(screen.getByTestId("dsl-close-discard"));
    expect(onCloseDirty).toHaveBeenCalledTimes(1);
  });

  // @verifies VUE-29
  it("keeps editing when the unsaved-changes warning is declined", () => {
    const onClose = vi.fn();
    render(
      <AdvancedQueryEditor
        value="status = wont_do" onChange={() => {}} onClose={onClose} dirty={true}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("dsl-input"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("dsl-close-keep"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dsl-close-confirm")).toBeNull();
    // The query survives the near-miss.
    expect(screen.getByTestId<HTMLTextAreaElement>("dsl-input").value)
      .toBe("status = wont_do");
  });

  // @verifies VUE-29
  it("does not steal focus when an error marker appears mid-keystroke", async () => {
    render(
      <AdvancedQueryEditor value="status = = done" onChange={() => {}} onRun={() => {}} />,
    );
    const box = screen.getByTestId("dsl-input");
    box.focus();
    expect(document.activeElement).toBe(box);

    await waitFor(() => {
      expect(screen.getByTestId("dsl-error").getAttribute("data-error-kind")).toBe("syntax");
    });
    // The marker appeared; focus stayed in the box the user is typing in.
    expect(document.activeElement).toBe(box);
  });
});
