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
 * @verifies XS-50
 */
describe("AdvisoryFsBanner", () => {
  it("names the class and the path, and states the concurrency risk", () => {
    render(<AdvisoryFsBanner advisory={advisory} cwd="~/Dropbox/tracker" />);
    const banner = screen.getByRole("status");
    // Names the specific class...
    expect(banner.textContent).toMatch(/Dropbox/);
    // ...the risk (advisory locks unsafe → concurrent writes corrupt)...
    expect(banner.textContent).toMatch(/advisory locks are not reliable/i);
    expect(banner.textContent).toMatch(/corrupt/i);
    // ...and the detected path, so the user can confirm which directory.
    expect(screen.getByTestId("fs-advisory-path").textContent).toBe("~/Dropbox/tracker");
    // Points at Diagnostics for the best-effort caveat.
    expect(banner.textContent).toMatch(/best-effort/i);
    expect(banner.textContent).toMatch(/Diagnostics/i);
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
