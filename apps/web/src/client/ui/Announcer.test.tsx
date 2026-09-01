// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnnouncerProvider, useAnnouncer } from "./Announcer.tsx";

/**
 * The live-region announcement channel (A11Y-24).
 *
 * What a unit test can honestly claim here, and what it cannot:
 *
 * - It **can** assert the region's markup and its content over time —
 *   which politeness a message lands in, that a repeat of the same
 *   string still produces a fresh text node, that nothing is queued up
 *   into a backlog. That is the payload a screen reader is handed.
 * - It **cannot** assert that a screen reader speaks it. No test in
 *   this repo can; the flow doc says so in its own preamble. The
 *   assertions below are about the DOM contract that makes speaking
 *   possible, and are described that way rather than as proof of
 *   speech.
 */

function Harness({ onReady }: { readonly onReady: (api: ReturnType<typeof useAnnouncer>) => void }) {
  const api = useAnnouncer();
  onReady(api);
  return null;
}

let announce: ReturnType<typeof useAnnouncer>["announce"];

function renderAnnouncer(): void {
  render(
    <AnnouncerProvider>
      <Harness onReady={api => { announce = api.announce; }} />
    </AnnouncerProvider>,
  );
}

afterEach(cleanup);

describe("the announcement channel", () => {
  // @verifies A11Y-24
  it("routes a success politely and a failure assertively", () => {
    renderAnnouncer();
    const polite = screen.getByTestId("announcer-polite");
    const assertive = screen.getByTestId("announcer-assertive");

    act(() => { announce("Status saved"); });
    // First bullet: "the success is announced ('Status saved') without
    // moving focus." Politely, so it does not cut off whatever the
    // reader is mid-sentence on.
    expect(polite.textContent).toBe("Status saved");
    expect(polite.getAttribute("aria-live")).toBe("polite");
    // And it did not leak into the assertive channel, which would make
    // every routine save interrupt the user.
    expect(assertive.textContent).toBe("");

    act(() => { announce("Could not save Status: the server refused", "assertive"); });
    // Second bullet: the failure "is assertive enough to interrupt — a
    // silent failure is the worst case in P4 terms".
    expect(assertive.textContent).toBe("Could not save Status: the server refused");
    expect(assertive.getAttribute("aria-live")).toBe("assertive");
  });

  // @verifies A11Y-24
  it("re-announces an identical repeat rather than going silent", () => {
    renderAnnouncer();
    const polite = screen.getByTestId("announcer-polite");

    act(() => { announce("Status saved"); });
    const firstNode = polite.firstElementChild;
    expect(polite.textContent).toBe("Status saved");

    act(() => { announce("Status saved"); });

    // The subtle one. A live region announces on *change*; setting the
    // same string twice changes nothing, so a second identical failure
    // would be silent — the user saves twice, it fails twice, and they
    // hear it once.
    //
    // The keyed span is how that is avoided: the text is identical but
    // the node is replaced, so the region genuinely changed. Asserting
    // the text alone could not tell the two implementations apart,
    // which is why the assertion is on node identity.
    expect(polite.textContent).toBe("Status saved");
    expect(polite.firstElementChild).not.toBe(firstNode);
  });

  // @verifies A11Y-24
  it("holds only the latest message, never a backlog of stale results", () => {
    renderAnnouncer();
    const polite = screen.getByTestId("announcer-polite");

    act(() => {
      announce("1 tasks");
      announce("2 tasks");
      announce("3 tasks");
    });

    // Third bullet: announcements "are not queued up into a backlog
    // that reads out stale results". The region holds the settled
    // value only — a user who filters three times hears the final
    // count, not a recital of the intermediate ones.
    expect(polite.textContent).toBe("3 tasks");
    expect(polite.textContent).not.toContain("1 tasks");
  });

  // @verifies A11Y-35
  it("does not move focus when a message lands", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderAnnouncer();
    expect(document.activeElement).toBe(input);

    act(() => { announce("Created T-4"); });

    // A11Y-35's first bullet: "focus stays in the field; the typed
    // characters are not lost". A live region that stole focus would
    // drop the next keystroke into the announcement.
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  // @verifies A11Y-24
  it("keeps both regions in the accessibility tree at all times", () => {
    renderAnnouncer();

    // A region that is only rendered when it has something to say is
    // announced by nothing: readers snapshot live regions when they
    // are inserted, so a region that appears together with its first
    // message is routinely missed. Both must exist from mount.
    expect(screen.getByTestId("announcer-polite")).toBeTruthy();
    expect(screen.getByTestId("announcer-assertive")).toBeTruthy();

    // `aria-atomic` so the whole message is read rather than only the
    // changed words — A11Y-51's "not truncated to the first sentence".
    expect(screen.getByTestId("announcer-polite").getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByTestId("announcer-assertive").getAttribute("aria-atomic")).toBe("true");

    // And they are hidden visually rather than with `display: none`,
    // which would remove them from the accessibility tree entirely.
    expect(screen.getByTestId("announcer-polite").className).toContain("sr-only");
  });
});
