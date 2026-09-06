/**
 * Restoring a JSONL backup (K17 ruling 2).
 *
 * Three modes, deliberately not last-writer-wins:
 *
 * - **bare** refuses a non-empty tracker and names what is in the way.
 * - **`--merge`** adds ids that are absent and never edits one that is
 *   present. That is `mergeById`'s rule — "incoming first, so a local
 *   entry with the same id overwrites it" — settled by Ken 2026-08-16,
 *   and it is why this module calls the sync merge engine rather than
 *   growing a second one (BAK-C24). Sync and restore are the same
 *   problem: two trackers, divergent state, one result. Two
 *   implementations of it do not merely duplicate — they silently
 *   disagree about a rule someone already decided.
 * - **`--overwrite`** replaces any id the backup carries, and preserves
 *   the body it displaces (K17 ruling 6), using `mergeTask`'s
 *   displaced-body half only. Its field-level resolution does not
 *   apply, because these modes are not last-writer-wins.
 *
 * Atomicity is `stagedSwap` (V6): every write is staged, journalled and
 * swapped, so a SIGKILL at any point leaves the tracker either fully
 * restored or untouched. A `withStateLock` alone would not do it — the
 * kill takes the lock with the process, and an unjournalled restore
 * leaves a half-written tracker with nothing to recover from (BAK-C14).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { LocttState, Task } from "@loctt/contracts";
import { ulid } from "ulid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  assignProvisionalPrefixes,
  assignProvisionalSlugs,
  deriveKeyState,
  mergeById,
  mergeComments,
  mergeHistory,
  mergeTask,
} from "../git/merge.js";
import {
  assertSafeBasename,
  getAttachmentsDir,
  getCommentsFilePath,
  getConfigDir,
  getHistoryFilePath,
  getPrefixRenameStatePath,
  getSchemaMigrationInProgressPath,
  getStateFilePath,
  getTaskFilePath,
  getTasksDir,
  getUserDir,
} from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION, SchemaTooNewError } from "../schema/version.js";
import { rebuildKeyIndex } from "../state/key-index.js";
import { withStateLock } from "../state/lock.js";
import { stagedSwap, type StagedWrite } from "../state/staged-swap.js";
import { assembleTaskFile, parseFrontmatter, splitTaskFile } from "../task/frontmatter.js";
import { type BackupRecord } from "./format.js";
import { BackupFormatError, type BadLine, readBackupPart, resolveBackupSet } from "./read.js";

export type RestoreMode = "bare" | "merge" | "overwrite";

export interface RestoreOptions {
  readonly mode: RestoreMode;
  /** Predict without writing (BAK-C15). */
  readonly dryRun?: boolean;
}

export interface RestoreReport {
  readonly mode: RestoreMode;
  readonly dryRun: boolean;
  readonly created: number;
  /** Present ids left alone by `--merge` (BAK-C10). */
  readonly skipped: number;
  /** Only `--overwrite` can be non-zero — the mode that can lose work. */
  readonly overwritten: number;
  /** Malformed lines, named with their line numbers (BAK-C3). */
  readonly badLines: readonly BadLine[];
  /** `T-4` → `T-17`, for keys reallocated on collision (BAK-C11). */
  readonly reallocatedKeys: readonly { from: string; to: string }[];
  /** Prefix reassignments (BAK-C20). */
  readonly reassignedPrefixes: readonly { project: string; from: string; to: string }[];
  /** Slug reassignments — the half that stops projects.yaml loading. */
  readonly reassignedSlugs: readonly { project: string; from: string; to: string }[];
  /** `bug` → `bug (2)`, per K17 ruling 4 (BAK-C17). */
  readonly renamedEntities: readonly { type: string; from: string; to: string }[];
  /** Where a displaced body was written (K17 ruling 6, BAK-C13). */
  readonly displacedBodies: readonly { taskId: string; path: string }[];
  readonly configsRestored: number;
  readonly usersRestored: number;
}

export class RestoreRefusedError extends Error {
  readonly name = "RestoreRefusedError" as const;
}

/**
 * Phase Z security (SEC-1/SEC-2): a backup is an "import a file from
 * elsewhere" operation and must not be trusted to stay inside the
 * tracker. Every other path-builder routes names through
 * `assertSafeBasename`; restore historically joined a record's `name`
 * (attachment, avatar) and `path` (config) straight onto the tracker
 * dir, so a crafted backup with a `../` name/path wrote an arbitrary
 * file with attacker-controlled bytes — an arbitrary-overwrite → RCE
 * vector (a git hook, a shell rc). This must run in `restore.ts` (not as
 * a schema refinement — `read.ts` demotes schema failures to lenient
 * `badLines` and continues) and BEFORE any write, so nothing lands.
 *
 * A malicious backup is not a partial-success situation: one traversing
 * entry refuses the whole restore (`RestoreRefusedError`), because a
 * backup carrying one is not a document to salvage.
 */
function assertContainedPath(locttDir: string, relPath: string, what: string): void {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new RestoreRefusedError(`${what} path is empty — refusing the restore`);
  }
  if (relPath.includes("\0")) {
    throw new RestoreRefusedError(`${what} path contains a null byte — refusing the restore`);
  }
  const resolved = resolve(locttDir, relPath);
  const rel = relative(locttDir, resolved);
  // `rel` starting with `..` (or being absolute) means the target
  // escaped the tracker dir.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new RestoreRefusedError(
      `${what} path "${relPath}" escapes the tracker directory — refusing the restore`,
    );
  }
}

/**
 * SEC-1: a name that must be a single safe filename (attachment, avatar).
 * Reuses the canonical `assertSafeBasename` every other path-builder
 * uses, but re-throws its failure as a `RestoreRefusedError` so a crafted
 * backup refuses the whole restore rather than surfacing a bare Error.
 */
function assertSafeBasenameOrRefuse(name: string, what: string): void {
  try {
    assertSafeBasename(name);
  } catch (err) {
    throw new RestoreRefusedError(
      `${what} filename "${name}" is unsafe (${(err as Error).message}) — refusing the restore`,
    );
  }
}

/**
 * SEC-1/SEC-2, up-front (Phase Z fix-review): validate EVERY
 * attacker-controlled path/name in the loaded backup BEFORE any write and
 * before the dry-run return, so a traversal entry refuses the whole
 * restore with nothing on disk. The per-site guards ran too late — a
 * malicious attachment name was checked only after `stagedSwap` had
 * already written every task/config/state file (a half-applied restore),
 * and the dry-run skipped the check entirely. One pass here closes both.
 */
function assertBackupContained(loaded: Loaded, locttDir: string): void {
  for (const path of loaded.configs.keys()) {
    assertContainedPath(locttDir, path, "config");
  }
  for (const rec of loaded.tasks.values()) {
    for (const att of rec.attachments ?? []) {
      assertSafeBasenameOrRefuse(att.name, "attachment");
    }
  }
  for (const rec of loaded.users.values()) {
    if (rec.avatar !== undefined) {
      assertSafeBasenameOrRefuse(rec.avatar.name, "avatar");
    }
  }
}

/** Config entity files that carry `{id, name}` lists we merge by id. */
const ENTITY_FILES: Readonly<Record<string, string>> = {
  "config/labels.yaml": "labels",
  "config/milestones.yaml": "milestones",
  "config/sprints.yaml": "sprints",
};

interface Loaded {
  tasks: Map<string, BackupRecord & { kind: "task" }>;
  configs: Map<string, string>;
  users: Map<string, BackupRecord & { kind: "user" }>;
  state?: string;
  badLines: BadLine[];
}

/**
 * Streams every part into memory-light structures.
 *
 * `onTask` fires per record while the file is still being read, which
 * is what BAK-C19 checks: the first per-task report line is emitted
 * before the file has been fully consumed.
 */
async function loadBackup(
  paths: readonly string[],
  onTask?: (id: string) => void,
): Promise<Loaded> {
  const { ordered } = await resolveBackupSet(paths);
  const loaded: Loaded = {
    tasks: new Map(), configs: new Map(), users: new Map(), badLines: [],
  };
  for (const path of ordered) {
    const { badLines } = await readBackupPart(path, record => {
      switch (record.kind) {
        case "task":
          loaded.tasks.set(record.id, record);
          onTask?.(record.id);
          break;
        case "config": loaded.configs.set(record.path, record.content); break;
        case "user": loaded.users.set(record.id, record); break;
        case "state": loaded.state = record.content; break;
      }
    });
    loaded.badLines.push(...badLines);
  }
  return loaded;
}

/** Parses a `{<key>: [...]}` config list, tolerating absence. */
function parseEntityList(content: string | undefined, key: string): Record<string, unknown>[] {
  if (content === undefined) return [];
  const raw: unknown = parseYaml(content);
  if (raw === null || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>)[key];
  return Array.isArray(list) ? list as Record<string, unknown>[] : [];
}

/**
 * Renames an incoming entity whose name collides, per K17 ruling 4:
 * keep both, rename the imported one to a **non-colliding** suffix, so
 * a second merge yields `(3)` rather than a second `(2)`.
 *
 * Deliberately a UX choice, not a schema requirement — the schemas
 * dedupe on `id`, not on name, and Ken chose the rename knowing that.
 */
function nonCollidingName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${String(n)})`)) n += 1;
  return `${name} (${String(n)})`;
}

/**
 * Reads a YAML list to merge against, distinguishing the two failures
 * that look alike and must not be treated alike (P-11).
 *
 * - **Absent** → `[]`: nothing to merge, so the incoming list is
 *   written. This is every bare restore into an empty tracker.
 * - **Unreadable, or not the shape this file is supposed to be** →
 *   `"unreadable"`: the caller skips the write entirely. Writing over a
 *   file whose read just failed is destruction wearing leniency's
 *   clothes — the reproduced 2026-08-17 comment-thread bug.
 *
 * `wrapper` names the key the list lives under, because the two files
 * genuinely differ: `_history.yaml` is a bare array and
 * `_comments.yaml` is `{comments: [...]}`. Guessing "whichever key
 * holds an array" would read a future sibling key as the thread.
 */
async function readListForMerge(
  path: string,
  wrapper?: string,
): Promise<unknown[] | "unreadable"> {
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return "unreadable";
  }
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch {
    return "unreadable";
  }
  if (raw === null) return [];
  if (wrapper === undefined) {
    return Array.isArray(raw) ? (raw as unknown[]) : "unreadable";
  }
  if (Array.isArray(raw)) return raw as unknown[];
  if (typeof raw !== "object") return "unreadable";
  const list = (raw as Record<string, unknown>)[wrapper];
  if (list === undefined) return "unreadable";
  return Array.isArray(list) ? (list as unknown[]) : "unreadable";
}

async function isNonEmptyTracker(locttDir: string): Promise<number> {
  const ids = await readdir(getTasksDir(locttDir)).catch(() => [] as string[]);
  let count = 0;
  for (const id of ids) {
    const info = await stat(join(locttDir, "tasks", id)).catch(() => undefined);
    if (info?.isDirectory() === true) count += 1;
  }
  return count;
}

/**
 * Refuses a destination that is itself mid-operation (BAK-C22).
 *
 * Interleaving a restore with a half-finished prefix rename or schema
 * migration would produce a tracker neither operation can finish.
 */
async function assertNotMidOperation(locttDir: string): Promise<void> {
  const rename = getPrefixRenameStatePath(locttDir);
  if (await stat(rename).then(() => true, () => false)) {
    throw new RestoreRefusedError(
      `${rename} is present: a project prefix rename is half-finished here. `
      + `Run 'loctt doctor' to finish or roll it back, then restore again. `
      + `Nothing has been restored.`,
    );
  }
  const migrating = getSchemaMigrationInProgressPath(locttDir);
  if (await stat(migrating).then(() => true, () => false)) {
    throw new RestoreRefusedError(
      `${migrating} is present: a schema migration is in progress here. `
      + `Run 'loctt migrate' to finish it, then restore again. `
      + `Nothing has been restored.`,
    );
  }
}

/**
 * Parses a backup task record into a `Task`, carrying `health` (§ 13.2
 * B2). A backup of a corrupt task must restore it byte-for-byte (§ 11.4),
 * so its degraded/unrecognised fields ride in `health` and are re-emitted
 * by `assembleTaskFile` rather than dropped.
 */
function toTask(record: BackupRecord & { kind: "task" }): Task {
  const { rawYaml, body } = splitTaskFile(record.raw);
  const { frontmatter, health } = parseFrontmatter(rawYaml);
  return { frontmatter, body, ...(health.length > 0 ? { health } : {}) };
}

/**
 * Restores a backup into `locttDir`.
 *
 * The whole thing runs inside one `withStateLock` and lands through one
 * `stagedSwap`, so the tracker is never observably half-restored.
 */
export async function restoreBackup(
  locttDir: string,
  paths: readonly string[],
  options: RestoreOptions,
  /** Per-task progress, called while the file is still being read. */
  onProgress?: (id: string) => void,
): Promise<RestoreReport> {
  const { mode } = options;
  const dryRun = options.dryRun ?? false;

  // Version first: refuse a newer-schema backup after one line rather
  // than after parsing the whole file (BAK-C21).
  const { header } = await resolveBackupSet(paths);
  if (header.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(header.schema_version, CURRENT_SCHEMA_VERSION);
  }
  // An older backup is refused rather than migrated: the migration
  // framework operates on a `.loctt/` directory, not on a backup file,
  // and inventing a second migration path here is how the two drift.
  // Recorded in decisions.md § 8 with a revert path.
  if (header.schema_version < CURRENT_SCHEMA_VERSION) {
    throw new BackupFormatError(
      `this backup was taken at schema v${String(header.schema_version)} and this `
      + `LocTT uses schema v${String(CURRENT_SCHEMA_VERSION)}. Restore it with the `
      + `matching LocTT version and migrate afterwards, or migrate a copy of the `
      + `original tracker. Nothing has been restored.`,
    );
  }

  await assertNotMidOperation(locttDir);

  const existingCount = await isNonEmptyTracker(locttDir);
  if (mode === "bare" && existingCount > 0) {
    throw new RestoreRefusedError(
      `this tracker already holds ${String(existingCount)} task`
      + `${existingCount === 1 ? "" : "s"}. A bare restore only writes into an `
      + `empty tracker. Use --merge to add only what is missing, or --overwrite `
      + `to replace tasks the backup carries. Nothing has been restored.`,
    );
  }

  return withStateLock(locttDir, async () => {
    const loaded = await loadBackup(paths, onProgress);

    // SEC-1/SEC-2: refuse a path-traversal backup up front — before any
    // write and before the dry-run return — so nothing lands and a dry
    // run also reports the refusal (Phase Z fix-review).
    assertBackupContained(loaded, locttDir);

    const writes: StagedWrite[] = [];
    const report = {
      created: 0, skipped: 0, overwritten: 0,
      reallocatedKeys: [] as { from: string; to: string }[],
      reassignedPrefixes: [] as { project: string; from: string; to: string }[],
      reassignedSlugs: [] as { project: string; from: string; to: string }[],
      renamedEntities: [] as { type: string; from: string; to: string }[],
      displacedBodies: [] as { taskId: string; path: string }[],
      configsRestored: 0, usersRestored: 0,
    };

    // ---- Projects: prefixes and slugs before any key is allocated ----
    //
    // Order matters. Reassigning a prefix after keys are minted mints
    // them against a prefix that then changes (BAK-C20).
    const localProjects = parseEntityList(
      await readFile(join(getConfigDir(locttDir), "projects.yaml"), "utf-8")
        .catch(() => undefined),
      "projects",
    ) as { id: string; name: string; prefix: string; slug?: string }[];
    const incomingProjects = parseEntityList(
      loaded.configs.get("config/projects.yaml"), "projects",
    ) as { id: string; name: string; prefix: string; slug?: string }[];

    // Local wins on id (mergeById's rule): a project present on both
    // sides keeps the destination's definition.
    const unionProjects = mode === "bare"
      ? incomingProjects
      : mergeById(localProjects, incomingProjects);

    const prefixMap = assignProvisionalPrefixes(unionProjects);
    const slugMap = assignProvisionalSlugs(unionProjects);
    const resolvedProjects = unionProjects.map(p => {
      const prefix = prefixMap.get(p.id) ?? p.prefix;
      const slug = slugMap.get(p.id) ?? p.slug;
      if (prefix !== p.prefix) {
        report.reassignedPrefixes.push({ project: p.name, from: p.prefix, to: prefix });
      }
      if (p.slug !== undefined && slug !== undefined && slug !== p.slug) {
        report.reassignedSlugs.push({ project: p.name, from: p.slug, to: slug });
      }
      return { ...p, prefix, ...(slug !== undefined ? { slug } : {}) };
    });

    // ---- Tasks ----
    const localTaskIds = new Set(
      (await readdir(getTasksDir(locttDir)).catch(() => [] as string[])),
    );
    const usedKeys = new Set<string>();
    const localTasks: Task[] = [];
    for (const id of localTaskIds) {
      const raw = await readFile(getTaskFilePath(locttDir, id), "utf-8").catch(() => undefined);
      if (raw === undefined) continue;
      try {
        const { rawYaml, body } = splitTaskFile(raw);
        const { frontmatter, health } = parseFrontmatter(rawYaml);
        const t: Task = { frontmatter, body, ...(health.length > 0 ? { health } : {}) };
        localTasks.push(t);
        usedKeys.add(t.frontmatter.key);
      } catch { /* unparseable local task: never written over (P-11) */ }
    }

    // Counter state, so a reallocated key is minted from the
    // destination's counter and never reissued (BAK-C11, BAK-C12).
    const localState = parseYaml(
      await readFile(getStateFilePath(locttDir), "utf-8").catch(() => "keys: {}"),
    ) as LocttState | null;
    const incomingState = loaded.state !== undefined
      ? parseYaml(loaded.state) as LocttState
      : { keys: {} };

    const restoredTasks: Task[] = [];
    const taskWrites: { id: string; task: Task; record: BackupRecord & { kind: "task" } }[] = [];

    for (const [id, record] of loaded.tasks) {
      const present = localTaskIds.has(id);
      if (present && mode === "merge") {
        // Never edit what is present. This is mergeById's rule applied
        // to task directories, and the reason a merge cannot lose work.
        report.skipped += 1;
        continue;
      }
      let task: Task;
      try {
        task = toTask(record);
      } catch (err) {
        loaded.badLines.push({
          line: 0, file: paths[0] ?? "",
          reason: `task ${id}: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      if (present && mode === "overwrite") {
        // K17 ruling 6: the displaced body is preserved and named.
        // Only mergeTask's displaced-body half is used — its field
        // resolution is last-writer-wins, which these modes are not.
        const localRaw = await readFile(getTaskFilePath(locttDir, id), "utf-8")
          .catch(() => undefined);
        if (localRaw !== undefined) {
          try {
            const { rawYaml, body } = splitTaskFile(localRaw);
            const { frontmatter, health } = parseFrontmatter(rawYaml);
            const local: Task = { frontmatter, body, ...(health.length > 0 ? { health } : {}) };
            const outcome = mergeTask(local, task);
            if (outcome.displaced !== undefined && local.body !== task.body) {
              // A ULID rather than a timestamp: two restores in the
              // same millisecond — or a second restore later that
              // displaces the same task again — must not write over an
              // already-preserved body. Silently replacing the thing
              // kept to stop a silent replacement would be the whole
              // ruling defeated by its own filename.
              const path = join(
                getTasksDir(locttDir), id, `displaced-body-${ulid()}.md`,
              );
              writes.push({ path, content: local.body });
              report.displacedBodies.push({ taskId: id, path });
            }
          } catch { /* unparseable local task: nothing to displace */ }
        }
        report.overwritten += 1;
      } else {
        report.created += 1;
      }

      // Key collision: reallocate from the destination project's
      // counter and keep the old key resolving via key_history (P-7).
      const fm = task.frontmatter;
      const collides = !present && usedKeys.has(fm.key);
      const project = fm.project;
      const proj = resolvedProjects.find(p => p.id === project);
      if (collides && proj !== undefined) {
        const counter = Math.max(
          localState?.keys[proj.id]?.next_number ?? 1,
          incomingState.keys[proj.id]?.next_number ?? 1,
        );
        let n = counter;
        let candidate = `${proj.prefix}${String(n)}`;
        while (usedKeys.has(candidate)) { n += 1; candidate = `${proj.prefix}${String(n)}`; }
        report.reallocatedKeys.push({ from: fm.key, to: candidate });
        task = {
          ...task,
          frontmatter: {
            ...fm,
            key: candidate,
            key_history: [...(fm.key_history ?? []), fm.key],
          },
        };
      } else if (proj !== undefined && !fm.key.startsWith(proj.prefix)) {
        // The project's prefix was reassigned, so every one of its keys
        // is rewritten and the old key kept resolving (BAK-C20).
        const suffix = /(\d+)$/.exec(fm.key)?.[1];
        if (suffix !== undefined) {
          // The number is kept where it can be, but never at the cost
          // of a duplicate: two projects whose prefixes both became
          // `T2-` would otherwise reissue the same key, which is the
          // collision the prefix reassignment exists to prevent.
          let n = Number(suffix);
          let candidate = `${proj.prefix}${String(n)}`;
          while (usedKeys.has(candidate)) {
            n += 1;
            candidate = `${proj.prefix}${String(n)}`;
          }
          if (candidate !== fm.key) {
            report.reallocatedKeys.push({ from: fm.key, to: candidate });
            task = {
              ...task,
              frontmatter: {
                ...fm,
                key: candidate,
                key_history: [...(fm.key_history ?? []), fm.key],
              },
            };
          }
        }
      }
      usedKeys.add(task.frontmatter.key);
      restoredTasks.push(task);
      taskWrites.push({ id, task, record });
    }

    // ---- Config ----
    //
    // Name collisions keep both and rename the incoming one (K17
    // ruling 4). Done per entity type: remapping two same-named sprints
    // onto one id would discard a start_date, end_date and state.
    const configOut = new Map<string, string>();
    for (const [path, key] of Object.entries(ENTITY_FILES)) {
      const incoming = parseEntityList(loaded.configs.get(path), key);
      if (incoming.length === 0 && !loaded.configs.has(path)) continue;
      const local = parseEntityList(
        await readFile(join(locttDir, path), "utf-8").catch(() => undefined), key,
      );
      const localById = new Set(local.map(e => String(e["id"])));
      const taken = new Set(local.map(e => String(e["name"])));
      const renamed = incoming.map(e => {
        // An entity already present by id is the local one (mergeById).
        if (localById.has(String(e["id"]))) return e;
        const name = String(e["name"]);
        const next = nonCollidingName(name, taken);
        taken.add(next);
        if (next !== name) {
          report.renamedEntities.push({ type: key, from: name, to: next });
        }
        return next === name ? e : { ...e, name: next };
      });
      const merged = mode === "bare" ? renamed : mergeById(
        local as { id: string }[], renamed as { id: string }[],
      );
      configOut.set(path, stringifyYaml({ [key]: merged }));
    }

    // projects.yaml, with its resolved prefixes and slugs.
    if (loaded.configs.has("config/projects.yaml") || resolvedProjects.length > 0) {
      const localRaw: unknown = parseYaml(
        await readFile(join(getConfigDir(locttDir), "projects.yaml"), "utf-8")
          .catch(() => "projects: []"),
      );
      // `default` is a project id, and ProjectsConfigSchema rejects one
      // that is not in the list — so the merged file would not load at
      // all. On a bare restore the destination's default names a
      // project that is no longer there; prefer the local default when
      // it survived, else the backup's, else nothing.
      const localDef = (localRaw as { default?: string } | null)?.default;
      const incomingDef = (parseYaml(
        loaded.configs.get("config/projects.yaml") ?? "projects: []",
      ) as { default?: string } | null)?.default;
      const ids = new Set(resolvedProjects.map(p => p.id));
      const def = localDef !== undefined && ids.has(localDef)
        ? localDef
        : incomingDef !== undefined && ids.has(incomingDef)
          ? incomingDef
          : undefined;
      configOut.set("config/projects.yaml", stringifyYaml({
        projects: resolvedProjects,
        ...(def !== undefined ? { default: def } : {}),
      }));
    }

    // Remaining config files travel as-is; a present local file wins on
    // merge, matching "never edit what is present".
    for (const [path, content] of loaded.configs) {
      if (configOut.has(path)) continue;
      if (mode === "merge") {
        const exists = await stat(join(locttDir, path)).then(() => true, () => false);
        if (exists) continue;
      }
      configOut.set(path, content);
    }
    for (const [path, content] of configOut) {
      // Containment already enforced up front by assertBackupContained.
      writes.push({ path: join(locttDir, path), content });
      report.configsRestored += 1;
    }

    // ---- Users: profile and avatar only. Never settings or recents ----
    for (const [id, record] of loaded.users) {
      const dir = getUserDir(locttDir, id);
      if (mode === "merge"
        && await stat(join(dir, "profile.yaml")).then(() => true, () => false)) {
        continue;
      }
      writes.push({ path: join(dir, "profile.yaml"), content: record.profile });
      report.usersRestored += 1;
    }

    // ---- state.yaml: deriveKeyState, not a third key-merge path ----
    //
    // max(local, incoming, highest key actually in use + 1). A
    // max-of-counters rule still corrupts when both counters are stale,
    // because it never looks at the tasks (A96, BAK-C12).
    const allTasks = [...localTasks, ...restoredTasks];
    //
    // Both sides' real states go in, on every mode. Passing an empty
    // incoming map on a merge — to "avoid importing the backup's
    // counters" — drops every project that exists only in the backup,
    // because deriveKeyState emits a counter only for projects one of
    // the two maps names. The restored project then has no allocation
    // entry and the next `task create` against it throws. Importing
    // them is safe precisely because the rule is a max, never a
    // replacement.
    const derived = deriveKeyState(
      localState ?? { keys: {} },
      incomingState,
      allTasks,
    );
    // Prefix reassignments must reach state.yaml too, or the counter
    // mints keys against the prefix that was replaced.
    const keys: LocttState["keys"] = {};
    for (const [projectId, alloc] of Object.entries(derived.keys)) {
      const p = resolvedProjects.find(x => x.id === projectId);
      keys[projectId] = p !== undefined ? { ...alloc, prefix: p.prefix } : alloc;
    }
    const mergedState: LocttState = {
      keys,
      ...(derived.retired_keys !== undefined ? { retired_keys: derived.retired_keys } : {}),
    };
    writes.push({
      path: getStateFilePath(locttDir), content: stringifyYaml(mergedState),
    });

    if (dryRun) {
      return {
        mode, dryRun: true, badLines: loaded.badLines, ...report,
      };
    }

    // ---- Land it ----
    //
    // Task text, comments and history go through stagedSwap with
    // everything else, so the whole restore is one journalled,
    // rollback-able unit (BAK-C14).
    for (const { id, task, record } of taskWrites) {
      writes.push({
        path: getTaskFilePath(locttDir, id),
        // `task` carries `health` (§ 13.2 B2), so a restored corrupt task
        // round-trips its degraded/unrecognised fields (§ 11.4 BAK).
        content: assembleTaskFile(task),
      });
      if (record.comments !== undefined) {
        // Two edits to one comment resolve by updated_at, and a merged
        // thread loses neither side (P-11, BAK-C24).
        // Absent and unreadable are different states. Absent means
        // there is nothing to merge, so the incoming thread is written.
        // Unreadable means a read failed, and writing anyway is the
        // 2026-08-17 bug — a failed read preceding a write turned a
        // three-comment thread into one (P-11).
        const local = await readListForMerge(getCommentsFilePath(locttDir, id), "comments");
        if (local !== "unreadable") {
          const merged = mergeComments(
            local as { id: string }[],
            record.comments as { id: string }[],
          );
          // Written back in the shape the comments reader expects.
          writes.push({
            path: getCommentsFilePath(locttDir, id),
            content: stringifyYaml({ comments: merged }),
          });
        }
      }
      if (record.history !== undefined) {
        const local = await readListForMerge(getHistoryFilePath(locttDir, id));
        if (local !== "unreadable") {
          // One timeline in timestamp order, not two concatenated.
          const merged = mergeHistory(
            local as never[], record.history as never[],
          );
          writes.push({
            path: getHistoryFilePath(locttDir, id), content: stringifyYaml(merged),
          });
        }
      }
    }

    await stagedSwap(locttDir, writes);

    // Attachments are binary and land outside the staged text swap.
    for (const { id, record } of taskWrites) {
      for (const att of record.attachments ?? []) {
        // Containment already enforced up front by assertBackupContained.
        const path = join(getAttachmentsDir(locttDir, id), att.name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(att.bytes, "base64"));
      }
    }
    for (const [id, record] of loaded.users) {
      if (record.avatar === undefined) continue;
      // Containment already enforced up front by assertBackupContained.
      const path = join(getUserDir(locttDir, id), record.avatar.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(record.avatar.bytes, "base64"));
    }

    // The index is derived, so it is excluded from the backup and
    // rebuilt here (A96). A stale index resolves an old key to the
    // wrong task while key_history still looks right (BAK-C11).
    await rebuildKeyIndex(locttDir);

    return { mode, dryRun: false, badLines: loaded.badLines, ...report };
  });
}
