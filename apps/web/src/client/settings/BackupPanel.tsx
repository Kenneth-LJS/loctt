import { useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { FilePicker } from "../ui/FilePicker.tsx";
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
 * on the query string — the shape the endpoint reads. SEVERAL files may
 * be selected: a split backup is restored here by picking every part
 * (Ken, 2026-09-23 — the panel used to send the user to the CLI). The
 * parts are sent as N `file` parts and core's `resolveBackupSet` orders
 * them and refuses an incomplete or mixed set; the panel reads each
 * file's header locally first so it can say how many parts the set
 * expects BEFORE an upload, rather than only after the server refuses.
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

/**
 * Line 1 of a backup file, as far as the panel needs it. The full schema
 * lives in core (`BackupHeaderSchema`); this reads only what it shows.
 */
interface PartHeader {
  readonly part: number;
  readonly parts: number;
  readonly backup_id: string;
}

/** What the panel could learn about one selected file, locally. */
interface SelectedPart {
  readonly file: File;
  /** Undefined when the first line is not a readable backup header. */
  readonly header?: PartHeader;
}

/**
 * Reads the backup header from a file's first line, in the browser.
 *
 * Only the first 64 KiB is sliced: the header is line 1 by construction
 * (BAK-C21 — that is why the format puts it there rather than in a
 * footer), so this never reads a whole multi-gigabyte part to label it.
 *
 * Returns undefined rather than throwing when the line is not a header.
 * The panel uses this to LABEL a selection, never to gate one — the
 * server and core are the authority on what is restorable, and a client
 * that refused a file the server would have accepted would be its own
 * bug.
 */
async function readPartHeader(file: File): Promise<PartHeader | undefined> {
  try {
    const head = await file.slice(0, 64 * 1024).text();
    const firstLine = head.split("\n", 1)[0] ?? "";
    const parsed = JSON.parse(firstLine) as Partial<PartHeader> & { kind?: string };
    if (parsed.kind !== "loctt-backup") return undefined;
    if (typeof parsed.part !== "number" || typeof parsed.parts !== "number") return undefined;
    if (typeof parsed.backup_id !== "string") return undefined;
    return { part: parsed.part, parts: parsed.parts, backup_id: parsed.backup_id };
  } catch {
    return undefined;
  }
}

export function BackupPanel() {
  const [selected, setSelected] = useState<readonly SelectedPart[]>([]);
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
  const canSubmit = selected.length > 0 && !busy && (!needsConfirm || confirmed);

  // How many parts the selected set says it has, when every readable
  // header agrees. Disagreement (files from two different exports) is
  // left to core, which names the offending file — guessing here would
  // duplicate a check that already produces a better message.
  const expectedParts = (() => {
    const headers = selected.flatMap(s2 => (s2.header ? [s2.header] : []));
    if (headers.length === 0) return undefined;
    const first = headers[0];
    if (first === undefined) return undefined;
    return headers.every(h => h.parts === first.parts && h.backup_id === first.backup_id)
      ? first.parts
      : undefined;
  })();

  async function runRestore(dryRun: boolean) {
    if (selected.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setReport(null);
    const params = new URLSearchParams({ mode });
    if (dryRun) params.set("dry_run", "true");
    // Only send confirm on a real destructive run; a dry run writes
    // nothing and the server exempts it.
    if (needsConfirm && !dryRun && confirmed) params.set("confirm", "true");
    try {
      // Every selected part goes up as its own `file` part; the server
      // writes each to a temp path and hands core the array.
      const result = await apiClient.postFile<RestoreReport>(
        `/api/backup/restore?${params.toString()}`,
        selected.map(s2 => s2.file),
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
    <div data-testid="backup-panel">
      <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
        Backup &amp; restore
      </h1>

      {/* ---- Export ---- */}
      <section className="mb-8" data-testid="backup-export">
        <h2 className="mb-2 text-[1rem] font-semibold text-text-primary">Export</h2>
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
        <h2 className="mb-2 text-[1rem] font-semibold text-text-primary">Restore</h2>

        {/* UI ticket, 2026-09-23: was a bare `<input type="file">`, so
            the browser's native "Choose file(s) / No file chosen" widget
            sat among the app's custom controls — the defect Ken flagged
            from a live walkthrough. `ui/FilePicker.tsx` now owns the
            hidden input; only the input mechanics moved — the split-
            backup header-reading logic below is unchanged (Ken ruled
            that stays separate from this ticket). */}
        <p className="mb-1 text-[0.9286rem] text-text-secondary">
          Backup file
        </p>
        <div className="mb-3">
          <FilePicker
            multiple
            accept=".jsonl,.ndjson,application/x-ndjson,text/plain"
            testId="backup-restore-file"
            onFiles={(fileList) => {
              const files = Array.from(fileList ?? []);
              setReport(null);
              setErrorMsg(null);
              // Show the files immediately; fill in each header as it is
              // read, so a large selection never blocks the UI.
              setSelected(files.map(f => ({ file: f })));
              void Promise.all(
                files.map(async (f): Promise<SelectedPart> => {
                  const header = await readPartHeader(f);
                  // `exactOptionalPropertyTypes`: an absent header is an
                  // absent property, not a present `undefined` one.
                  return header === undefined ? { file: f } : { file: f, header };
                }),
              ).then((withHeaders) => {
                // Ignore a stale read whose selection has been replaced.
                setSelected(current =>
                  current.length === withHeaders.length
                    && current.every((c, i) => c.file === withHeaders[i]?.file)
                    ? withHeaders
                    : current);
              });
            }}
          >
            Choose file(s)
          </FilePicker>
        </div>

        {selected.length > 0 && (
          <div
            data-testid="backup-restore-selection"
            className="mb-3 text-[0.9286rem] text-text-secondary"
          >
            <p className="m-0">
              {expectedParts !== undefined && expectedParts > 1
                ? `${selected.length} of ${expectedParts} parts selected`
                : `${selected.length} file${selected.length === 1 ? "" : "s"} selected`}
              {expectedParts !== undefined && expectedParts > 1
                && selected.length < expectedParts
                && " Select every part of the backup."}
            </p>
            <ul className="m-0 mt-1 list-disc pl-5">
              {selected.map(s2 => (
                <li key={s2.file.name} data-testid="backup-restore-selected-part">
                  {s2.file.name}
                  {s2.header
                    ? s2.header.parts > 1
                      ? ` — part ${String(s2.header.part)} of ${String(s2.header.parts)}`
                      : " — a complete backup"
                    : " — not recognised as a backup"}
                </li>
              ))}
            </ul>
          </div>
        )}

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
              Overwrite replaces every task in this backup and can
              lose work. Type{" "}
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
            disabled={selected.length === 0 || busy}
            onClick={() => { void runRestore(true); }}
          >
            Preview (dry run)
          </Button>
          <Button
            type="button"
            variant="primary"
            testId="backup-restore-submit"
            // `canSubmit` already folds in `busy`; `loading` re-states it
            // as the visible busy signal (A307) rather than swapping the
            // label, which changed the button's width mid-restore.
            disabled={!canSubmit}
            loading={busy}
            // The label is hidden while loading, so the button would go
            // nameless without this — its text was its only accessible
            // name.
            aria-label="Restore"
            onClick={() => { void runRestore(false); }}
          >
            Restore
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
                ? `Dry run (${report.mode}). Nothing was written.`
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
                {report.reallocatedKeys.length === 1 ? " was" : "s were"} given a new key.
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
