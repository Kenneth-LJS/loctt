// @vitest-environment jsdom
import type { ErrorResponse } from "@loctt/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client.ts";
import type { ReconcileConflict, ReconcileDeleteVsEdit, RekeyPlan } from "../api/hooks/useGit.ts";
import { ConflictRow, DeleteVsEditRow, RekeyPreview } from "./ReconcilePanel.tsx";

/**
 * @verifies Batch-2 a11y (ReconcilePanel pick-value control label)
 *
 * The pick-value control had no accessible name — the field name beside
 * it was a plain `<div>` with no `id`, so neither control was associated
 * with it. This wires the field-name element via `useId()` +
 * `aria-labelledby`, so the control announces the field it belongs to.
 *
 * A211/A242: the enum picker became a searchable `ui/Combobox` over the
 * growable value set. Its trigger is a `<button>` (role "button", not
 * "combobox") that forwards `aria-labelledby` — so the accessible-name
 * assertion below targets the button role. The scalar path is still a
 * free-text `<input>` (role "textbox"), unchanged.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function enumConflict(): ReconcileConflict {
  return {
    taskId: "01ABC",
    taskKey: "T-1",
    taskTitle: "Some task",
    field: "status",
    fieldLabel: "Status",
    kind: "enum",
    local: { raw: "Todo", display: "Todo" },
    remote: { raw: "Doing", display: "Doing" },
    options: [
      { key: "todo", label: "Todo" },
      { key: "doing", label: "Doing" },
    ],
  };
}

function scalarConflict(): ReconcileConflict {
  return {
    taskId: "01ABC",
    taskKey: "T-1",
    taskTitle: "Some task",
    field: "title",
    fieldLabel: "Title",
    kind: "scalar",
    local: { raw: "Local title", display: "Local title" },
    remote: { raw: "Remote title", display: "Remote title" },
  };
}

describe("ReconcilePanel pick-value control has an accessible name", () => {
  it("labels the enum picker with the field name", () => {
    render(<ConflictRow conflict={enumConflict()} decision={undefined} onChoose={() => {}} />);
    // The enum picker is now a Combobox whose trigger is a <button>
    // (role "button") naming itself via aria-labelledby. getByRole with a
    // name only matches when the control has an accessible name — which
    // is exactly the aria-labelledby association under test. Anchoring on
    // the pick-value testid keeps this off the side buttons.
    const trigger = screen.getByRole("button", { name: "Status" });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("data-testid")).toBe("git-reconcile-pick-value");
  });

  it("selecting an enum option through the Combobox records the value", () => {
    const onChoose = vi.fn();
    render(<ConflictRow conflict={enumConflict()} decision={undefined} onChoose={onChoose} />);
    // Opens as a Combobox: click the trigger, then click an option by its
    // per-value testid, and the value is recorded via onChoose("value", …).
    fireEvent.click(screen.getByTestId("git-reconcile-pick-value"));
    fireEvent.click(screen.getByTestId("git-reconcile-pick-value-option-doing"));
    expect(onChoose).toHaveBeenCalledWith("value", "doing");
  });

  it("labels the scalar free-text input with the field name", () => {
    render(<ConflictRow conflict={scalarConflict()} decision={undefined} onChoose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toBeDefined();
  });
});

/**
 * @verifies GIT-16
 *
 * A delete-vs-edit row states which side deleted and which edited, and
 * offers keep-the-deletion / keep-the-task. The chosen side is the winning
 * side: keep-deletion = the deleting side, keep-task = the editing side.
 */
describe("ReconcilePanel delete-vs-edit row (GIT-16)", () => {
  function dveRow(): ReconcileDeleteVsEdit {
    return {
      taskId: "01ABC",
      taskKey: "T-1",
      taskTitle: "Contested",
      deletedSide: "remote",
      editedSide: "local",
    };
  }

  it("names which side deleted and which edited", () => {
    render(<DeleteVsEditRow row={dveRow()} choice={undefined} onChoose={() => {}} />);
    const desc = screen.getByTestId("git-reconcile-dve-desc");
    expect(desc.textContent).toMatch(/deleted on the remote side/);
    expect(desc.textContent).toMatch(/edited on the local side/);
  });

  it("keep-deletion chooses the deleting side; keep-task chooses the editing side", () => {
    const onChoose = vi.fn();
    render(<DeleteVsEditRow row={dveRow()} choice={undefined} onChoose={onChoose} />);
    // deletedSide is "remote" → keep-deletion must report "remote".
    fireEvent.click(screen.getByTestId("git-reconcile-dve-keep-deletion"));
    expect(onChoose).toHaveBeenCalledWith("remote");
    // editedSide is "local" → keep-task must report "local".
    fireEvent.click(screen.getByTestId("git-reconcile-dve-keep-task"));
    expect(onChoose).toHaveBeenCalledWith("local");
  });

  it("marks the chosen keep-task and warns a colliding key will confirm a renumber", () => {
    // choice === editedSide ("local") means keep-task.
    render(<DeleteVsEditRow row={dveRow()} choice="local" onChoose={() => {}} />);
    const decided = screen.getByTestId("git-reconcile-dve-decided");
    expect(decided.textContent).toMatch(/keeping the task/);
    expect(decided.textContent).toMatch(/confirm a renumber/);
  });
});

/**
 * GIT-9: when the two `created_at` values tie, the ULID decides.
 *
 * K116 (error-text-trim row 49, Ken's wording) removed the tiebreak
 * EXPLANATION entirely -- the "same instant, so the tie was broken on the
 * ULID... every clone reaches the same keeper" prose, and the
 * `git-rekey-tiebreak` element it lived in, are gone. What each collision
 * row states instead is simply which task keeps the key and what the
 * other becomes: `{key} stays with task {keeperId}. Task {loserId}
 * becomes {newKey}.` The two tests that asserted the removed explanation
 * text are gone with it (no phrase of that shape exists any more, in
 * either the `created_at` or `ulid` branch) -- this is a deliberate copy
 * cut approved by Ken, not a behavior regression. The ULIDs themselves
 * are still reachable in the collapsed disclosure for the `ulid` branch
 * (GIT-9's determinism still needs to be checkable), which the remaining
 * test below covers.
 */
describe("RekeyPreview — GIT-9's ULID tiebreak", () => {
  const KEEPER = "01AAAAAAAAAAAAAAAAAAAAAAAA";
  const LOSER = "01BBBBBBBBBBBBBBBBBBBBBBBB";

  function plan(tiebreak: "ulid" | "created_at"): RekeyPlan {
    const at = "2000-01-01T00:00:00.000Z";
    return {
      losers: [{
        key: "WEB-14",
        loserId: LOSER,
        loserCreatedAt: at,
        keeperId: KEEPER,
        keeperCreatedAt: tiebreak === "ulid" ? at : "1999-01-01T00:00:00.000Z",
        tiebreak,
        newKey: "WEB-15",
      }],
      skipped: [],
    };
  }

  /** `useConfirmRekey`'s result, reduced to what RekeyPreview reads. */
  const idleConfirm = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as Parameters<typeof RekeyPreview>[0]["confirm"];

  const renderPlan = (tiebreak: "ulid" | "created_at") =>
    render(<RekeyPreview plan={plan(tiebreak)} confirm={idleConfirm} onConfirmed={() => {}} />);

  // @verifies GIT-8/GIT-9
  it("states which task keeps the key and what the loser becomes, for both tiebreak branches", () => {
    renderPlan("ulid");
    const row = screen.getByTestId("git-rekey-row");
    expect(row.textContent).toMatch(/stays with task/);
    expect(row.textContent).toContain(KEEPER);
    expect(row.textContent).toMatch(/becomes/);
    expect(row.textContent).toContain(LOSER);
    expect(row.textContent).toContain("WEB-15");
  });

  // @verifies GIT-9
  it("GIT-9: shows BOTH ULIDs, labelled by which one kept the key", () => {
    renderPlan("ulid");
    const keeper = screen.getByTestId("git-rekey-keeper-id");
    const loser = screen.getByTestId("git-rekey-loser-id");
    expect(keeper.textContent).toBe(KEEPER);
    expect(loser.textContent).toBe(LOSER);
    // Each is labelled by its outcome — two bare ULIDs side by side do
    // not say which one won, which is the whole question.
    const dl = keeper.closest("dl") as HTMLElement;
    expect((dl.textContent ?? "")).toMatch(/Keeps the key/);
    expect((dl.textContent ?? "")).toMatch(/Renumbered/);
  });

  // @verifies GIT-8
  it("GIT-8: a created_at decision does not show the ULID disclosure", () => {
    // The complement: when the timestamps DID decide, the ULIDs explain
    // nothing, and Ken's report removed them from the ordinary path.
    renderPlan("created_at");
    expect(screen.queryByTestId("git-rekey-ulids")).toBeNull();
  });

  /**
   * @verifies B8
   *
   * Before this, a failed rekey confirm showed the raw
   * `confirm.error.message` as the whole notice — no data-state claim, no
   * next action, and the server's own words presented directly to the
   * user (a messaging.md violation). This turns on the fixed "what
   * happened" sentence, the data-state line, Try again gated on the
   * envelope's own recovery, and the raw message demoted into a
   * Disclosure.
   *
   * Red-proof: replace the `InlineFailureNotice`/`Disclosure` block with
   * the old `<p>{confirm.error.message}</p>` and every assertion below
   * goes red — there is no `git-rekey-confirm-error` node, and the raw
   * "boom" string shows up as the notice's own text instead of inside
   * the disclosure.
   */
  function confirmError(overrides: Partial<ErrorResponse> = {}) {
    const envelope: ErrorResponse = { code: "git_failed", message: "boom", ...overrides };
    return new ApiError("boom", { status: 500, body: envelope, endpoint: "/api/git/reconcile/confirm-rekey", envelope });
  }

  function erroredConfirm(error: unknown) {
    return {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    } as unknown as Parameters<typeof RekeyPreview>[0]["confirm"];
  }

  describe("RekeyPreview — confirm failure notice (B8)", () => {
    it("shows the fixed headline and the data-state claim, never the raw message as the whole text", () => {
      render(
        <RekeyPreview
          plan={plan("ulid")}
          confirm={erroredConfirm(confirmError({ data_state: "not_saved" }))}
          onConfirmed={() => {}}
        />,
      );

      const notice = screen.getByTestId("git-rekey-confirm-error");
      expect(notice.getAttribute("role")).toBe("alert");
      expect(notice.textContent).toContain("Renumbering didn't finish.");
      // The raw server text is NOT the notice's own text.
      const message = screen.getByTestId("git-rekey-confirm-error-message");
      expect(message.textContent).not.toContain("boom");
    });

    it("carries the envelope's data_state on the notice, distinguishing unknown from not_saved", () => {
      render(
        <RekeyPreview
          plan={plan("ulid")}
          confirm={erroredConfirm(confirmError({ data_state: "unknown" }))}
          onConfirmed={() => {}}
        />,
      );
      const notice = screen.getByTestId("git-rekey-confirm-error");
      expect(notice.getAttribute("data-data-state")).toBe("unknown");
    });

    it("offers Try again only when the envelope's recovery says retry is safe", () => {
      const { rerender } = render(
        <RekeyPreview
          plan={plan("ulid")}
          confirm={erroredConfirm(confirmError({ recovery: { kind: "retry" } }))}
          onConfirmed={() => {}}
        />,
      );
      expect(screen.getByTestId("git-rekey-confirm-error-retry")).toBeTruthy();

      rerender(
        <RekeyPreview
          plan={plan("ulid")}
          confirm={erroredConfirm(confirmError({ recovery: { kind: "none" } }))}
          onConfirmed={() => {}}
        />,
      );
      expect(screen.queryByTestId("git-rekey-confirm-error-retry")).toBeNull();
    });

    it("keeps the raw server message available, but only inside a collapsed Disclosure", () => {
      render(
        <RekeyPreview
          plan={plan("ulid")}
          confirm={erroredConfirm(confirmError({ message: "a very specific server explanation" }))}
          onConfirmed={() => {}}
        />,
      );

      const detail = screen.getByTestId("git-rekey-confirm-error-detail");
      // Collapsed by default (native <details>, no `open` attribute).
      expect((detail as HTMLDetailsElement).open).toBe(false);
      expect(detail.textContent).toContain("a very specific server explanation");
    });
  });
});
