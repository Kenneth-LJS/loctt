import { readFile, rm } from "node:fs/promises";

import type { LocttState, PrefixRenameState, Task } from "@loctt/contracts";
import { PrefixRenameStateSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { loadProjectsConfig, saveProjectsConfig } from "../config/projects.js";
import { formatZodIssues } from "../config/zod-error.js";
import { getPrefixRenameStatePath } from "../paths/index.js";
import { rebuildKeyIndex } from "../state/key-index.js";
import { appendKeyHistory } from "../state/keys.js";
import { withStateLock } from "../state/lock.js";
import { loadState, saveState } from "../state/state.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { ProjectError } from "./manage.js";

/**
 * The task-key prefix format (K88 / A80). Bare uppercase letters, 1–10 —
 * the `-` separator is inserted at key render (`T` → `T-1`), so it is NOT
 * part of the stored prefix. Strict: a dash, lowercase, digit, or
 * punctuation is rejected, never normalised, so a caller cannot smuggle a
 * URL-breaking or ambiguous prefix past this.
 */
export const PREFIX_RE = /^[A-Z]{1,10}$/;

/** Throws `ProjectError` if `prefix` is not a valid bare key prefix. */
export function assertValidPrefix(prefix: string): void {
  if (!PREFIX_RE.test(prefix)) {
    throw new ProjectError(
      `invalid key prefix "${prefix}": use 1–10 uppercase letters (A–Z) `
      + `with no dash — the "-" separator is added automatically, so "WEB" `
      + `produces keys like "WEB-1".`,
    );
  }
}

/**
 * Changing a project's key prefix.
 *
 * The prefix is stored in four places that must agree: `projects.yaml`,
 * the counter in `state.yaml`, the `key` on every task in the project,
 * and the key index. A change is therefore a rewrite of all four, not a
 * config edit — which is why `editProject` refuses it and this exists
 * instead.
 *
 * Numbers are preserved: `T-3` becomes `WEB-3`, never `WEB-7`. Renumbering
 * would break every reference a user has written down, and there is no
 * reason for it — the counter is per project and already correct.
 */

export interface SetPrefixResult {
  readonly projectId: string;
  readonly from: string;
  readonly to: string;
  /** Tasks whose key was rewritten. */
  readonly renamed: number;
}

/** Reads the in-progress sentinel, or undefined when none exists. */
export async function readPrefixRenameState(
  locttDir: string,
): Promise<PrefixRenameState | undefined> {
  let content: string;
  try {
    content = await readFile(getPrefixRenameStatePath(locttDir), "utf-8");
  } catch {
    return undefined;
  }
  try {
    return PrefixRenameStateSchema.parse(parseYaml(content));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ProjectError(`prefix-rename.yaml is not valid: ${formatZodIssues("prefix rename state", err)}`);
    }
    throw err;
  }
}

/**
 * Rewrites every task in `projectId` from `from` to `to`.
 *
 * Idempotent by construction: a task already carrying `to` is skipped,
 * so re-running after a crash neither renames twice nor appends a
 * duplicate `key_history` entry. That is what makes the sentinel safe to
 * act on without knowing how far the previous attempt got.
 */
async function rewriteTaskKeys(
  locttDir: string,
  projectId: string,
  from: string,
  to: string,
): Promise<number> {
  const tasks = await loadAllTasks(locttDir);
  let renamed = 0;

  for (const task of tasks) {
    if (task.frontmatter.project !== projectId) continue;
    const key = task.frontmatter.key;
    if (!key.startsWith(from)) continue;

    const suffix = key.slice(from.length);
    const newKey = `${to}${suffix}`;
    const updated: Task = {
      ...task,
      frontmatter: {
        ...task.frontmatter,
        key: newKey,
        key_history: appendKeyHistory(task.frontmatter.key_history, key),
      },
    };
    await writeTask(locttDir, task.frontmatter.id, updated);
    renamed += 1;
  }

  return renamed;
}

/**
 * Applies the config half of a rename: the project's declared prefix and
 * its key counter. `next_number` is carried over untouched — the counter
 * tracks how many keys have been handed out, which a prefix change does
 * not alter. Resetting it would reissue keys that already exist.
 */
function applyToState(state: LocttState, projectId: string, to: string): void {
  const entry = state.keys[projectId];
  if (entry) {
    state.keys[projectId] = { prefix: to, next_number: entry.next_number };
  }
}

/**
 * Changes a project's key prefix, renaming every task in it.
 *
 * Throws `ProjectError` when the project is unknown or the prefix is
 * already held by another project — prefixes partition the key space, so
 * a duplicate would make keys ambiguous. Setting a project's own current
 * prefix is a no-op that succeeds without touching any task.
 */
export async function setProjectPrefix(
  locttDir: string,
  projectId: string,
  newPrefix: string,
): Promise<SetPrefixResult> {
  // K88/A80: strict bare-letters validation (the "-" is added at render).
  assertValidPrefix(newPrefix);

  return withStateLock(locttDir, async () => {
    const config = await loadProjectsConfig(locttDir);
    const target = config.projects.find(p => p.id === projectId);
    if (!target) throw new ProjectError(`unknown project: ${projectId}`);

    if (target.prefix === newPrefix) {
      return { projectId, from: newPrefix, to: newPrefix, renamed: 0 };
    }

    const clash = config.projects.find(
      p => p.id !== projectId && p.prefix === newPrefix,
    );
    if (clash) {
      throw new ProjectError(
        `prefix '${newPrefix}' is already used by project "${clash.name}" ` +
        `(${clash.id}) — prefixes must be unique`,
      );
    }

    const from = target.prefix;

    // The sentinel goes down *before* the first write and comes up after
    // the last. Everything between is recoverable; a crash outside it
    // means nothing was started or everything finished.
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: projectId,
      from,
      to: newPrefix,
      started_at: new Date().toISOString(),
    } satisfies PrefixRenameState);

    const state = await loadState(locttDir);
    applyToState(state, projectId, newPrefix);
    await saveState(locttDir, state);

    await saveProjectsConfig(locttDir, {
      projects: config.projects.map(p =>
        p.id === projectId ? { ...p, prefix: newPrefix } : p,
      ),
      ...(config.default !== undefined ? { default: config.default } : {}),
      ...(config.broken ? { broken: config.broken } : {}),
    });

    const renamed = await rewriteTaskKeys(locttDir, projectId, from, newPrefix);

    // Keys changed, so every cached key→id mapping is stale.
    await rebuildKeyIndex(locttDir);

    await rm(getPrefixRenameStatePath(locttDir), { force: true });

    return { projectId, from, to: newPrefix, renamed };
  });
}

/**
 * Boot hook: finishes an interrupted rename before a command runs.
 *
 * Unlike the schema-migration sentinel — which refuses to boot, because
 * a half-migrated tracker needs a human and a backup — a half-renamed
 * one repairs itself: `completeInterruptedPrefixRename` is idempotent
 * and needs nothing the sentinel does not already record. Refusing to
 * boot here would strand the user on a condition the code can fix.
 *
 * Never throws. A tracker with a stuck rename is degraded, not unusable,
 * and failing every command on it would take away the tools to
 * investigate — including `doctor`, which reports the pending rename.
 * The returned error is for callers that want to warn.
 */
export async function recoverInterruptedPrefixRename(
  locttDir: string,
): Promise<{ recovered?: SetPrefixResult; error?: Error }> {
  try {
    const recovered = await completeInterruptedPrefixRename(locttDir);
    return recovered ? { recovered } : {};
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Finishes a rename interrupted partway, if one was.
 *
 * Returns the completed rename, or undefined when there was nothing to
 * finish. Config and state may already have been written by the failed
 * attempt, so both are reapplied — each is idempotent — before the task
 * sweep picks up whatever is still on the old prefix.
 */
export async function completeInterruptedPrefixRename(
  locttDir: string,
): Promise<SetPrefixResult | undefined> {
  // Cheap pre-check outside the lock: the overwhelming majority of
  // calls have no sentinel and must not pay for a lock acquisition.
  if (!(await readPrefixRenameState(locttDir))) return undefined;

  return withStateLock(locttDir, async () => {
    // Re-read INSIDE the lock. The pre-check above is not the decision:
    // a page load fires several API requests in parallel and the web
    // middleware runs recovery on each, so two callers can both pass
    // it. The first recovers and reports `renamed: 1`; the second then
    // runs against an already-recovered tracker, finds no old keys, and
    // reports `renamed: 0` — overwriting a true count with a false one.
    // Measured: one curl → 1; three parallel curls → 0, with the task
    // correctly renamed. Silent, and in the direction that says "no
    // tasks were affected" when tasks were.
    //
    // Fixed here rather than in the web middleware so the CLI and MCP
    // get it too — both call this on the same auto-recover path.
    const pending = await readPrefixRenameState(locttDir);
    if (!pending) return undefined;

    const config = await loadProjectsConfig(locttDir);
    const target = config.projects.find(p => p.id === pending.project_id);
    if (!target) {
      // The project is gone — the rename cannot mean anything now, and
      // leaving the sentinel would block every future command.
      await rm(getPrefixRenameStatePath(locttDir), { force: true });
      return undefined;
    }

    if (target.prefix !== pending.to) {
      await saveProjectsConfig(locttDir, {
        projects: config.projects.map(p =>
          p.id === pending.project_id ? { ...p, prefix: pending.to } : p,
        ),
        ...(config.default !== undefined ? { default: config.default } : {}),
        ...(config.broken ? { broken: config.broken } : {}),
      });
    }

    const state = await loadState(locttDir);
    if (state.keys[pending.project_id]?.prefix !== pending.to) {
      applyToState(state, pending.project_id, pending.to);
      await saveState(locttDir, state);
    }

    const renamed = await rewriteTaskKeys(
      locttDir,
      pending.project_id,
      pending.from,
      pending.to,
    );
    await rebuildKeyIndex(locttDir);
    await rm(getPrefixRenameStatePath(locttDir), { force: true });

    return {
      projectId: pending.project_id,
      from: pending.from,
      to: pending.to,
      renamed,
    };
  });
}
