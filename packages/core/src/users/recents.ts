import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getUserDir } from "../paths/index.js";

const RECENTS_FILE = "recents.yaml";

/**
 * Cap on the number of recent task ids kept per user. Older entries
 * are dropped on push when the list exceeds this. Picked low enough
 * that the file stays tiny and the UI dropdown stays scannable.
 */
export const RECENTS_CAP = 20;

export interface RecentEntry {
  readonly id: string;
  readonly at: string;
}

interface RecentsFile {
  tasks?: RecentEntry[];
}

function recentsFilePath(locttDir: string, userId: string): string {
  return join(getUserDir(locttDir, userId), RECENTS_FILE);
}

/**
 * Reads the recent-task list for a user (most recent first). Returns
 * `[]` if the file doesn't exist or is malformed.
 */
export async function readRecents(
  locttDir: string,
  userId: string,
): Promise<RecentEntry[]> {
  let content: string;
  try {
    content = await readFile(recentsFilePath(locttDir, userId), "utf-8");
  } catch {
    return [];
  }
  const parsed = parseYaml(content) as RecentsFile | null;
  const list = parsed?.tasks;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is RecentEntry =>
    typeof e === "object" && e !== null
    && typeof (e).id === "string"
    && typeof (e).at === "string"
  );
}

/**
 * Pushes a task id to the front of the user's recent list. If the id
 * is already present, it is moved to the front (and its `at` updated).
 * The list is truncated to {@link RECENTS_CAP} entries.
 *
 * Writes are not locked — recent-tracking is a best-effort UX signal,
 * not authoritative state. A concurrent write loses at most one entry,
 * and the next push corrects it.
 */
export async function pushRecent(
  locttDir: string,
  userId: string,
  taskId: string,
  now: string = new Date().toISOString(),
): Promise<RecentEntry[]> {
  const dir = getUserDir(locttDir, userId);
  await mkdir(dir, { recursive: true });
  const existing = await readRecents(locttDir, userId);
  const filtered = existing.filter(e => e.id !== taskId);
  const next: RecentEntry[] = [{ id: taskId, at: now }, ...filtered].slice(0, RECENTS_CAP);
  const file = recentsFilePath(locttDir, userId);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, stringifyYaml({ tasks: next }), "utf-8");
  await rename(tmp, file);
  return next;
}

/**
 * Removes a task from the user's recents (e.g. after deletion). No-op
 * if not present.
 */
export async function removeRecent(
  locttDir: string,
  userId: string,
  taskId: string,
): Promise<void> {
  const existing = await readRecents(locttDir, userId);
  if (!existing.some(e => e.id === taskId)) return;
  const next = existing.filter(e => e.id !== taskId);
  const dir = getUserDir(locttDir, userId);
  await mkdir(dir, { recursive: true });
  const file = recentsFilePath(locttDir, userId);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, stringifyYaml({ tasks: next }), "utf-8");
  await rename(tmp, file);
}
