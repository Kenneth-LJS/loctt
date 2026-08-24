/**
 * Finds data LocTT kept but could not fully interpret.
 *
 * P-11 keeps a malformed entry rather than dropping it — but keeping
 * without telling anyone means the bad entry sits there forever and the
 * ordering quietly stops meaning anything. This is the other half of
 * that rule: the same scan feeds `doctor` (tell me what is wrong now)
 * and sync pre-flight (do not let me publish this).
 *
 * Two severities, and the difference is load-bearing:
 *
 *   - `unreadable` — a file that exists and could not be read or
 *     parsed. LocTT cannot vouch for anything in it, and a write would
 *     overwrite content nobody saw. **Blocks a publish.**
 *   - `malformed` — a readable file holding an entry LocTT cannot
 *     interpret. The entry is kept and merged, so the data is intact
 *     and publishing it is safe. **Reported, never blocking** — a
 *     malformed entry must not make a tracker unpublishable, which
 *     would be destruction by another route.
 */

import { getCommentsFilePath, getHistoryFilePath, getTasksDir } from "../paths/index.js";
import { isMalformedComment, listCommentEntries } from "../task/comments.js";
import { isMalformedHistoryEntry, readHistoryRows } from "../task/history.js";
import { listTaskIds } from "../task/list-ids.js";
import { UnreadableFileError } from "../utils/read-state.js";

export type IntegritySeverity = "unreadable" | "malformed";

export interface IntegrityFinding {
  readonly severity: IntegritySeverity;
  /** The file the problem is in, so the user can go and fix it. */
  readonly path: string;
  /** One sentence a surface can print verbatim. */
  readonly message: string;
}

/**
 * Scans every task's comment thread.
 *
 * Comments and history both carry P-11's keep-and-merge behaviour, and
 * both are reported here. Config is deliberately **not** — see V9: a
 * config value is a definition other data references rather than a
 * record of an event, so LocTT refuses to write rather than building
 * around the damage.
 */
export async function checkDataIntegrity(locttDir: string): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];

  let taskIds: string[];
  try {
    taskIds = await listTaskIds(locttDir);
  } catch (err) {
    findings.push({
      severity: "unreadable",
      path: getTasksDir(locttDir),
      message: `the tasks directory could not be listed: ${messageOf(err)}`,
    });
    return findings;
  }

  for (const taskId of taskIds) {
    const path = getCommentsFilePath(locttDir, taskId);
    try {
      const entries = await listCommentEntries(locttDir, taskId);
      for (const entry of entries) {
        if (!isMalformedComment(entry)) continue;
        findings.push({
          severity: "malformed",
          path,
          message:
            `comment entry ${String(entry.index + 1)} cannot be read as a comment `
            + `(a comment needs an id, an author and a body). It has been kept in `
            + `place and is preserved by every write; repair it by hand to have it `
            + `render again.`,
        });
      }
    } catch (err) {
      // Both the unreadable-file and will-not-parse cases land here,
      // and both mean the same thing: we cannot vouch for the contents.
      findings.push({
        severity: "unreadable",
        path,
        message: err instanceof UnreadableFileError
          ? err.message
          : `could not be read: ${messageOf(err)}`,
      });
    }

    const historyPath = getHistoryFilePath(locttDir, taskId);
    try {
      for (const row of await readHistoryRows(locttDir, taskId)) {
        if (!isMalformedHistoryEntry(row)) continue;
        findings.push({
          severity: "malformed",
          path: historyPath,
          message:
            `history entry ${String(row.index + 1)} cannot be read as an entry `
            + `(an entry needs a timestamp and a kind). It has been kept in place `
            + `and is preserved by every write and every merge; repair it by hand `
            + `to have it appear in the activity log again.`,
        });
      }
    } catch (err) {
      findings.push({
        severity: "unreadable",
        path: historyPath,
        message: err instanceof UnreadableFileError
          ? err.message
          : `could not be read: ${messageOf(err)}`,
      });
    }
  }

  return findings;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The findings that must stop a publish. See the module comment. */
export function blockingFindings(
  findings: ReadonlyArray<IntegrityFinding>,
): IntegrityFinding[] {
  return findings.filter(f => f.severity === "unreadable");
}
