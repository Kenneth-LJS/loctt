import { useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { Radio } from "../ui/Radio.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * Settings → Tracker → Backup & restore (F3 / K30).
 *
 * The web parity for `loctt backup` / `loctt restore` and the MCP
 * `backup` / `restore` tools. The JSONL backup is the canonical safety
 * net (K4: "JSONL is the backup" — the CSV export is a report for a
 * spreadsheet and cannot restore), and until this panel a web-only user
 * had no way to take or restore it.
 *
 * Export is a plain download link, not a fetch: `GET /api/backup/export`
 * streams the file with an attachment disposition, and a browser handles
 * that natively. A GET carries no CSRF header, so the link works without
 * one.
 *
 * Restore is a multipart upload (field `file`) with `mode` and `confirm`
 * on the query string — the shape the endpoint reads. A single uploaded
 * file only; a split backup needs every part and is restored with the
 * CLI (`loctt restore <part...>`).
 *
 * CRITICAL — destructive confirm (K30). `overwrite` replaces tasks the
 * backup carries and can displace existing bodies, so this panel gates
 * it behind a typed "OVERWRITE" confirmation and only then sends
 * `confirm=true`. `merge` never edits a present id and `bare` is refused
 * by the server against a non-empty tracker, so neither is gated.
 */

type RestoreMode = "bare" | "merge" | "overwrite";

interface RestoreReport {
  readonly mode: RestoreMode;
  readonly dryRun: boolean;
  readonly created: number;
  readonly skipped: number;
  readonly overwritten: number;
  readonly reallocatedKeys: readonly { from: string; to: string }[];
  readonly renamedEntities: readonly { type: string; from: string; to: string }[];
  readonly displacedBodies: readonly { taskId: string; path: string }[];
  readonly badLines: readonly { line: number; file: string; reason: string }[];
}

// Human-readable label for each restore mode. The raw mode value
// (bare/merge/overwrite) is API/CLI vocabulary and is not shown as the
// primary label — a user should read what the mode DOES (Ken's report).
const MODE_LABEL: Record<RestoreMode, string> = {
  bare: "Into an empty tracker only",
  merge: "Add missing tasks only",
  overwrite: "Replace matching tasks",
};

const MODE_HELP: Record<RestoreMode, string> = {
  bare: "Only writes into an empty tracker; refuses one that already has tasks.",
  merge: "Adds only tasks that are missing here; never edits a task that is present.",
  overwrite: "Replaces any task the backup carries. Existing descriptions are preserved.",
};

export function BackupPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Overwrite is the one mode that can lose work, so it is gated behind
  // a typed confirmation (K30). The word is fixed and case-sensitive so
  // it cannot be clicked through by muscle memory.
  const needsConfirm = mode === "overwrite";
  const confirmed = confirmText === "OVERWRITE";
  const canSubmit = file !== null && !busy && (!needsConfirm || confirmed);

  async function runRestore(dryRun: boolean) {
    if (file === null) return;
    setBusy(true);
    setErrorMsg(null);
    setReport(null);
    const params = new URLSearchParams({ mode });
    if (dryRun) params.set("dry_run", "true");
    // Only send confirm on a real destructive run; a dry run writes
    // nothing and the server exempts it.
    if (needsConfirm && !dryRun && confirmed) params.set("confirm", "true");
    try {
      const result = await apiClient.postFile<RestoreReport>(
        `/api/backup/restore?${params.toString()}`,
        file,
      );
      setReport(result);
    } catch (err) {
      // The server attributes a refusal (409) or a bad file (400); show
      // its message rather than a generic failure.
      setErrorMsg(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8" data-testid="backup-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Backup &amp; restore
      </h1>
      <p className="mb-6 max-w-2xl text-[0.9286rem] text-text-secondary">
        The JSONL backup is the whole tracker — task bodies, comments,
        attachments, history, config, users and key state — and is what
        can rebuild a tracker from nothing. The CSV/JSON task export is a
        report for a spreadsheet and cannot restore; this is the real
        backup.
      </p>

      {/* ---- Export ---- */}
      <section className="mb-8" data-testid="backup-export">
        <h2 className="mb-1 text-[1rem] font-semibold text-text-primary">Export</h2>
        <p className="mb-3 text-[0.9286rem] text-text-secondary">
          Downloads the whole-tracker backup as a single{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5">.jsonl</code> file.
          History is included. Machine-local files (user settings and
          recents) are deliberately excluded.
        </p>
        {/* A link, not a fetch: the browser handles the attachment
            download natively, and a GET needs no CSRF header. */}
        <a
          data-testid="backup-export-link"
          href="/api/backup/export"
          download
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast no-underline"
        >
          Download backup
        </a>
      </section>

      {/* ---- Restore ---- */}
      <section data-testid="backup-restore">
        <h2 className="mb-1 text-[1rem] font-semibold text-text-primary">Restore</h2>
        <p className="mb-3 max-w-2xl text-[0.9286rem] text-text-secondary">
          Reads a backup file back into this tracker. A split backup (one
          taken with parts) must be restored with the{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono">loctt restore</code>{" "}
          CLI, which takes every part at once.
        </p>

        <label className="mb-3 block text-[0.9286rem] text-text-secondary">
          Backup file
          <input
            data-testid="backup-restore-file"
            type="file"
            accept=".jsonl,.ndjson,application/x-ndjson,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
              setErrorMsg(null);
            }}
            className="mt-1 block text-[0.9286rem]"
          />
        </label>

        <fieldset className="mb-3">
          <legend className="mb-1 text-[0.9286rem] font-medium text-text-primary">Mode</legend>
          {(["bare", "merge", "overwrite"] as const).map(m => (
            <label key={m} className="mb-1 flex items-start gap-2 text-[0.9286rem] text-text-secondary">
              <Radio
                name="restore-mode"
                data-testid={`backup-mode-${m}`}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setConfirmText("");
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-text-primary">{MODE_LABEL[m]}</span>
                {" — "}
                {MODE_HELP[m]}
              </span>
            </label>
          ))}
        </fieldset>

        {needsConfirm && (
          <div
            role="alert"
            data-testid="backup-overwrite-confirm"
            className="mb-3 rounded-md border border-danger-fg bg-danger-bg p-3 text-[0.9286rem]"
          >
            <p className="mb-2 text-text-primary">
              Overwrite replaces every task this backup carries and can
              lose work in this tracker. Type{" "}
              <code className="rounded bg-bg-muted px-1 py-0.5">OVERWRITE</code>{" "}
              to enable it.
            </p>
            <TextField
              data-testid="backup-overwrite-input"
              type="text"
              value={confirmText}
              onChange={(e) => { setConfirmText(e.target.value); }}
              aria-label="Type OVERWRITE to confirm"
              className="w-40"
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            testId="backup-restore-dryrun"
            disabled={file === null || busy}
            onClick={() => { void runRestore(true); }}
          >
            Preview (dry run)
          </Button>
          <Button
            type="button"
            variant="primary"
            testId="backup-restore-submit"
            disabled={!canSubmit}
            onClick={() => { void runRestore(false); }}
          >
            {busy ? "Restoring…" : "Restore"}
          </Button>
        </div>

        {errorMsg !== null && (
          <p
            role="alert"
            data-testid="backup-restore-error"
            className="mt-3 text-[0.9286rem] text-danger-fg"
          >
            {errorMsg}
          </p>
        )}

        {report !== null && (
          <div data-testid="backup-restore-report" className="mt-3 text-[0.9286rem] text-text-secondary">
            <p className="font-medium text-text-primary">
              {report.dryRun
                ? `Dry run (${report.mode}) — nothing written`
                : `Restored (${report.mode})`}
            </p>
            <ul className="m-0 mt-1 list-disc pl-5">
              <li>created: {report.created}</li>
              <li>skipped: {report.skipped}</li>
              <li>overwritten: {report.overwritten}</li>
            </ul>
            {report.reallocatedKeys.length > 0 && (
              <p className="mt-1">
                {report.reallocatedKeys.length} task
                {report.reallocatedKeys.length === 1 ? " was" : "s were"} given a new key to avoid a clash.
              </p>
            )}
            {report.displacedBodies.length > 0 && (
              <p className="mt-1">
                {report.displacedBodies.length} existing task
                {report.displacedBodies.length === 1 ? " description was" : " descriptions were"} preserved.
              </p>
            )}
            {report.badLines.length > 0 && (
              <p className="mt-1 text-danger-fg">
                {report.badLines.length} unreadable line
                {report.badLines.length === 1 ? " was" : "s were"} skipped.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
