// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdvisoryFsBanner } from "./AdvisoryFsBanner.tsx";

const advisory = {
  fsClass: "dropbox",
  label: "Dropbox",
  message:
    "This tracker is on Dropbox, where POSIX advisory locks are not reliable.",
};

afterEach(() => {
  document.body.innerHTML = "";
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

/**
 * XS-50: the boot-time filesystem advisory surface.
 *
 * Wording amended under K130 (Ken, 2026-09-24): "This tracker is in a
 * network folder, which may lead to data corruption if multiple
 * machines edit the files at the same time. Keep it on a local disk to
 * be safe." This states the risk in plain terms rather than naming
 * "POSIX advisory locks" (internal mechanism, messaging.md §1). The
 * best-effort caveat is not repeated here — it already lives in the UI
 * guide (`docs/user/ui/guide.md` § Diagnostics) per Ken's 2026-09-23
 * ruling recorded in XS-50 (the panel shows results, not caveats about
 * a warning the user is not seeing).
 *
 * @verifies XS-50
 */
describe("AdvisoryFsBanner", () => {
  it("states the concurrency-corruption risk and names the path", () => {
    render(<AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />);
    const banner = screen.getByRole("status");
    // States the risk in K130's own wording.
    expect(banner.textContent).toMatch(/network folder/i);
    expect(banner.textContent).toMatch(/data corruption/i);
    expect(banner.textContent).toMatch(/local disk/i);
    // ...and the detected path, so the user can confirm which directory.
    expect(screen.getByTestId("fs-advisory-path").textContent).toBe("~/Dropbox/tracker");
  });

  it("is informational (role=status), not an alert", () => {
    render(<AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("is dismissible and stays dismissed within the session (does not re-nag)", () => {
    const { unmount } = render(
      <AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();

    // A later remount within the same session — as a refetch of /api/info
    // would produce — must not bring it back.
    unmount();
    render(<AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  /**
   * @verifies A311
   *
   * "Dismiss" moved onto `ui/Button`'s `variant="current"`, which
   * inherits this banner's `text-warn-fg` via `currentColor` instead of
   * carrying a fixed tone. A regression to `secondary` (neutral
   * border/surface) would sit wrong on the warn banner without failing
   * any of the other assertions here.
   */
  it("renders Dismiss on the current-tone Button variant, not a fixed tone", () => {
    render(<AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />);
    const cls = screen.getByRole("button", { name: "Dismiss" }).className;
    expect(cls).toContain("border-current");
    expect(cls).not.toMatch(/border-border-default|bg-bg-surface/);
  });
});
