// @vitest-environment jsdom
import type { SchemaStatusResponse } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchemaBanner } from "./SchemaBanner.tsx";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * The `outdated` banner now carries a "Migrate now" button, which uses
 * a mutation — so the component needs query context where it
 * previously needed none. Wrapping every render keeps the other kinds'
 * assertions unchanged rather than splitting the file in two.
 */
function render(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("SchemaBanner", () => {
  it("renders nothing for the current schema", () => {
    const { container } = render(
      <SchemaBanner status={{ kind: "current", version: 3 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("banners a missing .schema-version and points at `loctt migrate`", () => {
    // Previously rendered nothing, on the theory that the bootstrap
    // routed this to the init wizard — which is a stub, so nothing
    // routed anywhere and the user saw an unexplained broken app.
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("missing");
    expect(alert.textContent).toContain("loctt migrate");
  });

  it("does not offer to reinitialize a tracker with a missing version", () => {
    // A .loctt/ holding tasks but no version file is a DAMAGED tracker,
    // not an empty one. Offering init/reinitialize here is the one path
    // that can destroy real data, so the copy must not suggest it.
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).not.toMatch(/loctt init/);
    expect(text).toMatch(/not reinitialize|Do not\s+reinitialize/i);
  });

  // @verifies XS-36, SET-15
  it("warns and points at the in-app Migrate now button for an outdated schema", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("outdated");
    // The outdated banner now points at its OWN "Migrate now" button
    // rather than the `loctt migrate` CLI command — a GUI user should not
    // be sent to the terminal when the button is right there (Ken's report).
    expect(alert.textContent).toContain("Migrate now");
    expect(alert.textContent).not.toContain("loctt migrate");
    expect(alert.textContent).toContain("v2");
    expect(alert.textContent).toContain("v3");
    // Was `expect(screen.queryByRole("button")).toBeNull()` with the
    // note "No in-app migrate button in M1.1 — that lands in M4."
    // This is M4: the button landed (SET-15, XS-36).
    expect(screen.getByTestId("schema-migrate-now")).not.toBeNull();
  });

  /**
   * @verifies A311
   *
   * The three buttons in this banner (Migrate now / Run migration /
   * Cancel) are a matched set that must inherit the banner's warn/danger
   * tone via `currentColor`, not carry a fixed tone of their own —
   * `ui/Button`'s `variant="current"`. A regression to `secondary` (or
   * any variant with its own `text-*`/`bg-*`-at-rest utility) would sit
   * wrong on a coloured banner without necessarily breaking any other
   * assertion in this file, since none of the others read `className`.
   */
  it("renders Migrate now on the current-tone Button variant, not a fixed tone", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    const cls = screen.getByTestId("schema-migrate-now").className;
    expect(cls).toContain("border-current");
    expect(cls).not.toMatch(/border-border-default|bg-bg-surface/);
  });

  /**
   * @verifies SET-15
   *
   * The first click must state what will happen before the second one
   * runs it: both versions, and that a backup snapshot is taken first.
   * The other confirm-step tests in this file assert styling, not this
   * copy, so a regression that dropped the sentence (leaving only the
   * buttons) would pass every other test here.
   */
  it("the confirm step states the from/to versions and the backup snapshot before running", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const confirmText = screen.getByTestId("schema-migrate-confirm").textContent ?? "";
    expect(confirmText).toContain("v2");
    expect(confirmText).toContain("v3");
    expect(confirmText).toMatch(/backup/i);
    // Nothing has run yet — no outcome text, and the confirm/cancel
    // controls are still the ones offered.
    expect(screen.queryByTestId("schema-migrate-success")).toBeNull();
    expect(screen.queryByTestId("schema-migrate-failed")).toBeNull();
    expect(screen.getByTestId("schema-migrate-confirm-button")).not.toBeNull();
  });

  it("renders Run migration and Cancel on the current-tone Button variant", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const confirmCls = screen.getByTestId("schema-migrate-confirm-button").className;
    expect(confirmCls).toContain("border-current");
    const cancelCls = screen.getByRole("button", { name: "Cancel" }).className;
    expect(cancelCls).toContain("border-current");
  });

  it("tells the user to upgrade for a future schema", () => {
    render(<SchemaBanner status={{ kind: "future", on_disk: 5, current: 3 }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("future");
    expect(alert.textContent?.toLowerCase()).toContain("update loctt");
  });

  it("surfaces the message for an unknown schema", () => {
    const status: SchemaStatusResponse = { kind: "unknown", message: "could not parse version" };
    render(<SchemaBanner status={status} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("unknown");
    expect(alert.textContent).toContain("could not parse version");
  });
});

/**
 * The four schema kinds are four *different* conditions with four
 * different remedies. P4 admits no generic "schema problem" banner
 * covering more than one, so each case below asserts not only what its
 * kind says but what it must not say — the wrong remedy is the failure
 * mode, and it is invisible to a test that only checks the right one.
 */
describe("SchemaBanner distinguishes the four kinds", () => {
  const textOf = (): string => screen.getByRole("alert").textContent ?? "";

  /**
   * @verifies SHL-34
   *
   * Missing is *unknown*, not *old*: no version numbers are known, so
   * none may be printed, and the tracker must not be described as out
   * of date.
   */
  it("missing: names the absent file, offers migrate, and prints no version numbers", () => {
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const text = textOf();

    expect(text).toContain(".schema-version");
    expect(text).toContain("loctt migrate");
    // Reinitialize is not merely absent as an offer — it is warned
    // against, which is the stronger reading of "not reinitialize,
    // which would risk data".
    expect(text).toMatch(/do not reinitialize/i);
    expect(text).not.toMatch(/out of date|outdated|behind/i);
    // Nothing is known, so nothing numeric may be claimed.
    expect(text).not.toMatch(/\bv\d|undefined|NaN/);
  });

  /**
   * @verifies SHL-35
   *
   * Migration cannot move a schema backwards. Offering it here invites
   * a destructive attempt, so its absence is the assertion that
   * matters.
   */
  it("future: shows both versions, says upgrade, and never offers migrate", () => {
    render(<SchemaBanner status={{ kind: "future", on_disk: 5, current: 3 }} />);
    const text = textOf();

    expect(text).toContain("v5");
    expect(text).toContain("v3");
    expect(text).toMatch(/update loctt|upgrade/i);
    expect(text).toContain("@loctt/cli@latest");
    expect(text).not.toContain("loctt migrate");
  });

  /**
   * @verifies SHL-36
   *
   * The command is only runnable if the user is not afraid of it, so
   * the backup is part of the copy rather than a detail they have to
   * already know.
   */
  it("outdated: shows both versions, points at the in-app button, and the backup reassurance", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    const text = textOf();

    expect(text).toContain("v2");
    expect(text).toContain("v3");
    // Points at the in-app "Migrate now" button, not the CLI command.
    expect(text).toContain("Migrate now");
    expect(text).not.toContain("loctt migrate");
    expect(text).toMatch(/backup/i);
    // Distinct from `future`: the tracker is behind the app, not ahead.
    expect(text).not.toMatch(/ahead of this build/i);
    // M4.3 REVERSES this. The assertion here used to be
    // `expect(screen.queryByRole("button")).toBeNull()` with the note
    // "M1 has no in-app migrate control" — true when written, and the
    // exact thing SET-15/XS-36 asked M4.3 to build. The banner now
    // carries "Migrate now" for `outdated`, so the old expectation was
    // encoding a deferral, not a requirement.
    expect(screen.getByTestId("schema-migrate-now")).not.toBeNull();
  });

  /**
   * @verifies SET-30
   *
   * "Offering Migrate on those kinds would risk a downgrade write; the
   * button's absence is the assertion." `future` is a downgrade,
   * `missing` and `unknown` are trackers whose layout is unconfirmed —
   * none of them may get the button that `outdated` gets.
   */
  it.each([
    ["future", { kind: "future", on_disk: 9, current: 3 }],
    ["missing", { kind: "missing" }],
    ["unknown", { kind: "unknown", message: "`.schema-version` contained `abc`." }],
  ] as const)("%s: offers no Migrate now button", (_kind, status) => {
    render(<SchemaBanner status={status as SchemaStatusResponse} />);
    expect(screen.queryByTestId("schema-migrate-now")).toBeNull();
    // And the confirm step is unreachable too, not merely unrendered.
    expect(screen.queryByTestId("schema-migrate-confirm-button")).toBeNull();
  });

  /**
   * @verifies SHL-38
   *
   * P4's rare exception still owes attempt, data state and next
   * action. The server message alone gave only the first.
   */
  it("unknown: names the attempt, the data state, and a concrete next action", () => {
    render(
      <SchemaBanner
        status={{ kind: "unknown", message: "`.schema-version` contained `abc`." }}
      />,
    );
    const text = textOf();

    expect(text).toContain("abc");
    expect(text).toMatch(/schema version/i);
    expect(text).toMatch(/untouched|nothing has been changed/i);
    // Points a GUI user at Settings → Diagnostics (the in-app equivalent
    // of `loctt doctor`) rather than the terminal command. The raw
    // `.schema-version` file is still named — that IS the corruption case
    // where hand-editing is a legitimate remedy (Ken's YAML rule).
    expect(text).toMatch(/Diagnostics/i);
    expect(text).not.toContain("loctt doctor");
    expect(text).toContain(".schema-version");
    // It must not borrow the `outdated` remedy for a state it does not
    // understand.
    expect(text).not.toContain("loctt migrate");
  });

  /**
   * @verifies SHL-34, SHL-35, SHL-36, SHL-38
   *
   * The four kinds are told apart by the markup, not only by prose, so
   * a surface can style or test them individually.
   */
  it("tags each kind on the element and gives each distinct copy", () => {
    const kinds: SchemaStatusResponse[] = [
      { kind: "missing" },
      { kind: "future", on_disk: 5, current: 3 },
      { kind: "outdated", on_disk: 2, current: 3 },
      { kind: "unknown", message: "bad" },
    ];
    const seen = new Set<string>();
    for (const status of kinds) {
      const { unmount } = render(<SchemaBanner status={status} />);
      const el = screen.getByRole("alert");
      expect(el.getAttribute("data-kind")).toBe(status.kind);
      const text = el.textContent ?? "";
      expect(seen.has(text)).toBe(false);
      seen.add(text);
      unmount();
    }
    expect(seen.size).toBe(4);
  });
});

/**
 * XS-36: the "Migrate now" button actually calls `POST /api/migrate`,
 * cannot be double-clicked, and reports a concrete success/failure
 * outcome — not just the busy-spinner mechanics A307 covers.
 */
describe("XS-36: Migrate now drives a real POST /api/migrate to a concrete outcome", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // @verifies XS-36
  it("disables the confirm button once the migration is in flight (aria-busy/disabled), so a click while pending does not dispatch a new request", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      new Promise<Response>(resolve => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const confirm = screen.getByTestId("schema-migrate-confirm-button");
    fireEvent.click(confirm);
    await waitFor(() => { expect(confirm.getAttribute("aria-busy")).toBe("true"); });
    // Once React has committed the pending state, the control itself
    // refuses a second click (disabled), matching what a mouse-driven
    // double-click would see after the first click's state lands.
    expect(confirm.hasAttribute("disabled")).toBe(true);
    resolveFetch(new Response(JSON.stringify({ from: 2, to: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await screen.findByTestId("schema-migrate-success");
    expect(fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/migrate");
    })).toHaveLength(1);
  });

  // @verifies XS-36
  it("two clicks in the same tick, before React commits the pending state, still POST once", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const confirm = screen.getByTestId("schema-migrate-confirm-button");
    // No await between: the second click lands before `isPending` can
    // disable the button. Only the synchronous in-flight ref stops it.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => { expect(confirm.getAttribute("aria-busy")).toBe("true"); });
    expect(fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/api/migrate");
    })).toHaveLength(1);
  });

  // @verifies XS-36, SET-15
  it("on success, clears into a message naming the versions and the backup path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ from: 2, to: 3, backupPath: "/tmp/loctt-backup-2026" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ))),
    );
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    fireEvent.click(screen.getByTestId("schema-migrate-confirm-button"));
    const success = await screen.findByTestId("schema-migrate-success");
    expect(success.textContent).toContain("v2");
    expect(success.textContent).toContain("v3");
    expect(success.textContent).toContain("/tmp/loctt-backup-2026");
    // The confirm/cancel controls are gone once settled.
    expect(screen.queryByTestId("schema-migrate-confirm-button")).toBeNull();
  });

  // @verifies XS-36, SET-37
  it("on failure, names what did not complete and points at the backup/recovery command, without re-offering a bare retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: "schema_mismatch",
              message: "Migration failed while writing task index.",
              data_state: "unknown",
              recovery: { kind: "command", command: "loctt migrate --resume" },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          ))),
    );
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    fireEvent.click(screen.getByTestId("schema-migrate-confirm-button"));
    const failed = await screen.findByTestId("schema-migrate-failed");
    expect(failed.getAttribute("data-migrate-state")).toBe("failed");
    expect(failed.textContent).toContain("did not complete");
    expect(failed.textContent).toContain("Migration failed while writing task index.");
    expect(failed.textContent).toContain("check the backup directory");
    // The server's own recovery command is surfaced verbatim, not a
    // generic "try again" with no way to know how far the migration got.
    expect(failed.textContent).toContain("loctt migrate --resume");
  });
});

/**
 * @verifies A307 (progress labels converted to the brand spinner)
 * @verifies A311 (moved onto `ui/Button`'s `loading`, via `variant="current"`)
 *
 * "Run migration" used to re-spell itself as "Migrating…" while the
 * POST was in flight — the button's width changed mid-action, and no
 * spinner was shown at all, only `disabled`.
 *
 * A307 reproduced `Button`'s `loading` mechanism inline because moving
 * this button alone would have broken the three-button set's shared
 * `border-current/30` tone-inheriting look. A311 added that exact look
 * as `ui/Button`'s `variant="current"` and moved the whole set onto it,
 * so this button is `ui/Button` now — `Button.test.tsx`'s `loading`
 * suite covers the invisible-label/spinner/aria-busy mechanism at the
 * primitive. This describe block stays because it exercises the
 * mechanism through this component's own state machine (the confirm
 * step, the in-flight mutation) rather than duplicating the primitive's
 * unit tests — a regression here would mean the wiring, not the
 * primitive, broke.
 */
describe("A307: the schema migrate button shows the spinner, not a label swap", () => {
  /** Opens the confirm step and leaves POST /api/migrate in flight. */
  async function renderPending() {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => { /* never settles: stays pending */ }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const btn = screen.getByTestId("schema-migrate-confirm-button");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute("aria-busy")).toBe("true");
    });
    return btn;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps the label in the DOM and in flow while migrating, so the button cannot resize", async () => {
    const btn = await renderPending();
    // Not swapped for a shorter word, and not unmounted: `invisible`
    // (visibility:hidden) keeps the box in flow; `hidden`/display:none
    // would collapse it and resize the button, which is the defect.
    expect(btn.textContent).toContain("Run migration");
    expect(btn.textContent).not.toContain("Migrating");
    const label = screen.getByText("Run migration");
    expect(label.className).toContain("invisible");
    expect(label.className).not.toContain("hidden");
    expect(label.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps its accessible name while migrating", async () => {
    await renderPending();
    // The visible label is aria-hidden, so without the explicit
    // aria-label this button would be nameless while busy.
    expect(screen.getByRole("button", { name: "Run migration" })).toBeTruthy();
  });

  it("renders the brand spinner while migrating", async () => {
    const btn = await renderPending();
    expect(btn.querySelector("[data-testid='logo-spinner']")).toBeTruthy();
  });

  it("shows no spinner and is not busy before the migration starts", () => {
    render(<SchemaBanner status={{ kind: "outdated", on_disk: 2, current: 3 }} />);
    fireEvent.click(screen.getByTestId("schema-migrate-now"));
    const btn = screen.getByTestId("schema-migrate-confirm-button");
    expect(btn.getAttribute("aria-busy")).toBeNull();
    expect(btn.querySelector("[data-testid='logo-spinner']")).toBeNull();
  });
});
