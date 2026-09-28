// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UpgradeNotice } from "./UpgradeNotice.tsx";

afterEach(() => {
  document.body.innerHTML = "";
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

const upgrade = {
  from: "0.1.0",
  to: "0.3.0",
  backup: "/work/.loctt.backup-v0.1.0-2026",
  line: "Upgraded this tracker from 0.1.0 to 0.3.0 (backup: /work/.loctt.backup-v0.1.0-2026).",
};

/**
 * K143: the web's one line for an automatic upgrade, shown once until
 * dismissed.
 *
 * @verifies ONB-C17
 */
describe("UpgradeNotice", () => {
  it("shows the server's line as a status, not an alert", () => {
    render(<UpgradeNotice upgrade={upgrade} />);
    const notice = screen.getByTestId("upgrade-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain(upgrade.line);
  });

  it("stays dismissed across a remount (the /api/info poll), keyed by the backup", () => {
    const { unmount } = render(<UpgradeNotice upgrade={upgrade} />);
    fireEvent.click(screen.getByTestId("upgrade-notice-dismiss"));
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
    unmount();
    render(<UpgradeNotice upgrade={upgrade} />);
    expect(screen.queryByTestId("upgrade-notice")).toBeNull();
    // A different upgrade (another backup) is shown.
    render(<UpgradeNotice upgrade={{ ...upgrade, backup: "/work/other" }} />);
    expect(screen.getByTestId("upgrade-notice")).not.toBeNull();
  });
});
