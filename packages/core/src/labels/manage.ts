import type { LabelDef, LabelsConfig, Task } from "@loctt/contracts";

import {
  loadLabelsConfig,
  saveLabelsConfig,
} from "../config/labels.js";
import { withStateLock } from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";

export class LabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelError";
  }
}

/** Looks up a label definition. Throws on unknown key. */
export function findLabel(config: LabelsConfig, key: string): LabelDef {
  const def = config.labels.find(l => l.key === key);
  if (!def) throw new LabelError(`unknown label: ${key}`);
  return def;
}

/**
 * Asserts that a set of label keys are all registered in the labels
 * config. Used by `setField`/`createTask` paths to enforce the
 * "explicit creation required" rule.
 */
export function assertLabelKeysRegistered(
  config: LabelsConfig,
  keys: readonly string[],
): void {
  const known = new Set(config.labels.map(l => l.key));
  const unknown = keys.filter(k => !known.has(k));
  if (unknown.length > 0) {
    throw new LabelError(
      `unknown label(s): ${unknown.join(", ")}. ` +
      `Run \`loctt label create <key>\` to register first.`,
    );
  }
}

/** Creates a new label. Throws on duplicate key. */
export async function createLabel(
  locttDir: string,
  def: LabelDef,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    if (config.labels.some(l => l.key === def.key)) {
      throw new LabelError(`label with key '${def.key}' already exists`);
    }
    await saveLabelsConfig(locttDir, { labels: [...config.labels, def] });
  });
}

/** Mutates label, label-only or color. Key remains immutable. */
export async function editLabel(
  locttDir: string,
  key: string,
  changes: { label?: string; color?: string | null },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.key === key);
    if (idx === -1) throw new LabelError(`unknown label: ${key}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${key}`);

    const updated: LabelDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      ...(changes.color === null
        ? {}
        : changes.color !== undefined
          ? { color: changes.color }
          : existing.color !== undefined
            ? { color: existing.color }
            : {}),
    };
    const next = [...config.labels];
    next[idx] = updated;
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

/**
 * Marks a label as archived. Archived labels are hidden from
 * default lists and pickers but remain valid references on tasks
 * that already use them. No-op when already archived.
 */
export async function archiveLabel(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.key === key);
    if (idx === -1) throw new LabelError(`unknown label: ${key}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${key}`);
    if (existing.archived === true) return;
    const next = [...config.labels];
    next[idx] = { ...existing, archived: true };
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

/** Clears the archived flag on a label. */
export async function unarchiveLabel(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.key === key);
    if (idx === -1) throw new LabelError(`unknown label: ${key}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${key}`);
    if (existing.archived !== true) return;
    const next = [...config.labels];
    const cleared: typeof existing = { key: existing.key, label: existing.label };
    if (existing.color !== undefined) (cleared as { color?: string }).color = existing.color;
    next[idx] = cleared;
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

export interface DeleteLabelOptions {
  /**
   * If true, hard-delete the label entirely from labels.yaml and
   * remove it from every task's labels array (or remap it via
   * `remapTo`). The default is a soft-delete (archive) — the entry
   * stays in labels.yaml with `archived: true`.
   */
  readonly hard?: boolean;
  /** Hard-delete only: optional remap target. When set, replaces
   * the deleted key on every affected task. When unset, the
   * deleted key is just removed from each task's labels array. */
  readonly remapTo?: string;
}

/**
 * Deletes a label. Default is soft-delete: sets `archived: true`
 * and leaves task references intact. With `hard: true`, removes
 * the entry from labels.yaml and either drops the key from each
 * affected task's labels array or remaps it via `remapTo`. Returns
 * the count of tasks touched (zero for soft-delete).
 */
export async function deleteLabel(
  locttDir: string,
  key: string,
  options: DeleteLabelOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new LabelError(`--remap-to only applies to --hard delete`);
    }
    await archiveLabel(locttDir, key);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    if (!config.labels.some(l => l.key === key)) {
      throw new LabelError(`unknown label: ${key}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === key) {
        throw new LabelError(`remap target must differ from the label being deleted`);
      }
      if (!config.labels.some(l => l.key === options.remapTo)) {
        throw new LabelError(`unknown remap target label: ${options.remapTo}`);
      }
    }

    const tasks = await loadAllTasks(locttDir);
    let affected = 0;
    const operationNow = new Date().toISOString();

    for (const task of tasks) {
      const labels = task.frontmatter.labels;
      if (!labels || !labels.includes(key)) continue;
      const next: string[] = [];
      for (const l of labels) {
        if (l === key) {
          if (options.remapTo !== undefined && !next.includes(options.remapTo)) {
            next.push(options.remapTo);
          }
        } else {
          next.push(l);
        }
      }
      const updated: Task = {
        ...task,
        frontmatter: {
          ...task.frontmatter,
          ...(next.length > 0 ? { labels: next } : {}),
          updated_at: operationNow,
        },
      };
      // Remove the labels key entirely if empty.
      if (next.length === 0) {
        const fm = { ...updated.frontmatter } as Record<string, unknown>;
        delete fm["labels"];
        await writeTask(locttDir, task.frontmatter.id, {
          ...updated,
          frontmatter: fm as unknown as Task["frontmatter"],
        });
      } else {
        await writeTask(locttDir, task.frontmatter.id, updated);
      }
      affected += 1;
    }

    await saveLabelsConfig(locttDir, {
      labels: config.labels.filter(l => l.key !== key),
    });

    return { affectedTaskCount: affected };
  });
}
