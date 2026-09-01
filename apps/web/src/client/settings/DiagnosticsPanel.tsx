import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../api/client.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

/**
 * Settings → Tracker → Diagnostics (SET-14, SET-29, SET-40, XS-41).
 *
 * `GET /api/doctor` hands back core's `runDoctor` output unchanged, so
 * the check set is `loctt doctor`'s check set by construction rather
 * than by a UI that re-derives it — SET-14's "the UI has not invented
 * or omitted checks" holds because there is nothing here that could.
 *
 * A `DiagnosticCheck` is `{name, status, message}` and nothing more:
 * core carries no structured field for the affected file or the
 * remedy, both of which live inside `message`. So this panel renders
 * the message verbatim rather than reformatting it — reformatting
 * would be the UI inventing structure core does not have, and would
 * drift from the CLI's wording the moment either changed.
 *
 * **Rebuild stays CLI-only** (XS-41, and M4.3's ticket text). The key
 * index check's own message names `--rebuild-index`; this panel adds
 * no button for it, because `runDoctor`'s `rebuildIndex` option is not
 * reachable through `GET /api/doctor` and a button that cannot work is
 * exactly what XS-41 forbids.
 */

type CheckStatus = "ok" | "warn" | "error";

interface DiagnosticCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

/** CLI commands a check's message may point at, made copyable. */
const CLI_COMMAND_RE = /(loctt [a-z-]+(?: --[a-z-]+)*)/g;

/**
 * Renders a message with any `loctt …` command inside it as a
 * copyable code span (SET-14, XS-41: "the exact command is shown and
 * copyable"). Everything else is left as written.
 */
function MessageWithCommands({ message }: { readonly message: string }) {
  const parts = message.split(CLI_COMMAND_RE);
  return (
    <>
      {parts.map((part, i) =>
        // Odd indices are the captured command groups.
        i % 2 === 1
          ? (
              <code
                key={i}
                data-testid="diagnostics-command"
                className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] select-all"
              >
                {part}
              </code>
            )
          : <span key={i}>{part}</span>,
      )}
    </>
  );
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "Pass",
  warn: "Warn",
  error: "Fail",
};

const STATUS_CLASS: Record<CheckStatus, string> = {
  ok: "text-status-done",
  warn: "text-status-warn",
  error: "text-status-danger",
};

export function DiagnosticsPanel() {
  const doctor = useQuery({
    queryKey: ["doctor"],
    queryFn: ({ signal }) => apiClient.get<readonly DiagnosticCheck[]>("/api/doctor", { signal }),
    // SET-14's last bullet: fixing something in a terminal and
    // re-running flips the check without a page reload, so this must
    // never answer from cache.
    staleTime: 0,
  });

  const checks = doctor.data ?? [];
  const counts = {
    ok: checks.filter(c => c.status === "ok").length,
    warn: checks.filter(c => c.status === "warn").length,
    error: checks.filter(c => c.status === "error").length,
  };

  return (
    <div className="p-8" data-testid="diagnostics-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Diagnostics
      </h1>
      <p className="mb-3 text-[13px] text-text-secondary">
        The same checks{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">loctt doctor</code>{" "}
        runs, against this tracker.
      </p>

      <button
        type="button"
        data-testid="diagnostics-run"
        disabled={doctor.isFetching}
        onClick={() => { void doctor.refetch(); }}
        className="mb-4 rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[13px] disabled:opacity-50"
      >
        {doctor.isFetching ? "Running…" : "Run diagnostics"}
      </button>

      {/*
        SET-40: a failed run is not "all checks passed". The panel says
        the run itself failed, and — because `runDoctor` returns all or
        nothing rather than streaming — reports that no check completed,
        rather than marking any of them as passed.
      */}
      {doctor.isError && (
        <div data-testid="diagnostics-run-failed" data-diagnostics-state="run-failed">
          <ErrorState
            error={doctor.error}
            onRetry={() => { void doctor.refetch(); }}
            context="running diagnostics"
          />
          <p className="mt-2 text-[13px] text-text-secondary">
            No checks completed, so none of them are reported as passing.
            Retry re-runs the whole set.
          </p>
        </div>
      )}

      {!doctor.isError && doctor.isLoading && (
        <p data-testid="diagnostics-loading" className="text-[13px] text-text-tertiary">
          Running checks…
        </p>
      )}

      {!doctor.isError && !doctor.isLoading && (
        <>
          {/*
            SET-14: an explicit per-check state, never a single
            aggregate "OK". The summary is in addition to the rows, not
            instead of them.
          */}
          <p data-testid="diagnostics-summary" className="mb-2 text-[13px] text-text-secondary">
            {String(counts.ok)} passed · {String(counts.warn)} warning
            {counts.warn === 1 ? "" : "s"} · {String(counts.error)} failed
          </p>
          <ul className="m-0 list-none p-0" data-testid="diagnostics-checks">
            {/*
              Keyed by index, not by name. `runDoctor` pushes one
              "data integrity" check **per finding**, so `name` repeats
              — a name key would collapse every finding after the first
              into one row and hide real failures.
            */}
            {checks.map((check, i) => (
              <li
                key={i}
                data-testid={`diagnostics-check-${check.name.replace(/\s+/g, "-")}`}
                data-check-status={check.status}
                className="flex gap-3 border-b border-border-subtle py-2 text-[13px] last:border-0"
              >
                <span
                  className={`w-12 shrink-0 font-medium ${STATUS_CLASS[check.status]}`}
                  data-testid="diagnostics-check-status"
                >
                  {STATUS_LABEL[check.status]}
                </span>
                <span className="w-48 shrink-0 text-text-primary">{check.name}</span>
                <span className="min-w-0 flex-1 text-text-secondary">
                  <MessageWithCommands message={check.message} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
