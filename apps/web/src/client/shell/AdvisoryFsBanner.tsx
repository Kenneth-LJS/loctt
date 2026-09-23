import { useState } from "react";

import { Button } from "../ui/Button.tsx";

/**
 * XS-50: a boot-time advisory that the tracker sits on a filesystem where
 * POSIX advisory locks are unsafe (iCloud Drive, Dropbox, OneDrive, NFS,
 * SMB).
 *
 * Unlike the enable-time `data-git-warning="fstype"` advisory in
 * `GitSyncPanel` — which fires only when git sync is being configured — this
 * fires at `loctt ui` boot for **any** tracker, because the concurrency
 * hazard is a property of the filesystem rather than of git: two machines
 * writing to a synced folder can corrupt state whether or not sync is on.
 * The server computes the class once (`detectSyncFsAdvisory`, reused from
 * core) and reports it on `/api/info` as `fstypeAdvisory`.
 *
 * The surface is:
 *   - **Informational, not blocking** (the risk is concurrency-dependent —
 *     a single machine is fine, so the app must keep working). `role`
 *     "status", never "alert".
 *   - **Names the class and the path** so the user can confirm which
 *     directory triggered it (the case's second bullet).
 *   - **Dismissible, and does not re-nag within a session** — dismissal is
 *     held in `sessionStorage`, keyed by class, so a refetch of `/api/info`
 *     (the poll, or a panel remount) does not bring it back after the user
 *     has closed it. It returns on a fresh tab/session, which is the point:
 *     the hazard is still there.
 *   - **Points at Diagnostics** for the best-effort caveat (fifth bullet):
 *     detection can miss cases, so the absence of a warning is not a
 *     guarantee — the Diagnostics panel says so.
 */
export function AdvisoryFsBanner({
  advisory,
  cwd,
}: {
  readonly advisory: { readonly fsClass: string; readonly label: string; readonly message: string };
  readonly cwd: string;
}) {
  const storageKey = `loctt.fsAdvisory.dismissed.${advisory.fsClass}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      // A browser that refuses storage (private mode, blocked) simply
      // shows the advisory — the fallback that never hides a real hazard.
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
      // `status`, not `alert`: this is standing context about the
      // filesystem, not an interruption, and the app keeps working.
      role="status"
      data-fs-advisory="true"
      data-fs-class={advisory.fsClass}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warn-fg/20 bg-warn-bg px-4 py-2 text-[0.9286rem] text-warn-fg"
    >
      <span className="font-semibold">
        This tracker is on {advisory.label}.
      </span>
      <span className="opacity-90">
        POSIX advisory locks are not reliable there, so concurrent writes
        from two machines can corrupt the tracker&rsquo;s state. Path:{" "}
        <code data-testid="fs-advisory-path">{cwd}</code>.
        For reliable locking, move the tracker to a local disk.{" "}
        Detection is best-effort — see Diagnostics.
      </span>
      {/*
        A311: `variant="current"` inherits this banner's `text-warn-fg`
        via `currentColor` — same tinted-outline look as the old
        hand-rolled `border-warn-fg/40`, now the shared primitive.
      */}
      <Button
        variant="current"
        size="sm"
        className="ml-auto text-[0.9286rem]"
        onClick={dismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
