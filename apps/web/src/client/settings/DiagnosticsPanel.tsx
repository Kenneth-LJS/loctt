import { useCallback, useEffect, useRef, useState } from "react";

import { createDeadline, DEFAULT_WRITE_TIMEOUT_MS, isAbort } from "../api/client.ts";
import { STREAM_INACTIVITY_TIMEOUT_MS } from "../api/hooks/useGit.ts";
import { LogoSpinner } from "../ui/brand/LogoSpinner.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";

/**
 * Settings → Tracker → Diagnostics (SET-14, SET-29, SET-40, XS-41).
 *
 * `GET /api/doctor` streams core's `runDoctorStream` output as
 * newline-delimited JSON — one `DiagnosticCheck` per line — so the
 * check set is `loctt doctor`'s check set by construction (both drain
 * the same core producer) rather than by a UI that re-derives it.
 * SET-14's "the UI has not invented or omitted checks" holds because
 * there is nothing here that could.
 *
 * SET-29: each check is rendered the instant its line arrives, and
 * while the stream is still open a distinct "running" row shows that
 * more are coming — a check still running is visibly different from one
 * that has passed or failed (bullet 2), rather than the whole panel
 * sitting on one spinner then dumping every check at once (bullet 1).
 * Navigating away aborts the fetch via the controller in the effect
 * cleanup, so nothing is left permanently spinning (bullet 3).
 *
 * A `DiagnosticCheck` carries `{name, status, message}` plus an optional
 * `fix` (K-diagnostics-repair): the message still holds the affected file
 * and the human remedy, so this panel renders it verbatim rather than
 * reformatting it, but `fix` is the machine-readable signal for which of
 * the two programmatic repairs (if any) resolves the finding.
 *
 * **Contextual repair buttons** (K-diagnostics-repair, revising the old
 * "rebuild stays CLI-only" rule). There are exactly two safe programmatic
 * repairs — rebuild the key index, and restore missing core files — and
 * they cover only a small minority of findings. So this panel shows a
 * top-level button PER ACTION, gated on whether a finding tagged with that
 * `fix` is present in the current run — not a per-row Fix column (dead on
 * ~85% of rows). The buttons render only when they can act, which is what
 * XS-41 requires; the ~85% of manual findings keep their message + copyable
 * command and get no button.
 */

type CheckStatus = "ok" | "warn" | "error";
type DiagnosticFix = "rebuild-index" | "restore-missing";

interface DiagnosticCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: DiagnosticFix;
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
                className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] select-all"
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
  ok: "text-success-fg",
  warn: "text-warn-fg",
  error: "text-danger-fg",
};

/** The panel's lifecycle, independent of which checks have arrived. */
type RunPhase = "idle" | "running" | "done" | "failed";

/**
 * Reads the NDJSON `/api/doctor` stream, delivering each parsed check
 * through `onCheck` as its line arrives. A trailing `{ error }` line
 * (the server's mid-run failure marker) is surfaced as a thrown error
 * so the caller can enter the failed state.
 */
/**
 * K115 item 3: the same 60s-of-silence deadline `useGit.ts`'s
 * `streamSync` uses (`STREAM_INACTIVITY_TIMEOUT_MS`), applied here via
 * the shared `createDeadline` helper rather than a third hand-rolled
 * copy. Resets on every parsed line, and starts armed before the
 * request leaves — so a server that never answers at all is caught the
 * same way as one that stalls mid-stream.
 *
 * `signal` is the caller's own unmount/supersede abort (from `run`'s
 * `AbortController`) and is combined with the deadline's controller via
 * `AbortSignal.any` — either firing aborts the fetch, but only the
 * deadline firing is a *timeout* (an unmount is a cancellation, not an
 * unknown outcome, matching `apiRequest`'s own `timedOut` distinction).
 */
async function streamDoctor(
  onCheck: (check: DiagnosticCheck) => void,
  signal: AbortSignal,
): Promise<void> {
  const deadline = createDeadline(STREAM_INACTIVITY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("/api/doctor", {
      headers: { "X-Loctt-Client": "web", Accept: "application/x-ndjson" },
      signal: AbortSignal.any([signal, deadline.controller.signal]),
    });
  } catch (err) {
    if (isAbort(err) && deadline.didExpire()) {
      throw doctorSilenceError();
    }
    throw err;
  }
  deadline.bump();
  if (!res.ok || !res.body) {
    deadline.clear();
    throw new Error(`diagnostics request failed (${String(res.status)})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const parsed = JSON.parse(trimmed) as DiagnosticCheck | { error: string };
    if ("error" in parsed) {
      streamError = parsed.error;
      return;
    }
    onCheck(parsed);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      deadline.bump();
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
  } catch (err) {
    if (isAbort(err) && deadline.didExpire()) {
      throw doctorSilenceError();
    }
    throw err;
  } finally {
    deadline.clear();
  }
  // Flush any trailing partial line (a stream that did not end on \n).
  handleLine(buffer);

  if (streamError !== undefined) {
    throw new Error(streamError);
  }
}

/**
 * K115 item 3: never "did not complete" — a run that has already
 * printed some check results before going silent is not a failure the
 * user should read as "diagnostics are broken", only as "the run
 * stopped reporting; the results shown so far are real, the rest is
 * unknown". `ErrorState` (via the panel's `phase === "failed"` branch)
 * renders this the same as any other run failure, with Retry.
 */
function doctorSilenceError(): Error {
  return new Error(
    "Diagnostics stopped responding. Refresh to see whether the run finished.",
  );
}

export function DiagnosticsPanel() {
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [error, setError] = useState<unknown>(undefined);
  // A monotonic run id: a new run supersedes any in flight, so a stale
  // stream's late checks cannot land in the new run's list.
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const run = useCallback(() => {
    // Cancel any run still in flight before starting another.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = ++runIdRef.current;

    setChecks([]);
    setError(undefined);
    setPhase("running");

    streamDoctor((check) => {
      if (runIdRef.current !== runId) return;
      setChecks(prev => [...prev, check]);
    }, controller.signal)
      .then(() => {
        if (runIdRef.current !== runId) return;
        setPhase("done");
      })
      .catch((err: unknown) => {
        // An abort (navigation, or a superseding run) is not a failure;
        // leave the state to whoever aborted us.
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        setError(err);
        setPhase("failed");
      });
  }, []);

  // Run once on mount, and abort on unmount so navigating away leaves
  // no check permanently spinning (SET-29 bullet 3).
  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
      // K115: cancel an in-flight repair on unmount too — it previously
      // had no signal at all, so navigating away left it running with
      // no way to stop it.
      repairAbortRef.current?.abort();
    };
  }, [run]);

  // ── Repair (K-diagnostics-repair) ──────────────────────────────────
  // Which repair actions the current findings call for, and running one.
  const [repairing, setRepairing] = useState<DiagnosticFix | undefined>(undefined);
  const [repairError, setRepairError] = useState<string | undefined>(undefined);
  // A confirm is only needed for restore-missing (it writes default files);
  // rebuild-index is idempotent and runs immediately.
  const [confirmRestore, setConfirmRestore] = useState(false);
  // K115 item 3: repair had no abort signal at all — an unmount mid-repair
  // left the fetch running with nothing to cancel it. Tracked the same
  // way `run`'s stream abort is, so unmounting cancels rather than
  // reporting a stray "did not complete" into a dead component.
  const repairAbortRef = useRef<AbortController | undefined>(undefined);

  const runRepair = useCallback((action: DiagnosticFix): void => {
    setRepairError(undefined);
    setRepairing(action);
    repairAbortRef.current?.abort();
    const controller = new AbortController();
    repairAbortRef.current = controller;
    // K115: a write with the 15s write-default deadline, via the same
    // helper the streaming call sites use. A fixed deadline (not
    // inactivity) is right here — this is a single POST, not a stream
    // with progress lines to reset against.
    const deadline = createDeadline(DEFAULT_WRITE_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, deadline.controller.signal]);
    void (async () => {
      try {
        const res = await fetch("/api/doctor/repair", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
          body: JSON.stringify({ action }),
          signal,
        });
        deadline.clear();
        if (!res.ok) {
          const detail = await res.json().catch(() => undefined) as { message?: string } | undefined;
          throw new Error(detail?.message ?? `repair failed (${String(res.status)})`);
        }
        // Success: re-run the doctor to reflect the repaired state, rather
        // than leaving the stale list next to a toast.
        run();
      } catch (err) {
        deadline.clear();
        // An unmount/superseding repair is a cancellation, not a failure
        // — leave it to whoever aborted (matches `apiRequest`'s
        // `timedOut` distinction and `run`'s own abort check).
        if (isAbort(err) && !deadline.didExpire() && controller.signal.aborted) return;
        if (isAbort(err) && deadline.didExpire()) {
          // K115: never "did not complete" — the repair may have landed
          // on the server even though the response never arrived, so
          // this states the outcome as unknown rather than as failed.
          setRepairError(
            "The server stopped responding. Refresh diagnostics to see if the repair completed.",
          );
          return;
        }
        setRepairError(err instanceof Error ? err.message : "The repair did not complete.");
      } finally {
        setRepairing(undefined);
        setConfirmRestore(false);
      }
    })();
  }, [run]);

  const isRunning = phase === "running";
  const counts = {
    ok: checks.filter(c => c.status === "ok").length,
    warn: checks.filter(c => c.status === "warn").length,
    error: checks.filter(c => c.status === "error").length,
  };
  // A repair button shows only when a finding tagged with its `fix` is
  // present — the button renders only when it can act (XS-41).
  const canRebuildIndex = checks.some(c => c.fix === "rebuild-index");
  const canRestoreMissing = checks.some(c => c.fix === "restore-missing");
  // The files restore-missing would recreate, named for the confirm body.
  const missingFiles = checks
    .filter(c => c.fix === "restore-missing")
    .map(c => c.name)
    .join(", ");

  return (
    <div data-testid="diagnostics-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Diagnostics
      </h1>
      {/* No description line, and no filesystem caveat — both moved to
          the user docs (Ken, 2026-09-23).

          The intro read "The same checks `loctt doctor` runs, against
          this tracker": it described this panel by naming a DIFFERENT
          tool, so a user who has never touched the CLI learned nothing
          and one who has already knew. Ken on the CLI reference
          specifically: "if you want to talk about the loctt doctor
          command, again, user docs".

          The filesystem caveat (advisory locks are unsafe on iCloud /
          Dropbox / OneDrive / NFS / SMB, and detection is best-effort)
          was standing text about a warning the user is NOT seeing —
          permanently occupying the space above the Run button to
          describe a non-event. XS-50's fifth bullet required it here;
          that bullet is amended to point at the docs instead. The
          hazard itself is unchanged and still surfaced at boot when
          detection DOES fire. */}


      {/*
        SET-40: a failed run is not "all checks passed". The banner says
        the run itself failed and is shown ABOVE the check list, not
        instead of it — because checks stream, some may already have
        landed before the failure, and SET-40's second bullet requires
        the panel to "report what it managed to complete … and mark the
        rest as not run rather than as passed". So the completed rows
        stay rendered below (see the list, gated on `checks.length` too),
        with their real states, and the banner makes clear the run did
        not finish.
      */}
      {phase === "failed" && (
        <div data-testid="diagnostics-run-failed" data-diagnostics-state="run-failed">
          <ErrorState
            error={error}
            onRetry={() => { run(); }}
            context="running diagnostics"
          />
          <p className="mt-2 text-[0.9286rem] text-text-secondary">
            The run stopped early. Checks that didn&apos;t run are marked Not run.
          </p>
        </div>
      )}

      {/*
        The list renders whenever the run is not failed, OR it failed but
        some checks had already streamed in — the FIX that keeps partial
        results visible on a mid-stream failure (A182, SET-40 bullet 2).
      */}
      {(phase !== "failed" || checks.length > 0) && (
        <>
          {/*
            SET-14: an explicit per-check state, never a single
            aggregate "OK". The summary is in addition to the rows, not
            instead of them.
          */}
          {/* Ken, 2026-09-23: "run diagnostics" reads as the thing you
              must do first; "Refresh" says the results are already
              here and this re-reads them, which is what it does — the
              panel runs on mount. Moved to the row's right, level with
              the summary, so the counts lead and the action sits where
              a re-run belongs rather than above the data it replaces. */}
          <div className="mb-2 mt-3 flex items-center justify-between gap-3">
            <p data-testid="diagnostics-summary" className="text-[0.9286rem] text-text-secondary">
              {String(counts.ok)} passed · {String(counts.warn)} warning
              {counts.warn === 1 ? "" : "s"} · {String(counts.error)} failed
              {isRunning ? " · running…" : phase === "failed" ? " · run did not finish" : ""}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              testId="diagnostics-run"
              className="shrink-0"
              loading={isRunning}
              aria-label="Refresh"
              onClick={() => { run(); }}
            >
              Refresh
            </Button>
          </div>

          {/* K-diagnostics-repair: contextual repair actions — each shows
              only when a finding it can fix is present, so a rendered button
              can always act (XS-41). Manual findings get no button. */}
          {(canRebuildIndex || canRestoreMissing) && (
            <div data-testid="diagnostics-repairs" className="mb-3 flex flex-wrap gap-2">
              {canRebuildIndex && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  testId="diagnostics-fix-rebuild-index"
                  disabled={repairing !== undefined || isRunning}
                  loading={repairing === "rebuild-index"}
                  aria-label="Rebuild key index"
                  onClick={() => { runRepair("rebuild-index"); }}
                >
                  Rebuild key index
                </Button>
              )}
              {canRestoreMissing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  testId="diagnostics-fix-restore-missing"
                  disabled={repairing !== undefined || isRunning}
                  loading={repairing === "restore-missing"}
                  aria-label="Restore missing files"
                  onClick={() => { setRepairError(undefined); setConfirmRestore(true); }}
                >
                  Restore missing files
                </Button>
              )}
            </div>
          )}

          {repairError !== undefined && (
            <Callout tone="danger" role="alert" testId="diagnostics-repair-error" className="mb-3">
              {repairError} Reload and try again, or run the matching <code className="font-mono">loctt</code> command in a terminal.
            </Callout>
          )}
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
                data-check-state="done"
                className="flex flex-col gap-x-3 gap-y-0.5 border-b border-border-subtle py-2 text-[0.9286rem] last:border-0 sm:flex-row"
              >
                {/* On a phone the status + name sit on the first line and
                    the detail wraps under them; on >= sm the row is the
                    original three columns. `break-words` stops a long
                    detail string forcing horizontal scroll (UX eval #5). */}
                <span className="flex gap-3 sm:contents">
                  <span
                    className={`w-12 shrink-0 font-medium ${STATUS_CLASS[check.status]}`}
                    data-testid="diagnostics-check-status"
                  >
                    {STATUS_LABEL[check.status]}
                  </span>
                  <span className="text-text-primary sm:w-48 sm:shrink-0">{check.name}</span>
                </span>
                <span className="min-w-0 flex-1 break-words text-text-secondary">
                  <MessageWithCommands message={check.message} />
                </span>
              </li>
            ))}
            {/*
              SET-29 bullet 2: while the stream is still open, a running
              row is shown, visually distinct from any completed row —
              the animated dots and the neutral "Running" label are
              never used for a check that has resolved. This is what lets
              the user see that checks are still arriving rather than
              wondering whether the panel has stalled. It never shows on a
              failed run (`isRunning` is false), so a failed run's
              remaining checks read as absent/not-run, not as passing.
            */}
            {isRunning && (
              <li
                data-testid="diagnostics-check-running"
                data-check-state="pending"
                className="flex gap-3 border-b border-border-subtle py-2 text-[0.9286rem] text-text-tertiary last:border-0"
              >
                <span
                  className="w-12 shrink-0 font-medium text-text-tertiary"
                  data-testid="diagnostics-check-status"
                >
                  Running
                </span>
                {/*
                  A307: the `•••` here was a typed Unicode glyph doing a
                  spinner's job — the pattern A208 bans (affordances are
                  drawn, not typed; the lint rule misses `•` because it is
                  legitimately a prose bullet). Replaced with the real
                  brand spinner, in the NAME column so the row still
                  lines up with the completed rows' three columns
                  (`w-12` status | `w-48` name | flex-1 detail).

                  `LogoSpinner` bare, NOT `LoadingState`: `LoadingState`
                  carries its own `role="status"` wrapper, and this row
                  already has one on the detail column — nesting them
                  would put two live regions in one row for one state.
                  Sized to the row's own text (`0.9286rem` line), not the
                  panel-level default, so it reads as an inline status
                  mark rather than a block loader.
                */}
                <span className="w-48 shrink-0">
                  <LogoSpinner size="1.125rem" />
                </span>
                {/*
                  Ken's standing ruling ("find all loading state, replace
                  with spinner") — but per `LoadingState`'s docstring the
                  message must SURVIVE as the accessible name, or the
                  live region announces nothing, which was the original
                  silent-panel bug. So it is `sr-only`, not deleted: the
                  eye gets the spinner, the screen reader still gets
                  "Running checks…".
                */}
                <span className="min-w-0 flex-1" role="status">
                  <span className="sr-only">Running checks…</span>
                </span>
              </li>
            )}
          </ul>
        </>
      )}

      {confirmRestore && (
        <ConfirmDialog
          title="Restore missing files?"
          testId="diagnostics-restore-confirm"
          confirmTestId="diagnostics-restore-confirm-button"
          variant="primary"
          confirmLabel="Restore"
          // `confirmLoading` covers the restore-missing repair itself
          // (it disables on its own); `confirmDisabled` is kept for the
          // orthogonal case of ANY other repair being in flight, which
          // `loading` would not cover.
          confirmLoading={repairing === "restore-missing"}
          confirmDisabled={repairing !== undefined}
          body={
            <>
              Recreates{" "}
              {missingFiles.length > 0 ? <span className="font-medium">{missingFiles}</span> : null}{" "}
              with default values. Your tasks and other files aren&apos;t touched.
            </>
          }
          {...(repairError !== undefined ? { error: repairError } : {})}
          onConfirm={() => { runRepair("restore-missing"); }}
          onCancel={() => { setConfirmRestore(false); }}
        />
      )}
    </div>
  );
}
