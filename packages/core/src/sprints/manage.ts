import type { SprintDef, SprintsConfig, SprintState } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadSprintsConfig,
  saveSprintsConfig,
} from "../config/sprints.js";
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
export class SprintError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "SprintError";
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SPRINT_STATES: ReadonlySet<SprintState> = new Set([
  "active",
  "completed",
  "future",
]);

function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new SprintError(`${field} must be YYYY-MM-DD, got: ${value}`);
  }
}

/**
 * The one date rule sprints keep (K130). An end before the start cannot
 * be drawn: the burndown has no days and the timeline bar inverts. It is
 * a storage rule, not process policy, which P11 leaves to the user.
 */
export const SPRINT_END_BEFORE_START_MESSAGE = "End date is before the start date.";

export type SprintByNameResult =
  | { kind: "match"; sprint: SprintDef }
  | { kind: "ambiguous"; matches: readonly SprintDef[] }
  | { kind: "not_found" };

export function findSprint(config: SprintsConfig, id: string): SprintDef {
  const def = config.sprints.find(s => s.id === id);
  if (!def) throw new SprintError(`Unknown sprint: ${id}`);
  return def;
}

export function resolveSprintByName(
  config: SprintsConfig,
  name: string,
  options: { includeArchived?: boolean } = {},
): SprintByNameResult {
  const pool = options.includeArchived === true
    ? config.sprints
    : config.sprints.filter(s => s.archived !== true);
  const matches = pool.filter(s => s.name === name);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "match", sprint: matches[0] as SprintDef };
  return { kind: "ambiguous", matches };
}

export function resolveSprintIdFromInput(
  config: SprintsConfig,
  input: string,
  options: { includeArchived?: boolean } = {},
): string {
  const byId = config.sprints.find(s => s.id === input
    && (options.includeArchived === true || s.archived !== true));
  if (byId) return byId.id;
  const byName = resolveSprintByName(config, input, options);
  if (byName.kind === "match") return byName.sprint.id;
  if (byName.kind === "ambiguous") {
    const ids = byName.matches.map(s => s.id).join(", ");
    throw new SprintError(
      `Sprint name '${input}' is ambiguous. Matches ${byName.matches.length} sprints (${ids}). Pass the id instead.`,
    );
  }
  throw new SprintError(`Unknown sprint: ${input}`);
}

/** Input to createSprint. Core generates the id. */
export interface CreateSprintInput {
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly state: SprintState;
  readonly goal?: string;
  readonly archived?: boolean;
}

export async function createSprint(
  locttDir: string,
  input: CreateSprintInput,
): Promise<SprintDef> {
  assertIsoDate(input.start_date, "start_date");
  assertIsoDate(input.end_date, "end_date");
  if (input.end_date < input.start_date) {
    throw new SprintError(SPRINT_END_BEFORE_START_MESSAGE);
  }
  if (!VALID_SPRINT_STATES.has(input.state)) {
    throw new SprintError(
      `state must be one of active|completed|future, got: ${input.state}`,
    );
  }
  return withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const id = ulid();
    const def: SprintDef = {
      id,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      state: input.state,
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.archived === true ? { archived: true } : {}),
    };
    await saveSprintsConfig(locttDir, { sprints: [...config.sprints, def], ...(config.broken ? { broken: config.broken } : {}) });
    return def;
  });
}

export interface EditSprintOptions {
  readonly name?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly state?: SprintState;
  readonly goal?: string | null;
}

export async function editSprint(
  locttDir: string,
  id: string,
  changes: EditSprintOptions,
): Promise<void> {
  if (changes.start_date !== undefined) assertIsoDate(changes.start_date, "start_date");
  if (changes.end_date !== undefined) assertIsoDate(changes.end_date, "end_date");
  if (changes.state !== undefined && !VALID_SPRINT_STATES.has(changes.state)) {
    throw new SprintError(
      `state must be one of active|completed|future, got: ${changes.state}`,
    );
  }
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.id === id);
    if (idx === -1) throw new SprintError(`Unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`Unknown sprint: ${id}`);

    const nextStart = changes.start_date ?? existing.start_date;
    const nextEnd = changes.end_date ?? existing.end_date;
    if (nextEnd < nextStart) {
      throw new SprintError(SPRINT_END_BEFORE_START_MESSAGE);
    }

    // K130 / P11: any state can move to any state. Ken: "users can
    // specify, and the can make active or inactive or close or whatever,
    // i dont care." There is no transition guard and no force flag.
    const nextState = changes.state ?? existing.state;

    const updated: SprintDef = {
      id: existing.id,
      name: changes.name ?? existing.name,
      start_date: nextStart,
      end_date: nextEnd,
      state: nextState,
      ...(changes.goal === null
        ? {}
        : changes.goal !== undefined
          ? { goal: changes.goal }
          : existing.goal !== undefined
            ? { goal: existing.goal }
            : {}),
      ...(existing.archived === true ? { archived: true } : {}),
    };
    const next = [...config.sprints];
    next[idx] = updated;
    await saveSprintsConfig(locttDir, { sprints: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export async function archiveSprint(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.id === id);
    if (idx === -1) throw new SprintError(`Unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`Unknown sprint: ${id}`);
    if (existing.archived === true) return;
    const next = [...config.sprints];
    next[idx] = { ...existing, archived: true };
    await saveSprintsConfig(locttDir, { sprints: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export async function unarchiveSprint(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.id === id);
    if (idx === -1) throw new SprintError(`Unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`Unknown sprint: ${id}`);
    if (existing.archived !== true) return;
    const cleared: SprintDef = {
      id: existing.id,
      name: existing.name,
      start_date: existing.start_date,
      end_date: existing.end_date,
      state: existing.state,
      ...(existing.goal !== undefined ? { goal: existing.goal } : {}),
    };
    const next = [...config.sprints];
    next[idx] = cleared;
    await saveSprintsConfig(locttDir, { sprints: next, ...(config.broken ? { broken: config.broken } : {}) });
  });
}

export interface DeleteSprintOptions {
  readonly hard?: boolean;
  readonly remapTo?: string;
}

export async function deleteSprint(
  locttDir: string,
  id: string,
  options: DeleteSprintOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new SprintError(`--remap-to only applies to --hard delete.`);
    }
    await archiveSprint(locttDir, id);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    if (!config.sprints.some(s => s.id === id)) {
      throw new SprintError(`Unknown sprint: ${id}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === id) {
        throw new SprintError(`Remap target must differ from the sprint being deleted.`);
      }
      const target = config.sprints.find(s => s.id === options.remapTo);
      if (!target) {
        throw new SprintError(`Unknown remap target sprint: ${options.remapTo}`);
      }
      if (target.archived === true) {
        throw new SprintError(
          `Remap target sprint '${options.remapTo}' is archived. Unarchive it first, or pick an active sprint.`,
        );
      }
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.sprint === id);

    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_sprint",
      started_at: new Date().toISOString(),
      from: id,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    await replayTaskRemapStrict(locttDir, entry);
    await applySprintConfigDeletion(locttDir, id);
    await clearJournalEntry(locttDir, entry.id);

    return { affectedTaskCount: affected.length };
  });
}

async function applySprintConfigDeletion(locttDir: string, id: string): Promise<void> {
  const config = await loadSprintsConfig(locttDir);
  if (!config.sprints.some(s => s.id === id)) return;
  await saveSprintsConfig(locttDir, {
    sprints: config.sprints.filter(s => s.id !== id),
    ...(config.broken ? { broken: config.broken } : {}),
  });
}

registerRecoveryHandler("remap_sprint", async (locttDir, entry) => {
  if (entry.kind !== "remap_sprint") return;
  await replayTaskRemapStrict(locttDir, entry);
  await applySprintConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
