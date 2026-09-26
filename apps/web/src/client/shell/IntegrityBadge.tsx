import { Link } from "@tanstack/react-router";

import { useIntegrity } from "../api/hooks/useIntegrity.ts";

/**
 * DEG-31 / UX-11: a lightweight, always-present integrity badge in the
 * header.
 *
 * The problem it solves: corruption used to be discoverable only by opening
 * Settings → Diagnostics and pressing Run — three clicks and a manual scan
 * behind an intent the user has no reason to form until something already
 * looks wrong. This badge surfaces the *count* of known data-integrity
 * problems and links straight to Diagnostics, so the corruption announces
 * itself.
 *
 * It is fed by `useIntegrity` (`GET /api/integrity`), a cheap fixed-size
 * summary — never a per-load doctor run (the case's sizing note forbids
 * that). It renders **only when there are problems** (`ok === false`): a
 * clean tracker shows nothing, so the badge is a signal, not chrome.
 *
 *   - `role="status"` with `aria-live="polite"`, never a toast or an
 *     `alert`: it is standing context that the tracker has issues to look
 *     at, not an interruption of the current task. The app keeps working
 *     (the corruption is preserved and degraded, per the corruption-handling
 *     guide), so it must not seize focus or demand acknowledgement — it
 *     mirrors `AdvisoryFsBanner`'s status-not-alert reasoning.
 *   - It is a real `<Link>` to `/settings/diagnostics` (the section route),
 *     so keyboard and pointer both reach Diagnostics in one activation.
 *   - The count is a total across tasks and config; the per-item detail is
 *     Diagnostics' job, so the badge carries none of it.
 */
export function IntegrityBadge() {
  const integrity = useIntegrity();
  const summary = integrity.data;

  // Nothing to show until the summary loads and reports a problem. A
  // failed/absent read shows nothing rather than a false all-clear or a
  // scary error in the chrome — Diagnostics is where a read failure is
  // diagnosed, and the badge is an additive signal, not a gate.
  if (summary === undefined || summary.ok) return null;

  const { total } = summary;
  const label = `${String(total)} data ${total === 1 ? "issue" : "issues"}`;

  return (
    <Link
      to="/settings/$section"
      params={{ section: "diagnostics" }}
      // `status` + polite live region: this is standing context, announced
      // once when it appears, not an interruption. `aria-label` gives a
      // screen reader the full sentence rather than a bare number + glyph.
      role="status"
      aria-live="polite"
      aria-label={`${label}, open Diagnostics`}
      data-testid="integrity-badge"
      data-integrity-total={total}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-warn-fg/40 bg-warn-bg px-2.5 text-[0.8571rem] font-medium text-warn-fg no-underline hover:bg-warn-fg/10"
    >
      <WarnIcon />
      <span>{label}</span>
    </Link>
  );
}

function WarnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
