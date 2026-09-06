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
 *   - `inconsistent` — every file parses, but they disagree with each
 *     other: a relationship with no matching inverse on its target
 *     (P-12). Nothing is lost and nothing is at risk, so this is
 *     **reported, never blocking** — it is a correctness problem for
 *     the user to resolve, not a reason to refuse their publish.
 */

import type { BrokenEntry } from "@loctt/contracts";

import { getCalendarConfigPath, loadCalendarConfig } from "../config/calendar.js";
import { getLabelsConfigPath, loadLabelsConfig } from "../config/labels.js";
import { loadListViewConfig } from "../config/list-view.js";
import { getMilestonesConfigPath, loadMilestonesConfig } from "../config/milestones.js";
import { getProjectsConfigPath, loadProjectsConfig } from "../config/projects.js";
import { loadQueriesConfig } from "../config/queries.js";
import { getSprintsConfigPath, loadSprintsConfig } from "../config/sprints.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import {
  getCommentsFilePath,
  getHistoryFilePath,
  getListViewConfigPath,
  getQueriesConfigPath,
  getTaskFilePath,
  getTasksDir,
  getWorkflowConfigPath,
} from "../paths/index.js";
import { getUserProfilePath } from "../paths/index.js";
import { isMalformedComment, listCommentEntries } from "../task/comments.js";
import { TaskParseError } from "../task/frontmatter.js";
import { isMalformedHistoryEntry, readHistoryRows } from "../task/history.js";
import { readTask } from "../task/io.js";
import { listTaskIds } from "../task/list-ids.js";
import { validateRelationships } from "../task/traversal.js";
import { loadAllUsersDetailed } from "../users/profile.js";
import { collectSidebarGroupsDrops } from "../users/settings.js";
import { isMissingFile, readFileState, UnreadableFileError } from "../utils/read-state.js";

export type IntegritySeverity = "unreadable" | "malformed" | "inconsistent";

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
            + `(it needs a timestamp and a recognised kind). It has been kept in place `
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

    // Task frontmatter field-health (proposal § 10). `readTask` is
    // tolerant: a field-local corruption degrades into `health` (reported
    // here as `malformed`, non-blocking — the data is preserved), while
    // object-fatal corruption throws TaskParseError (reported as
    // `unreadable`, which blocks a publish, exactly as before).
    const taskPath = getTaskFilePath(locttDir, taskId);
    try {
      const task = await readTask(locttDir, taskId);
      for (const h of task.health ?? []) {
        findings.push({
          severity: "malformed",
          path: taskPath,
          message:
            `field "${h.field}" ${h.kind === "unrecognised" ? "is not recognised" : "is corrupt"} `
            + `(${h.kind}: ${h.rawText || "malformed"} — ${h.error}). It has been kept `
            + `in place and is preserved by every write; repair it with `
            + `\`loctt set\` / \`loctt unset\`, or edit the file by hand.`,
        });
      }
    } catch (err) {
      if (err instanceof TaskParseError) {
        findings.push({
          severity: "unreadable",
          path: taskPath,
          message: `task.md could not be parsed: ${messageOf(err)}`,
        });
      } else if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        findings.push({
          severity: "unreadable",
          path: taskPath,
          message: `could not be read: ${messageOf(err)}`,
        });
      }
      // ENOENT: a directory with no task.md is not a task — skip.
    }
  }

  // P-12: cross-file agreement. Every file above can parse perfectly
  // and still disagree with its neighbour — a relationship whose
  // inverse is missing from the target is invisible from that end.
  // LocTT writes both sides itself, so a one-sided edge means a
  // hand-edit or a `git pull`.
  try {
    const config = await loadWorkflowConfig(locttDir);
    for (const err of await validateRelationships(locttDir, config)) {
      findings.push({
        severity: "inconsistent",
        path: getTaskFilePath(locttDir, err.taskId),
        message: `${err.field}: ${err.message}`,
      });
    }
  } catch (err) {
    // An **absent** workflow.yaml means there is no relationship
    // vocabulary to check against — a state doctor already reports
    // under its own check, and one every fixture without a config is
    // in. Reporting it here too would fire on every fresh tracker.
    //
    // A workflow.yaml that exists and cannot be read is different: the
    // check silently did not run, and saying nothing would imply it
    // passed.
    if (!isMissingFile(err)) {
      findings.push({
        severity: "unreadable",
        path: getWorkflowConfigPath(locttDir),
        message: err instanceof UnreadableFileError
          ? err.message
          : `relationship consistency could not be checked: ${messageOf(err)}`,
      });
    }
  }

  // Config values LocTT kept but could not use. A label's colour is
  // cosmetic: `parseLabelsConfig` drops a non-hex value rather than
  // refusing the file, because the label still has an id and a name
  // and every task pointing at it must keep rendering (MSL-22). That
  // makes the bad value invisible unless something reports it — which
  // is this, and why the case asks for it to be "surfaced as a fixable
  // config problem naming the label and the bad value".
  try {
    const raw = await readFileState(getLabelsConfigPath(locttDir));
    if (raw.state === "loaded") {
      for (const { name, color } of invalidLabelColors(raw.content)) {
        findings.push({
          severity: "inconsistent",
          path: getLabelsConfigPath(locttDir),
          message:
            `label "${name}" has colour "${color}", which is not a hex value `
            + `(e.g. #1e6fcb or #f00). The label still renders, with the `
            + `default colour; fix the value to restore its own.`,
        });
      }
    }
  } catch {
    // An unreadable labels.yaml is already the loader's business and
    // is reported wherever that surfaces. Nothing to add here.
  }

  // Config per-entry degradation (A138 / K28). A corrupt entry in a
  // list-shaped config loads as a `BrokenEntry` and the rest of the file
  // still loads — the same keep-and-report contract as a task field or a
  // malformed comment. Without this sweep the preserved entry is
  // invisible: the config loads "fine" (minus one row) and nobody ever
  // learns the row is broken. `malformed`, never blocking — the entry is
  // preserved and the tracker works (a config *parse* error, which is
  // object-fatal, is a different thing and is reported by doctor's
  // per-file parse check).
  await collectConfigBroken(
    findings,
    getProjectsConfigPath(locttDir),
    () => loadProjectsConfig(locttDir).then(c => c.broken),
    "project",
  );
  await collectConfigBroken(
    findings,
    getLabelsConfigPath(locttDir),
    () => loadLabelsConfig(locttDir).then(c => c.broken),
    "label",
  );
  await collectConfigBroken(
    findings,
    getMilestonesConfigPath(locttDir),
    () => loadMilestonesConfig(locttDir).then(c => c.broken),
    "milestone",
  );
  await collectConfigBroken(
    findings,
    getSprintsConfigPath(locttDir),
    () => loadSprintsConfig(locttDir).then(c => c.broken),
    "sprint",
  );
  await collectConfigBroken(
    findings,
    getQueriesConfigPath(locttDir),
    () => loadQueriesConfig(locttDir).then(c => c.broken),
    "saved view",
  );
  await collectConfigBroken(
    findings,
    getListViewConfigPath(locttDir),
    () => loadListViewConfig(locttDir).then(c => c.broken),
    "list-view chip",
  );
  await collectConfigBroken(
    findings,
    getCalendarConfigPath(locttDir),
    () => loadCalendarConfig(locttDir).then(c => c.broken),
    "holiday",
  );
  // workflow.yaml's `broken` is a keyed record (one BrokenEntry[] per
  // sub-list), so it is flattened across sub-lists here.
  await collectConfigBroken(
    findings,
    getWorkflowConfigPath(locttDir),
    async () => {
      const wf = await loadWorkflowConfig(locttDir);
      if (!wf.broken) return undefined;
      return Object.values(wf.broken).flat().filter((e): e is BrokenEntry => e !== undefined);
    },
    "workflow entry",
  );

  // User profiles. A profile degrades per-FIELD like a task: a bad
  // timezone / wrong-typed known key / unrecognised key lifts into
  // `health` and only `id` is object-fatal (K13). `loadAllUsersDetailed`
  // keeps the readable profiles (each carrying its `health`) and reports
  // the ones it could not read — so both halves surface here: a degraded
  // field is `malformed` (preserved), an unreadable profile is
  // `unreadable` (blocks a publish, same as an unreadable task).
  try {
    const { profiles, unreadable } = await loadAllUsersDetailed(locttDir);
    for (const u of unreadable) {
      findings.push({
        severity: "unreadable",
        path: u.path,
        message: `user profile could not be read: ${u.reason}`,
      });
    }
    for (const p of profiles) {
      for (const h of p.health ?? []) {
        findings.push({
          severity: "malformed",
          path: getUserProfilePath(locttDir, p.id),
          message:
            `field "${h.field}" ${h.kind === "unrecognised" ? "is not recognised" : "is corrupt"} `
            + `(${h.kind}: ${h.rawText || "malformed"} — ${h.error}). It has been kept `
            + `in place and is preserved by every write; repair the profile to have it load again.`,
        });
      }
    }
  } catch {
    // The users dir being absent is normal; anything else that throws
    // here (a scan error) is not corruption-of-a-record and is left to
    // doctor's own users/ load check.
  }

  // Per-user `sidebar_groups` salvage (SHL-45). A hand-edited unknown or
  // duplicate id is lifted out on load so the sidebar still renders (P7);
  // that silent salvage is exactly what doctor must name. `malformed`,
  // never blocking — the setting is a preserved-and-salvaged render pref,
  // and the valid ids still load.
  try {
    for (const report of await collectSidebarGroupsDrops(locttDir)) {
      if (report.wholeValueDropped) {
        findings.push({
          severity: "malformed",
          path: report.path,
          message:
            `setting "sidebar_groups" is not a valid { order?, hidden? } object, `
            + `so it was ignored (the sidebar falls back to the default order, all `
            + `groups visible). Repair or remove it to customize the sidebar again.`,
        });
      }
      for (const d of report.dropped) {
        const what =
          d.reason === "duplicate"
            ? `references a duplicate id "${d.id}"`
            : d.reason === "unknown"
              ? `references an unknown sidebar id "${d.id}"`
              // malformed: a non-list value, a non-string element, or a
              // stray/typo'd key — the id field carries a safe description.
              : `has a malformed part (${d.id})`;
        findings.push({
          severity: "malformed",
          path: report.path,
          message:
            `setting "sidebar_groups.${d.list}" ${what}, `
            + `which was dropped on load (any other valid ids in the list are kept). `
            + `Repair it by hand, or re-save it through the app, to remove this notice.`,
        });
      }
    }
  } catch {
    // The users dir being absent is normal; a scan error here is left to
    // doctor's own users/ load check, same as the profile loop above.
  }

  return findings;
}

/**
 * Label colours the schema would reject, read from the raw YAML.
 *
 * Read raw rather than through `loadLabelsConfig`, which drops these
 * on the way past — by the time a parsed config exists, the bad value
 * is gone and there is nothing left to report.
 */
function invalidLabelColors(yamlContent: string): { name: string; color: string }[] {
  const out: { name: string; color: string }[] = [];
  let name = "";
  for (const line of yamlContent.split("\n")) {
    const n = /^\s*(?:- )?name:\s*(.+?)\s*$/.exec(line);
    if (n?.[1] !== undefined) { name = n[1]; continue; }
    const c = /^\s*color:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (c?.[1] === undefined) continue;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c[1])) continue;
    out.push({ name, color: c[1] });
  }
  return out;
}

/**
 * The subset of a degraded config entry this sweep needs. Both
 * `BrokenEntry` (flat configs, workflow sub-lists) and `BrokenSavedQuery`
 * (queries — a wider shape with no `rawText`) satisfy it, so one helper
 * serves every config.
 */
interface BrokenLike {
  readonly id?: string | undefined;
  readonly index: number;
  readonly error: string;
}

/**
 * Loads one config's `broken` list and appends a `malformed` finding per
 * degraded entry. Tolerates the file being absent or unreadable by
 * staying silent: a parse error is already reported by doctor's own
 * per-file check, and an absent optional config is normal. The label
 * (`"sprint"`, `"label"`, …) names the entry kind in the message.
 */
async function collectConfigBroken(
  findings: IntegrityFinding[],
  path: string,
  loadBroken: () => Promise<readonly BrokenLike[] | undefined>,
  label: string,
): Promise<void> {
  let broken: readonly BrokenLike[] | undefined;
  try {
    broken = await loadBroken();
  } catch {
    // Object-fatal parse error / absent file — doctor's per-file check
    // owns that; nothing to add here.
    return;
  }
  for (const b of broken ?? []) {
    const which = b.id !== undefined ? `"${b.id}"` : `at position ${String(b.index + 1)}`;
    findings.push({
      severity: "malformed",
      path,
      message:
        `${label} ${which} could not be read (${b.error}). It has been kept `
        + `in place and is preserved by every write; repair it by hand, or `
        + `re-save it through the app, to have it load again.`,
    });
  }
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
