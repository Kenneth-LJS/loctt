/**
 * Writing a JSONL backup (M5.1).
 *
 * Streams a line at a time: a task's attachments are read, encoded,
 * written and dropped before the next task is touched, so peak memory
 * is one task rather than one tracker. That is what makes the format's
 * streaming promise (BAK-C19) true on the write side as well as the
 * read side.
 *
 * What travels and what does not is A96 and Q22, and the export echoes
 * its own exclusion list into the header so a new exclusion cannot be
 * added without the file saying so (BAK-C1).
 */

import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ulid } from "ulid";

import {
  getAttachmentsDir,
  getCommentsFilePath,
  getConfigDir,
  getHistoryFilePath,
  getStateFilePath,
  getTaskDir,
  getTaskFilePath,
  getTasksDir,
  getUserDir,
  getUsersDir,
} from "../paths/index.js";
import { readSchemaVersion } from "../schema/version.js";
import {
  type BackupAttachment,
  type BackupHeader,
  DEFAULT_SPLIT_THRESHOLD_BYTES,
  encodeLine,
  EXCLUDED_FROM_BACKUP,
} from "./format.js";

export interface ExportBackupOptions {
  /** Destination file. A split set writes `<name>.part2` and so on. */
  readonly outputPath: string;
  /** K17 ruling 1: history ships unless the user opts out. */
  readonly includeHistory?: boolean;
  /** Bytes per part. Exposed so a test can force a split (BAK-C7). */
  readonly splitThresholdBytes?: number;
}

export interface ExportBackupReport {
  /** Every part written, in order. One entry when there is no split. */
  readonly files: readonly string[];
  /** Total bytes across all parts (BAK-C6). */
  readonly bytes: number;
  readonly tasks: number;
  readonly configs: number;
  readonly users: number;
  /** False when `--no-history` was used; the report says so (BAK-C4). */
  readonly includedHistory: boolean;
  /** What was deliberately left behind (BAK-C1, A96, Q22). */
  readonly excluded: readonly string[];
  readonly schemaVersion: number;
}

/**
 * Config files that travel — **every** `.yaml` in `config/`, read from
 * the directory rather than from a list.
 *
 * A hardcoded list is how a config file added next year silently stops
 * being backed up: nothing fails, the export still reports success, and
 * the omission surfaces only when someone restores onto a bare machine.
 * `queries.yaml` and `list-view.yaml` are in scope by BAK-C16, and the
 * directory read means the next one is too without anybody remembering.
 */
async function listConfigFiles(configDir: string): Promise<string[]> {
  const names = await readdir(configDir).catch(() => [] as string[]);
  return names.filter(n => n.endsWith(".yaml")).sort();
}

/** Reads a file, returning undefined when it simply is not there. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function readBytesIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Parses a YAML list file into raw entries without validating them.
 *
 * P-11: a malformed comment or history entry is carried through the
 * backup rather than dropped. Validating here would make the backup
 * lossy in exactly the case the user most needs it not to be.
 *
 * `wrapper` names the key the list lives under. The two files differ —
 * `_history.yaml` is a bare array, `_comments.yaml` is
 * `{comments: [...]}` — and "whichever key holds an array" would read a
 * future sibling key as the thread.
 */
async function readRawList(
  path: string,
  wrapper?: string,
): Promise<unknown[] | undefined> {
  const content = await readIfPresent(path);
  if (content === undefined) return undefined;
  const { parse } = await import("yaml");
  let raw: unknown;
  try {
    raw = parse(content);
  } catch {
    // Unparseable: carried as absent rather than throwing. The file
    // stays on the source disk; the backup simply has nothing to say
    // about it, which is better than refusing to back up the tracker.
    return undefined;
  }
  if (Array.isArray(raw)) return raw as unknown[];
  if (wrapper !== undefined && raw !== null && typeof raw === "object") {
    const list = (raw as Record<string, unknown>)[wrapper];
    if (Array.isArray(list)) return list as unknown[];
  }
  return undefined;
}

/** Reads one task's attachments as base64, in a stable order. */
async function readAttachments(
  locttDir: string,
  taskId: string,
): Promise<BackupAttachment[] | undefined> {
  const dir = getAttachmentsDir(locttDir, taskId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const out: BackupAttachment[] = [];
  // Sorted so two exports of one tracker produce identical files.
  for (const name of [...names].sort()) {
    const info = await stat(join(dir, name)).catch(() => undefined);
    if (info === undefined || !info.isFile()) continue;
    const bytes = await readFile(join(dir, name));
    out.push({ name, bytes: bytes.toString("base64") });
  }
  // A task with no attachments carries no attachment structure at all
  // (BAK-C5) — an empty array would be a lie about the source.
  return out.length > 0 ? out : undefined;
}

/**
 * Reads a task's `displaced-body-<ulid>.md` files (BAK-C13), in a stable
 * order, as UTF-8 text.
 *
 * `restore --overwrite` writes a displaced body into the task dir and
 * names it in its report (K17 ruling 6); nothing else did, and the
 * earlier exporter carried only task.md/_comments/_history/attachments,
 * so a subsequent backup dropped the preserved text. Carrying it as
 * task-dir content — rather than inventing a new top-level record kind
 * that no case describes — is the smaller fix.
 */
async function readDisplacedBodies(
  locttDir: string,
  taskId: string,
): Promise<{ name: string; content: string }[] | undefined> {
  const dir = getTaskDir(locttDir, taskId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const out: { name: string; content: string }[] = [];
  // Sorted so two exports of one tracker produce identical files.
  for (const name of [...names].sort()) {
    if (!/^displaced-body-.+\.md$/.test(name)) continue;
    const info = await stat(join(dir, name)).catch(() => undefined);
    if (info === undefined || !info.isFile()) continue;
    out.push({ name, content: await readFile(join(dir, name), "utf-8") });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * A writer that rolls over to a new part once a part passes the
 * threshold, and never splits a line across two parts.
 *
 * Rollover happens *between* records, so every part is independently
 * parseable line by line — which is what lets a restore stream a part
 * without holding the set in memory.
 */
class PartWriter {
  private stream: import("node:fs").WriteStream | undefined;
  private partBytes = 0;
  private part = 0;
  readonly files: string[] = [];
  totalBytes = 0;

  constructor(
    private readonly basePath: string,
    private readonly threshold: number,
    private readonly header: Omit<BackupHeader, "part" | "parts">,
  ) {}

  private pathForPart(n: number): string {
    return n === 1 ? this.basePath : `${this.basePath}.part${String(n)}`;
  }

  private async openNext(): Promise<void> {
    await this.close();
    this.part += 1;
    const path = this.pathForPart(this.part);
    await mkdir(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { encoding: "utf-8" });
    this.files.push(path);
    this.partBytes = 0;
    // `parts` is not knowable until the export finishes; it is patched
    // into every header once the count is final (see `finish`).
    await this.raw(encodeLine({ ...this.header, part: this.part, parts: 0 }));
  }

  private raw(line: string): Promise<void> {
    const s = this.stream;
    if (s === undefined) throw new Error("writer not open");
    const size = Buffer.byteLength(line, "utf-8");
    this.partBytes += size;
    this.totalBytes += size;
    return new Promise((res, rej) => {
      // Respecting backpressure is what keeps a large attachment from
      // buffering the whole file in memory.
      if (s.write(line)) { res(); return; }
      s.once("drain", res);
      s.once("error", rej);
    });
  }

  async write(record: unknown): Promise<void> {
    if (this.stream === undefined) await this.openNext();
    else if (this.partBytes >= this.threshold) await this.openNext();
    await this.raw(encodeLine(record));
  }

  private close(): Promise<void> {
    const s = this.stream;
    if (s === undefined) return Promise.resolve();
    this.stream = undefined;
    return new Promise((res, rej) => {
      s.end(() => { res(); });
      s.once("error", rej);
    });
  }

  /** Closes the set and rewrites each header with the final part count. */
  async finish(): Promise<void> {
    if (this.stream === undefined) await this.openNext();
    await this.close();
    const parts = this.files.length;
    const { writeFile } = await import("node:fs/promises");
    for (const [i, path] of this.files.entries()) {
      const content = await readFile(path, "utf-8");
      const nl = content.indexOf("\n");
      const rest = nl === -1 ? "" : content.slice(nl + 1);
      const head = encodeLine({ ...this.header, part: i + 1, parts });
      const next = head + rest;
      this.totalBytes += Buffer.byteLength(next, "utf-8")
        - Buffer.byteLength(content, "utf-8");
      await writeFile(path, next, "utf-8");
    }
  }
}

/**
 * Writes a whole-tracker backup.
 *
 * Whole-tracker rather than tasks-only is K17 ruling 2 ("Tasks +
 * config"), which is what makes a bare-machine restore possible.
 */
export async function exportBackup(
  locttDir: string,
  options: ExportBackupOptions,
): Promise<ExportBackupReport> {
  const includeHistory = options.includeHistory ?? true;
  const schemaVersion = (await readSchemaVersion(locttDir)) ?? 1;

  const writer = new PartWriter(
    options.outputPath,
    options.splitThresholdBytes ?? DEFAULT_SPLIT_THRESHOLD_BYTES,
    {
      kind: "loctt-backup",
      format: 1,
      schema_version: schemaVersion,
      created_at: new Date().toISOString(),
      backup_id: ulid(),
      includes_history: includeHistory,
      excluded: [...EXCLUDED_FROM_BACKUP],
    },
  );

  // state.yaml travels: it is the key allocation counters, not a cache
  // (A96). Dropping it leaves a restored tracker reissuing keys.
  let configs = 0;
  const stateContent = await readIfPresent(getStateFilePath(locttDir));
  if (stateContent !== undefined) {
    await writer.write({ kind: "state", content: stateContent });
  }

  const configDir = getConfigDir(locttDir);
  for (const name of await listConfigFiles(configDir)) {
    const content = await readIfPresent(join(configDir, name));
    if (content === undefined) continue;
    await writer.write({ kind: "config", path: `config/${name}`, content });
    configs += 1;
  }

  // Users: profile and avatar travel; settings.yaml and recents.yaml
  // do not (Q22). Listing the two files explicitly rather than copying
  // the directory is the point — the directory copy is the obvious
  // implementation and it leaks recents.
  let users = 0;
  const userIds = await readdir(getUsersDir(locttDir)).catch(() => [] as string[]);
  for (const id of [...userIds].sort()) {
    const dir = getUserDir(locttDir, id);
    const info = await stat(dir).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) continue;
    const profile = await readIfPresent(join(dir, "profile.yaml"));
    if (profile === undefined) continue;
    const avatarBytes = await readBytesIfPresent(join(dir, "avatar.jpg"));
    await writer.write({
      kind: "user",
      id,
      profile,
      ...(avatarBytes !== undefined
        ? { avatar: { name: "avatar.jpg", bytes: avatarBytes.toString("base64") } }
        : {}),
    });
    users += 1;
  }

  let tasks = 0;
  const taskIds = await readdir(getTasksDir(locttDir)).catch(() => [] as string[]);
  for (const id of [...taskIds].sort()) {
    const raw = await readIfPresent(getTaskFilePath(locttDir, id));
    if (raw === undefined) continue;
    const comments = await readRawList(getCommentsFilePath(locttDir, id), "comments");
    const history = includeHistory
      ? await readRawList(getHistoryFilePath(locttDir, id))
      : undefined;
    const attachments = await readAttachments(locttDir, id);
    const displacedBodies = await readDisplacedBodies(locttDir, id);
    await writer.write({
      kind: "task",
      id,
      raw,
      ...(comments !== undefined ? { comments } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(attachments !== undefined ? { attachments } : {}),
      ...(displacedBodies !== undefined ? { displacedBodies } : {}),
    });
    tasks += 1;
  }

  await writer.finish();

  return {
    files: writer.files,
    bytes: writer.totalBytes,
    tasks,
    configs,
    users,
    includedHistory: includeHistory,
    excluded: [...EXCLUDED_FROM_BACKUP],
    schemaVersion,
  };
}
