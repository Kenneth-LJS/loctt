import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Captures a normalized, deterministic snapshot of a tracker's `.loctt/`
 * directory so two adapters' final states can be compared byte-equal.
 *
 * Normalization:
 *   - ULIDs (26-char Crockford base32) replaced with `<ID:N>` in
 *     order of first appearance across the whole snapshot.
 *   - ISO-8601 timestamps replaced with `<TS>`.
 *   - Tasks are listed sorted by their `key` frontmatter field so that
 *     filesystem readdir order doesn't affect the output.
 *   - Trailing whitespace per line trimmed (different writers emit
 *     YAML with subtle trailing-space differences).
 */
export interface TrackerSnapshot {
  readonly tasks: readonly TaskSnapshot[];
}

export interface TaskSnapshot {
  /** The task's user-facing key (T-1, T-2, ...). Stable across surfaces. */
  readonly key: string;
  /** The task.md content, normalized. */
  readonly taskMd: string;
  /** The _history.yaml content, normalized. Empty if the file is absent. */
  readonly historyYaml: string;
  /** Names of files in attachments/, sorted. Empty if dir missing. */
  readonly attachments: readonly string[];
}

// ULIDs are 26 chars. Loose match is fine here — any 26-char [A-Z0-9]
// run in a tracker file is overwhelmingly likely to be one. False
// positives would just produce extra <ID:N> placeholders that are still
// stable across runs, so parity comparisons stay correct.
const ULID_RE = /\b[A-Z0-9]{26}\b/g;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

function normalizeText(input: string, idMap: Map<string, string>): string {
  // Mask ULIDs first so the timestamp regex can't accidentally split one.
  let out = input.replace(ULID_RE, ulid => {
    let placeholder = idMap.get(ulid);
    if (!placeholder) {
      placeholder = `<ID:${idMap.size + 1}>`;
      idMap.set(ulid, placeholder);
    }
    return placeholder;
  });
  out = out.replace(TIMESTAMP_RE, "<TS>");
  // Strip trailing whitespace on each line; collapse \r\n to \n.
  out = out.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function captureSnapshot(root: string): Promise<TrackerSnapshot> {
  const tasksDir = path.join(root, ".loctt/tasks");
  let entries: string[] = [];
  try {
    entries = await readdir(tasksDir);
  } catch {
    return { tasks: [] };
  }

  // First pass: read all task data, capture key from frontmatter.
  const raw: Array<{ id: string; key: string; taskMd: string; historyYaml: string; attachments: string[] }> = [];
  for (const id of entries) {
    const taskDir = path.join(tasksDir, id);
    const info = await stat(taskDir);
    if (!info.isDirectory()) continue;

    const taskPath = path.join(taskDir, "task.md");
    const taskMd = await readFile(taskPath, "utf-8");

    let historyYaml = "";
    const histPath = path.join(taskDir, "_history.yaml");
    if (await exists(histPath)) {
      historyYaml = await readFile(histPath, "utf-8");
    }

    let attachments: string[] = [];
    const attachmentsDir = path.join(taskDir, "attachments");
    if (await exists(attachmentsDir)) {
      attachments = (await readdir(attachmentsDir)).filter(n => !n.startsWith(".")).sort();
    }

    const keyMatch = /^key:\s*(.+)$/m.exec(taskMd);
    const key = keyMatch?.[1]?.trim() ?? id;
    raw.push({ id, key, taskMd, historyYaml, attachments });
  }

  // Sort by key so different filesystem readdir orders don't matter.
  raw.sort((a, b) => a.key.localeCompare(b.key));

  // Second pass: normalize. The id map is shared so both task.md and
  // _history.yaml across all tasks get the same placeholder for the
  // same ULID. Encounter order is task-md-first, then history, in
  // sorted-key order.
  const idMap = new Map<string, string>();
  const tasks: TaskSnapshot[] = raw.map(r => ({
    key: r.key,
    taskMd: normalizeText(r.taskMd, idMap),
    historyYaml: normalizeText(r.historyYaml, idMap),
    attachments: r.attachments,
  }));

  return { tasks };
}

/**
 * Renders a snapshot as a single string suitable for `expect(...).toBe(...)`
 * diffs. Stable ordering, normalized content.
 */
export function renderSnapshot(snap: TrackerSnapshot): string {
  const parts: string[] = [];
  for (const task of snap.tasks) {
    parts.push(`### ${task.key} ###`);
    parts.push("--- task.md ---");
    parts.push(task.taskMd);
    if (task.historyYaml.length > 0) {
      parts.push("--- _history.yaml ---");
      parts.push(task.historyYaml);
    }
    if (task.attachments.length > 0) {
      parts.push("--- attachments ---");
      for (const name of task.attachments) parts.push(`  ${name}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}
