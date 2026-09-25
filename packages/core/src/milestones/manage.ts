import type { MilestoneDef, MilestonesConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadMilestonesConfig,
  saveMilestonesConfig,
} from "../config/milestones.js";
import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  registerRecoveryHandler,
  replayTaskRemapStrict,
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
export class MilestoneError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "MilestoneError";
  }
}

export type MilestoneByNameResult =
  | { kind: "match"; milestone: MilestoneDef }
  | { kind: "ambiguous"; matches: readonly MilestoneDef[] }
  | { kind: "not_found" };

export function findMilestone(config: MilestonesConfig, id: string): MilestoneDef {
  const def = config.milestones.find(m => m.id === id);
  if (!def) throw new MilestoneError(`Unknown milestone: ${id}`);
  return def;
}

export function resolveMilestoneByName(
  config: MilestonesConfig,
  name: string,
  options: { includeArchived?: boolean } = {},
): MilestoneByNameResult {
  const pool = options.includeArchived === true
    ? config.milestones
    : config.milestones.filter(m => m.archived !== true);
  const matches = pool.filter(m => m.name === name);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "match", milestone: matches[0] as MilestoneDef };
  return { kind: "ambiguous", matches };
}

export function resolveMilestoneIdFromInput(
  config: MilestonesConfig,
  input: string,
  options: { includeArchived?: boolean } = {},
): string {
  const byId = config.milestones.find(m => m.id === input
    && (options.includeArchived === true || m.archived !== true));
  if (byId) return byId.id;
  const byName = resolveMilestoneByName(config, input, options);
  if (byName.kind === "match") return byName.milestone.id;
  if (byName.kind === "ambiguous") {
    const ids = byName.matches.map(m => m.id).join(", ");
    throw new MilestoneError(
      `Milestone name '${input}' is ambiguous. Matches ${byName.matches.length} milestones (${ids}). Pass the id instead.`,
    );
  }
  throw new MilestoneError(`Unknown milestone: ${input}`);
}

export interface CreateMilestoneInput {
  readonly name: string;
  readonly target_date?: string;
  readonly archived?: boolean;
}

export async function createMilestone(
  locttDir: string,
  input: CreateMilestoneInput,
): Promise<MilestoneDef> {
  return withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    const id = ulid();
    const def: MilestoneDef = {
      id,
      name: input.name,
      ...(input.target_date !== undefined ? { target_date: input.target_date } : {}),
      ...(input.archived === true ? { archived: true } : {}),
    };
    await saveMilestonesConfig(locttDir, {
      milestones: [...config.milestones, def],
      ...(config.broken ? { broken: config.broken } : {}),
    });
    return def;
  });
}

export async function editMilestone(
  locttDir: string,
  id: string,
  changes: { name?: string; target_date?: string | null; archived?: boolean },
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    const idx = config.milestones.findIndex(m => m.id === id);
    if (idx === -1) throw new MilestoneError(`Unknown milestone: ${id}`);
    const existing = config.milestones[idx];
    if (!existing) throw new MilestoneError(`Unknown milestone: ${id}`);

    const updated: MilestoneDef = {
      id: existing.id,
      name: changes.name ?? existing.name,
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
    await saveMilestonesConfig(locttDir, { milestones: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export async function archiveMilestone(locttDir: string, id: string): Promise<void> {
  await editMilestone(locttDir, id, { archived: true });
}

export async function unarchiveMilestone(locttDir: string, id: string): Promise<void> {
  await editMilestone(locttDir, id, { archived: false });
}

export interface DeleteMilestoneOptions {
  readonly hard?: boolean;
  readonly remapTo?: string;
}

export async function deleteMilestone(
  locttDir: string,
  id: string,
  options: DeleteMilestoneOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new MilestoneError(`--remap-to only applies to --hard delete.`);
    }
    await archiveMilestone(locttDir, id);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadMilestonesConfig(locttDir);
    if (!config.milestones.some(m => m.id === id)) {
      throw new MilestoneError(`Unknown milestone: ${id}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === id) {
        throw new MilestoneError(`Remap target must differ from the milestone being deleted.`);
      }
      const target = config.milestones.find(m => m.id === options.remapTo);
      if (!target) {
        throw new MilestoneError(`Unknown remap target milestone: ${options.remapTo}`);
      }
      if (target.archived === true) {
        throw new MilestoneError(
          `Remap target milestone '${options.remapTo}' is archived. Unarchive it first, or pick an active milestone.`,
        );
      }
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.milestone === id);

    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_milestone",
      started_at: new Date().toISOString(),
      from: id,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    await replayTaskRemapStrict(locttDir, entry);
    await applyMilestoneConfigDeletion(locttDir, id);
    await clearJournalEntry(locttDir, entry.id);

    return { affectedTaskCount: affected.length };
  });
}

async function applyMilestoneConfigDeletion(locttDir: string, id: string): Promise<void> {
  const config = await loadMilestonesConfig(locttDir);
  if (!config.milestones.some(m => m.id === id)) return;
  await saveMilestonesConfig(locttDir, {
    milestones: config.milestones.filter(m => m.id !== id),
    ...(config.broken ? { broken: config.broken } : {}),
  });
}

registerRecoveryHandler("remap_milestone", async (locttDir, entry) => {
  if (entry.kind !== "remap_milestone") return;
  await replayTaskRemapStrict(locttDir, entry);
  await applyMilestoneConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
