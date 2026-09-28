import type { TrackerInfoResponse } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";

/**
 * K143: the one line saying the server upgraded this tracker's format on
 * first use ("Upgraded this tracker from 0.1.0 to 0.3.0 (backup: …).").
 *
 * The CLI prints the line and MCP returns it on the call that ran the
 * upgrade; the web has no request the user is watching, so the server
 * holds it for `/api/info` and the shell shows it here, above the app,
 * until dismissed. Dismissal is kept in `sessionStorage`, keyed by the
 * backup path, so the `/api/info` poll does not bring it back; a later
 * upgrade (a different backup) shows again.
 *
 * `role="status"`: something happened and nothing is left to do.
 */
export function UpgradeNotice({
  upgrade,
}: {
  readonly upgrade: NonNullable<TrackerInfoResponse["completedUpgrade"]>;
}) {
  const storageKey = `loctt.upgradeNotice.dismissed.${upgrade.backup ?? upgrade.to}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // Non-fatal: the in-memory state already hid it for this mount.
    }
  };

  return (
    <div
      role="status"
      data-testid="upgrade-notice"
      data-from={upgrade.from}
      data-to={upgrade.to}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-default bg-bg-muted px-4 py-2 text-[0.9286rem]"
    >
      <span>{upgrade.line}</span>
      <Button
        variant="current"
        size="sm"
        className="ml-auto text-[0.9286rem]"
        testId="upgrade-notice-dismiss"
        onClick={dismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
