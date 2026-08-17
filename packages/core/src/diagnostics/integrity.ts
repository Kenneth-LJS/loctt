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

import { getCommentsFilePath, getTasksDir } from "../paths/index.js";
import { isMalformedComment, listCommentEntries } from "../task/comments.js";
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
 * Comments are the first store to gain P-11's keep-and-merge
 * behaviour, so they are the first this reports on. History and the
 * config slices follow the same shape when they gain it.
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
