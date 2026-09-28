// @vitest-environment jsdom
import type { SchemaStatusResponse } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchemaBanner } from "./SchemaBanner.tsx";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Wrapped in a query client as when the banner carried the in-app
 * migration (moved to `UpgradeRequired` by K154), so a banner that
 * reached for query context again would still render here.
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
      <SchemaBanner status={{ kind: "current", version: "0.3.0" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("banners a missing .schema-version and says to write it, not `loctt migrate`", () => {
    // Previously rendered nothing, on the theory that the bootstrap
    // routed this to the init wizard — which is a stub, so nothing
    // routed anywhere and the user saw an unexplained broken app.
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("missing");
    // `loctt migrate` refuses a tracker with no recorded version (A366).
    expect(alert.textContent).not.toContain("loctt migrate");
    expect(alert.textContent).toContain("Write the tracker's format version into `.loctt/.schema-version`, then reload.");
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

  it("tells the user to upgrade for a future schema", () => {
    render(<SchemaBanner status={{ kind: "future", on_disk: "0.5.0", current: "0.3.0" }} />);
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
  it("missing: names the absent file, says to write it, and prints no version numbers", () => {
    render(<SchemaBanner status={{ kind: "missing" }} />);
    const text = textOf();

    expect(text).toContain(".schema-version");
    expect(text).toContain("`loctt doctor` says which version to write.");
    expect(text).not.toContain("loctt migrate");
    // Reinitialize is not merely absent as an offer — it is warned
    // against, which is the stronger reading of "not reinitialize,
    // which would risk data".
    expect(text).toMatch(/do not reinitialize/i);
    expect(text).not.toMatch(/out of date|outdated|behind/i);
    // Nothing is known, so nothing numeric may be claimed.
    expect(text).not.toMatch(/\bv\d|\d+\.\d+\.\d+|undefined|NaN/);
  });

  /**
   * @verifies SHL-35
   *
   * Migration cannot move a schema backwards. Offering it here invites
   * a destructive attempt, so its absence is the assertion that
   * matters.
   */
  it("future: shows both versions, says upgrade, and never offers migrate", () => {
    render(<SchemaBanner status={{ kind: "future", on_disk: "0.5.0", current: "0.3.0" }} />);
    const text = textOf();

    expect(text).toContain("0.5.0");
    expect(text).toContain("0.3.0");
    expect(text).toMatch(/update loctt|upgrade/i);
    expect(text).toContain("npm install -g loctt@latest");
    expect(text).not.toContain("loctt migrate");
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
    ["future", { kind: "future", on_disk: "0.9.0", current: "0.3.0" }],
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
   * @verifies SHL-34, SHL-35, SHL-38
   *
   * The four kinds are told apart by the markup, not only by prose, so
   * a surface can style or test them individually.
   */
  it("tags each kind on the element and gives each distinct copy", () => {
    const kinds: SchemaStatusResponse[] = [
      { kind: "missing" },
      { kind: "future", on_disk: "0.5.0", current: "0.3.0" },
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
    expect(seen.size).toBe(3);
  });

  // K154: `outdated` is not a banner. `AppBootstrap` renders the Upgrade
  // screen for it (UpgradeRequired.test.tsx); reaching the banner would
  // mean that routing was lost, which fails loudly.
  it("refuses the outdated kind, which belongs to the Upgrade screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SchemaBanner status={{ kind: "outdated", on_disk: "0.1.0", current: "0.3.0" }} />))
      .toThrow("use UpgradeRequired");
  });
});
