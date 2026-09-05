import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { HistoryEntry, Task } from "@loctt/contracts";
import { LocttStateSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  assembleTaskFile,
  parseFrontmatter,
  splitTaskFile,
} from "../task/frontmatter.js";
import {
  assignProvisionalPrefixes,
  assignProvisionalSlugs,
  deriveKeyState,
  type MergeableComment,
  mergeById,
  mergeComments,
  mergeHistory,
  mergeTask,
} from "./merge.js";
import type { PathPlan } from "./three-way.js";

/**
 * Applies the field-level merge rules to the paths `planSync` marked as
 * conflicts.
 *
 * Sync previously aborted on any such path. That was safe but meant two
 * clones which each created a task could never merge at all — both bump
 * `state.yaml`, so it stopped before task files were even compared.
 *
 * Everything here writes to the **local** tree only after every path has
 * merged successfully. A path this cannot merge is returned unresolved,
 * and the caller aborts exactly as before — a partially-merged tracker
 * is worse than an un-merged one.
 */

export interface ResolveResult {
  /** Paths merged, with their new content, ready to write. */
  readonly merged: readonly { path: string; content: string }[];
  /**
   * Losing bodies to preserve alongside their task (M4), as
   * `<taskdir>/task.<label>.md`.
   */
  readonly displaced: readonly { path: string; content: string }[];
  /** Paths this cannot merge; the caller aborts on a non-empty list. */
  readonly unresolved: readonly PathPlan[];
}

/**
 * Parses a raw `task.md` into a Task, carrying `health` (§ 13.2 B2).
 *
 * Tolerant: a field-local corruption on either side degrades into
 * `health` rather than throwing, and `health` is threaded to
 * `assembleTaskFile` so the merged output re-emits the preserved raw
 * value — a corrupt or unrecognised field must survive a git merge, not
 * be dropped by an assemble that forgot it.
 */
function readTaskFile(raw: string): Task {
  const { rawYaml, body } = splitTaskFile(raw);
  const { frontmatter, health } = parseFrontmatter(rawYaml);
  return { frontmatter, body, ...(health.length > 0 ? { health } : {}) };
}

/** Recognises `tasks/<id>/task.md`. */
function isTaskFile(path: string): boolean {
  return /^tasks\/[^/]+\/task\.md$/.test(path);
}

function isHistoryFile(path: string): boolean {
  return /^tasks\/[^/]+\/_history\.yaml$/.test(path);
}

function isCommentsFile(path: string): boolean {
  return /^tasks\/[^/]+\/_comments\.yaml$/.test(path);
}

/**
 * Config files merged by unioning entries on `id`. `state.yaml` is
 * deliberately absent: its counters are handled by M1's renumber-and-
 * derive pass, not by a union.
 */
const ID_UNION_FILES: ReadonlySet<string> = new Set([
  "config/projects.yaml",
  "config/queries.yaml",
]);

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Merges every conflicting path, or reports the ones it cannot.
 *
 * Pure with respect to the filesystem: it reads both versions and
 * returns content to write, so the caller decides when anything lands.
 */
/**
 * Parses a YAML list file from one side of a merge.
 *
 * The previous `as HistoryEntry[]` / `as MergeableComment[]` casts were
 * assertions about data this process did not write: the incoming side
 * comes off a branch another machine published, and a hand-edited or
 * truncated file reached the merge functions as whatever it happened to
 * be. A non-array (a map, a scalar, `null` from a file of only
 * comments) then flowed into `mergeHistory`, which iterates it.
 *
 * Throwing routes the path to `unresolved` via the loop's own catch,
 * which is the honest outcome — a file we cannot read is a file we
 * cannot merge, and the user still has both versions intact.
 */
function parseYamlList<T>(raw: string | undefined, path: string, kind: string): T[] {
  const parsed: unknown = parseYaml(raw ?? "");
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} is not a list of ${kind} entries`);
  }
  return parsed as T[];
}

export async function resolveConflicts(
  conflicts: readonly PathPlan[],
  incomingDir: string,
  localDir: string,
  /**
   * The merged task set, for deriving key counters (M1). Omit to leave
   * `state.yaml` unresolvable, which is the pre-M1 behaviour.
   */
  mergedTasks?: readonly Task[],
): Promise<ResolveResult> {
  const merged: { path: string; content: string }[] = [];
  const displaced: { path: string; content: string }[] = [];
  const unresolved: PathPlan[] = [];
  /** `merge_resolved` entries owed to a `_history.yaml`, folded in after the loop. */
  const pendingHistory = new Map<string, HistoryEntry[]>();

  for (const conflict of conflicts) {
    const localPath = join(localDir, conflict.path);
    const incomingPath = join(incomingDir, conflict.path);
    const localRaw = await readIfPresent(localPath);
    const incomingRaw = await readIfPresent(incomingPath);

    // A conflict where one side is unreadable is not a merge problem —
    // planSync should not have produced it. Abort rather than guess.
    if (localRaw === undefined || incomingRaw === undefined) {
      unresolved.push({
        ...conflict,
        reason: "one side could not be read",
      });
      continue;
    }

    try {
      if (isTaskFile(conflict.path)) {
        // Per-field resolution reads the union of both sides' history
        // (M2). Read the sibling `_history.yaml` directly rather than
        // waiting for it to appear as its own conflict: the task can
        // conflict while the history file does not, and every field
        // would then fall back for want of evidence sitting on disk.
        const dir = conflict.path.slice(0, -basename(conflict.path).length);
        const historyPath = `${dir}_history.yaml`;
        const localHistory = parseYamlList<HistoryEntry>(
          await readIfPresent(join(localDir, historyPath)), historyPath, "history",
        );
        const incomingHistory = parseYamlList<HistoryEntry>(
          await readIfPresent(join(incomingDir, historyPath)), historyPath, "history",
        );
        const history = mergeHistory(localHistory, incomingHistory);

        const out = mergeTask(readTaskFile(localRaw), readTaskFile(incomingRaw), history);
        merged.push({
          path: conflict.path,
          content: assembleTaskFile(out.merged),
        });
        // Buffer rather than push: `_history.yaml` may also arrive as
        // its own conflict in this same loop, and two entries for one
        // path would both write and double-count.
        if (out.historyAdditions !== undefined && out.historyAdditions.length > 0) {
          pendingHistory.set(historyPath, [
            ...(pendingHistory.get(historyPath) ?? []),
            ...out.historyAdditions,
          ]);
        }
        if (out.displaced) {
          // Beside the task, not inside it: task.md's frontmatter is
          // schema-checked, and a second body cannot live there.
          displaced.push({
            path: `${dir}task.${out.displaced.label}.md`,
            content: out.displaced.content,
          });
        }
        continue;
      }

      if (isHistoryFile(conflict.path)) {
        const a = parseYamlList<HistoryEntry>(localRaw, conflict.path, "history");
        const b = parseYamlList<HistoryEntry>(incomingRaw, conflict.path, "history");
        merged.push({
          path: conflict.path,
          content: stringifyYaml(mergeHistory(a, b)),
        });
        continue;
      }

      if (isCommentsFile(conflict.path)) {
        const a = parseYamlList<MergeableComment>(localRaw, conflict.path, "comment");
        const b = parseYamlList<MergeableComment>(incomingRaw, conflict.path, "comment");
        merged.push({
          path: conflict.path,
          content: stringifyYaml(mergeComments(a, b)),
        });
        continue;
      }

      if (conflict.path === "state.yaml" && mergedTasks !== undefined) {
        // M1: renumber-and-derive, not arithmetic. The counter comes
        // from the keys that exist after the merge, so it cannot
        // disagree with the tasks on disk.
        const a = LocttStateSchema.parse(parseYaml(localRaw));
        const b = LocttStateSchema.parse(parseYaml(incomingRaw));
        merged.push({
          path: conflict.path,
          content: stringifyYaml(deriveKeyState(a, b, mergedTasks)),
        });
        continue;
      }

      if (ID_UNION_FILES.has(conflict.path)) {
        const a = parseYaml(localRaw) as Record<string, unknown>;
        const b = parseYaml(incomingRaw) as Record<string, unknown>;
        // These files wrap their list in a named key (`projects:`,
        // `queries:`). The list is unioned by id; the document's other
        // keys — `default` on projects.yaml — resolve **local-wins**,
        // which is what `{ ...b, ...a }` does with `a` local.
        //
        // The comment here used to say "keep the rest of the incoming
        // document", the exact opposite of the code. Local-wins is the
        // intended rule (decided 2026-08-16): the default project is a
        // per-checkout working preference, and having a sync silently
        // repoint it is worse than having two clones disagree.
        const key = conflict.path.includes("projects") ? "projects" : "queries";
        const listA = (a[key] ?? []) as { id: string }[];
        const listB = (b[key] ?? []) as { id: string }[];
        let list = mergeById(listA, listB);

        if (key === "projects") {
          // Two independently-init'ed trackers both mint `T-`, so the
          // union can hold two projects with one prefix — which
          // ProjectsConfigSchema rejects outright. Assign provisional
          // prefixes here, before writing, rather than after: the file
          // cannot be loaded again once it is invalid.
          const projects = list as unknown as {
            id: string; prefix: string; slug?: string; created_at?: string;
          }[];
          const assigned = assignProvisionalPrefixes(projects);
          // Slugs collide for exactly the same reason and are rejected
          // by the same schema, so they are de-duplicated in the same
          // pass — otherwise the file is still unloadable after the
          // prefix fix (K3, A60).
          const assignedSlugs = assignProvisionalSlugs(projects);
          list = projects.map(p => ({
            ...p,
            prefix: assigned.get(p.id) ?? p.prefix,
            ...(p.slug !== undefined
              ? { slug: assignedSlugs.get(p.id) ?? p.slug }
              : {}),
          })) as unknown as { id: string }[];
        }

        merged.push({
          path: conflict.path,
          content: stringifyYaml({ ...b, ...a, [key]: list }),
        });
        continue;
      }

      // Anything else — state.yaml, workflow.yaml, an attachment — has
      // no rule yet. Abort rather than pick a side silently.
      unresolved.push({ ...conflict, reason: "no merge rule for this file" });
    } catch (err) {
      // A parse failure means one side is malformed. Merging it would
      // turn a recoverable state into a written-out mess.
      unresolved.push({
        ...conflict,
        reason: `could not merge: ${(err as Error).message}`,
      });
    }
  }

  // Fold fallback entries in after the loop, so a `_history.yaml` that
  // was also its own conflict is amended in place rather than written
  // twice — one merged entry per path.
  for (const [path, additions] of pendingHistory) {
    const existing = merged.find(m => m.path === path);
    if (existing !== undefined) {
      const current = parseYamlList<HistoryEntry>(existing.content, path, "history");
      merged[merged.indexOf(existing)] = {
        path,
        content: stringifyYaml(mergeHistory(current, additions)),
      };
      continue;
    }
    const onDisk = parseYamlList<HistoryEntry>(
      await readIfPresent(join(localDir, path)), path, "history",
    );
    merged.push({ path, content: stringifyYaml(mergeHistory(onDisk, additions)) });
  }

  return { merged, displaced, unresolved };
}

/** Writes a resolved merge into the local tree. */
export async function applyResolution(
  result: ResolveResult,
  localDir: string,
): Promise<void> {
  for (const f of [...result.merged, ...result.displaced]) {
    const dest = join(localDir, f.path);
    // `applyPlan` mkdirs before every copy; this path did not, so a
    // displaced file whose directory does not exist locally threw
    // ENOENT partway through the loop — leaving some resolutions
    // applied and some not, which is the one outcome the
    // abort-before-writing design exists to prevent.
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf-8");
  }
}
