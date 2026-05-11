import type { MilestoneDef, MilestonesConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadMilestonesConfig,
  saveMilestonesConfig,
} from "../config/milestones.js";
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

export class MilestoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestoneError";
  }
}

export function findMilestone(config: MilestonesConfig, key: string): MilestoneDef {
  const def = config.milestones.find(m => m.key === key);
  if (!def) throw new MilestoneError(`unknown milestone: ${key}`);
  return def;
}

export async function createMilestone(
  locttDir: string,
  def: MilestoneDef,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    if (config.milestones.some(m => m.key === def.key)) {
      throw new MilestoneError(`milestone with key '${def.key}' already exists`);
    }
    await saveMilestonesConfig(locttDir, {
      milestones: [...config.milestones, def],
    });
  });
}

export async function editMilestone(
  locttDir: string,
  key: string,
  changes: { label?: string; target_date?: string | null; archived?: boolean },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    const idx = config.milestones.findIndex(m => m.key === key);
    if (idx === -1) throw new MilestoneError(`unknown milestone: ${key}`);
    const existing = config.milestones[idx];
    if (!existing) throw new MilestoneError(`unknown milestone: ${key}`);

    const updated: MilestoneDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      ...(changes.target_date === null
        ? {}
        : changes.target_date !== undefined
          ? { target_date: changes.target_date }
          : existing.target_date !== undefined
            ? { target_date: existing.target_date }
            : {}),
      ...(changes.archived !== undefined
        ? changes.archived ? { archived: true } : {}
        : existing.archived === true
          ? { archived: true }
          : {}),
    };
    const next = [...config.milestones];
    next[idx] = updated;
    await saveMilestonesConfig(locttDir, { milestones: next });
  });
}

/** Marks a milestone as archived. No-op when already archived. */
export async function archiveMilestone(locttDir: string, key: string): Promise<void> {
  await editMilestone(locttDir, key, { archived: true });
}

/** Clears the archived flag on a milestone. */
export async function unarchiveMilestone(locttDir: string, key: string): Promise<void> {
  await editMilestone(locttDir, key, { archived: false });
}

export interface DeleteMilestoneOptions {
  /** If true, hard-delete from milestones.yaml. Default is soft-delete (archive). */
  readonly hard?: boolean;
  readonly remapTo?: string;
}

export async function deleteMilestone(
  locttDir: string,
  key: string,
  options: DeleteMilestoneOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new MilestoneError(`--remap-to only applies to --hard delete`);
    }
    await archiveMilestone(locttDir, key);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    if (!config.milestones.some(m => m.key === key)) {
      throw new MilestoneError(`unknown milestone: ${key}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === key) {
        throw new MilestoneError(`remap target must differ from the milestone being deleted`);
      }
      if (!config.milestones.some(m => m.key === options.remapTo)) {
        throw new MilestoneError(`unknown remap target milestone: ${options.remapTo}`);
      }
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.milestone === key);

    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_milestone",
      started_at: new Date().toISOString(),
      from: key,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    await replayTaskRemap(locttDir, entry);
    await applyMilestoneConfigDeletion(locttDir, key);
    await clearJournalEntry(locttDir, entry.id);

    return { affectedTaskCount: affected.length };
  });
}

/** Idempotent config-edit half of deleteMilestone. */
async function applyMilestoneConfigDeletion(locttDir: string, key: string): Promise<void> {
  const config = await loadMilestonesConfig(locttDir);
  if (!config.milestones.some(m => m.key === key)) return;
  await saveMilestonesConfig(locttDir, {
    milestones: config.milestones.filter(m => m.key !== key),
  });
}

registerRecoveryHandler("remap_milestone", async (locttDir, entry) => {
  if (entry.kind !== "remap_milestone") return;
  await replayTaskRemap(locttDir, entry);
  await applyMilestoneConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
