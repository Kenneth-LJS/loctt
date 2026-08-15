import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

/** Parses a raw `task.md` into frontmatter + body. */
function readTaskFile(raw: string): Task {
  const { rawYaml, body } = splitTaskFile(raw);
  return { frontmatter: parseFrontmatter(rawYaml), body };
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
        const out = mergeTask(readTaskFile(localRaw), readTaskFile(incomingRaw));
        merged.push({
          path: conflict.path,
          content: assembleTaskFile(out.merged.frontmatter, out.merged.body),
        });
        if (out.displaced) {
          // Beside the task, not inside it: task.md's frontmatter is
          // schema-checked, and a second body cannot live there.
          const dir = conflict.path.slice(0, -basename(conflict.path).length);
          displaced.push({
            path: `${dir}task.${out.displaced.label}.md`,
            content: out.displaced.content,
          });
        }
        continue;
      }

      if (isHistoryFile(conflict.path)) {
        const a = (parseYaml(localRaw) ?? []) as HistoryEntry[];
        const b = (parseYaml(incomingRaw) ?? []) as HistoryEntry[];
        merged.push({
          path: conflict.path,
          content: stringifyYaml(mergeHistory(a, b)),
        });
        continue;
      }

      if (isCommentsFile(conflict.path)) {
        const a = (parseYaml(localRaw) ?? []) as MergeableComment[];
        const b = (parseYaml(incomingRaw) ?? []) as MergeableComment[];
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
        // `queries:`); merge the list and keep the rest of the incoming
        // document.
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
            id: string; prefix: string; created_at?: string;
          }[];
          const assigned = assignProvisionalPrefixes(projects);
          list = projects.map(p => ({
            ...p,
            prefix: assigned.get(p.id) ?? p.prefix,
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

  return { merged, displaced, unresolved };
}

/** Writes a resolved merge into the local tree. */
export async function applyResolution(
  result: ResolveResult,
  localDir: string,
): Promise<void> {
  for (const f of [...result.merged, ...result.displaced]) {
    await writeFile(join(localDir, f.path), f.content, "utf-8");
  }
}
