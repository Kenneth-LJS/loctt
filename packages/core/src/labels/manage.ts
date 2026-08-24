import type { LabelDef, LabelsConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadLabelsConfig,
  saveLabelsConfig,
} from "../config/labels.js";
import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  registerRecoveryHandler,
  replayTaskRemap,
  saveJournal,
  withStateLock,
} from "../state/index.js";
import type { JournalEntry } from "../state/journal.js";
import { loadAllTasks } from "../task/load-all.js";

/**
 * Entity errors carry `validation_failed` and `not_saved`: every throw
 * site is a rejected input, checked before the write.
 *
 * A caller that knows better overrides — `not_found` for an unknown
 * name, say — but the default is the common case rather than something
 * each throw site has to remember.
 */
export class LabelError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "LabelError";
  }
}

/**
 * Result of looking up a label by name. Names are not unique;
 * disambiguation by id falls to the caller.
 */
export type LabelByNameResult =
  | { kind: "match"; label: LabelDef }
  | { kind: "ambiguous"; matches: readonly LabelDef[] }
  | { kind: "not_found" };

/** Looks up a label definition. Throws on unknown id. */
export function findLabel(config: LabelsConfig, id: string): LabelDef {
  const def = config.labels.find(l => l.id === id);
  if (!def) throw new LabelError(`unknown label: ${id}`);
  return def;
}

/**
 * Looks up labels by name. Used by CLI/MCP to accept name input
 * with disambiguation errors.
 */
export function resolveLabelByName(
  config: LabelsConfig,
  name: string,
  options: { includeArchived?: boolean } = {},
): LabelByNameResult {
  const pool = options.includeArchived === true
    ? config.labels
    : config.labels.filter(l => l.archived !== true);
  const matches = pool.filter(l => l.name === name);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "match", label: matches[0] as LabelDef };
  return { kind: "ambiguous", matches };
}

/**
 * Resolves user input (label name or id) to a label id. Tries id
 * first, then unique-name lookup. Throws on miss/ambiguous.
 */
export function resolveLabelIdFromInput(
  config: LabelsConfig,
  input: string,
  options: { includeArchived?: boolean } = {},
): string {
  const byId = config.labels.find(l => l.id === input
    && (options.includeArchived === true || l.archived !== true));
  if (byId) return byId.id;
  const byName = resolveLabelByName(config, input, options);
  if (byName.kind === "match") return byName.label.id;
  if (byName.kind === "ambiguous") {
    const ids = byName.matches.map(l => l.id).join(", ");
    throw new LabelError(
      `label name '${input}' is ambiguous — matches ${byName.matches.length} labels (${ids}). Pass the id instead.`,
    );
  }
  throw new LabelError(`unknown label: ${input}`);
}

/**
 * Asserts that a set of label ids are all registered. Used by
 * createTask/setField to enforce the "explicit creation required" rule.
 */
export function assertLabelIdsRegistered(
  config: LabelsConfig,
  ids: readonly string[],
): void {
  const known = new Set(config.labels.map(l => l.id));
  const unknown = ids.filter(k => !known.has(k));
  if (unknown.length > 0) {
    throw new LabelError(
      `unknown label(s): ${unknown.join(", ")}. ` +
      `Register first via the label CRUD.`,
    );
  }
}

/** Input to createLabel. Core generates the id. */
export interface CreateLabelInput {
  readonly name: string;
  readonly color?: string;
  readonly archived?: boolean;
}

/** Creates a new label. */
export async function createLabel(
  locttDir: string,
  input: CreateLabelInput,
): Promise<LabelDef> {
  return withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const id = ulid();
    const def: LabelDef = {
      id,
      name: input.name,
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.archived === true ? { archived: true } : {}),
    };
    await saveLabelsConfig(locttDir, { labels: [...config.labels, def] });
    return def;
  });
}

/** Mutates the label's name or color. id remains immutable. */
export async function editLabel(
  locttDir: string,
  id: string,
  changes: { name?: string; color?: string | null },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.id === id);
    if (idx === -1) throw new LabelError(`unknown label: ${id}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${id}`);

    const updated: LabelDef = {
      id: existing.id,
      name: changes.name ?? existing.name,
      ...(changes.color === null
        ? {}
        : changes.color !== undefined
          ? { color: changes.color }
          : existing.color !== undefined
            ? { color: existing.color }
            : {}),
      ...(existing.archived === true ? { archived: true } : {}),
    };
    const next = [...config.labels];
    next[idx] = updated;
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

/** Marks a label as archived. No-op when already archived. */
export async function archiveLabel(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.id === id);
    if (idx === -1) throw new LabelError(`unknown label: ${id}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${id}`);
    if (existing.archived === true) return;
    const next = [...config.labels];
    next[idx] = { ...existing, archived: true };
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

/** Clears the archived flag on a label. */
export async function unarchiveLabel(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    const idx = config.labels.findIndex(l => l.id === id);
    if (idx === -1) throw new LabelError(`unknown label: ${id}`);
    const existing = config.labels[idx];
    if (!existing) throw new LabelError(`unknown label: ${id}`);
    if (existing.archived !== true) return;
    const next = [...config.labels];
    const cleared: LabelDef = { id: existing.id, name: existing.name };
    if (existing.color !== undefined) cleared.color = existing.color;
    next[idx] = cleared;
    await saveLabelsConfig(locttDir, { labels: next });
  });
}

export interface DeleteLabelOptions {
  readonly hard?: boolean;
  readonly remapTo?: string;
}

/**
 * Deletes a label. Soft (default) sets archived; hard removes from
 * labels.yaml and rewrites task labels arrays (drop or remap).
 */
export async function deleteLabel(
  locttDir: string,
  id: string,
  options: DeleteLabelOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new LabelError(`--remap-to only applies to --hard delete`);
    }
    await archiveLabel(locttDir, id);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadLabelsConfig(locttDir);
    if (!config.labels.some(l => l.id === id)) {
      throw new LabelError(`unknown label: ${id}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === id) {
        throw new LabelError(`remap target must differ from the label being deleted`);
      }
      const target = config.labels.find(l => l.id === options.remapTo);
      if (!target) {
        throw new LabelError(`unknown remap target label: ${options.remapTo}`);
      }
      if (target.archived === true) {
        throw new LabelError(
          `remap target label '${options.remapTo}' is archived; unarchive it first or pick an active label`,
        );
      }
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.labels?.includes(id) ?? false);

    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_label",
      started_at: new Date().toISOString(),
      from: id,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    await replayTaskRemap(locttDir, entry);
    await applyLabelConfigDeletion(locttDir, id);
    await clearJournalEntry(locttDir, entry.id);

    return { affectedTaskCount: affected.length };
  });
}

async function applyLabelConfigDeletion(locttDir: string, id: string): Promise<void> {
  const config = await loadLabelsConfig(locttDir);
  if (!config.labels.some(l => l.id === id)) return;
  await saveLabelsConfig(locttDir, {
    labels: config.labels.filter(l => l.id !== id),
  });
}

registerRecoveryHandler("remap_label", async (locttDir, entry) => {
  if (entry.kind !== "remap_label") return;
  await replayTaskRemap(locttDir, entry);
  await applyLabelConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
