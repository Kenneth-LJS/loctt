import type { SprintDef, SprintsConfig, SprintState } from "@loctt/contracts";
import { ulid } from "ulid";

import {
  loadSprintsConfig,
  saveSprintsConfig,
} from "../config/sprints.js";
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

export class SprintError extends Error {
  constructor(message: string) {
    super(message);
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
 * Allowed sprint state transitions. `future` and `active` can move
 * freely between themselves and to `completed`. Re-opening a
 * `completed` sprint requires `force: true`.
 */
const SPRINT_STATE_TRANSITIONS: Readonly<Record<SprintState, ReadonlySet<SprintState>>> = {
  future: new Set<SprintState>(["future", "active", "completed"]),
  active: new Set<SprintState>(["future", "active", "completed"]),
  completed: new Set<SprintState>(["completed"]),
};

export type SprintByNameResult =
  | { kind: "match"; sprint: SprintDef }
  | { kind: "ambiguous"; matches: readonly SprintDef[] }
  | { kind: "not_found" };

export function findSprint(config: SprintsConfig, id: string): SprintDef {
  const def = config.sprints.find(s => s.id === id);
  if (!def) throw new SprintError(`unknown sprint: ${id}`);
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
      `sprint name '${input}' is ambiguous — matches ${byName.matches.length} sprints (${ids}). Pass the id instead.`,
    );
  }
  throw new SprintError(`unknown sprint: ${input}`);
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
    throw new SprintError(
      `end_date (${input.end_date}) must not be before start_date (${input.start_date})`,
    );
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
    await saveSprintsConfig(locttDir, { sprints: [...config.sprints, def] });
    return def;
  });
}

export interface EditSprintOptions {
  readonly name?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly state?: SprintState;
  readonly goal?: string | null;
  /** If true, allow a state transition that would otherwise be blocked. */
  readonly force?: boolean;
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
    if (idx === -1) throw new SprintError(`unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${id}`);

    const nextStart = changes.start_date ?? existing.start_date;
    const nextEnd = changes.end_date ?? existing.end_date;
    if (nextEnd < nextStart) {
      throw new SprintError(
        `end_date (${nextEnd}) must not be before start_date (${nextStart})`,
      );
    }

    const nextState = changes.state ?? existing.state;
    if (nextState !== existing.state && changes.force !== true) {
      const allowed = SPRINT_STATE_TRANSITIONS[existing.state];
      if (!allowed.has(nextState)) {
        throw new SprintError(
          `state transition '${existing.state}' -> '${nextState}' is not allowed; ` +
          `pass force=true to override`,
        );
      }
    }

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
    await saveSprintsConfig(locttDir, { sprints: next });
  });
}

export async function archiveSprint(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.id === id);
    if (idx === -1) throw new SprintError(`unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${id}`);
    if (existing.archived === true) return;
    const next = [...config.sprints];
    next[idx] = { ...existing, archived: true };
    await saveSprintsConfig(locttDir, { sprints: next });
  });
}

export async function unarchiveSprint(locttDir: string, id: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.id === id);
    if (idx === -1) throw new SprintError(`unknown sprint: ${id}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${id}`);
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
    await saveSprintsConfig(locttDir, { sprints: next });
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
      throw new SprintError(`--remap-to only applies to --hard delete`);
    }
    await archiveSprint(locttDir, id);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    if (!config.sprints.some(s => s.id === id)) {
      throw new SprintError(`unknown sprint: ${id}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === id) {
        throw new SprintError(`remap target must differ from the sprint being deleted`);
      }
      const target = config.sprints.find(s => s.id === options.remapTo);
      if (!target) {
        throw new SprintError(`unknown remap target sprint: ${options.remapTo}`);
      }
      if (target.archived === true) {
        throw new SprintError(
          `remap target sprint '${options.remapTo}' is archived; unarchive it first or pick an active sprint`,
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

    await replayTaskRemap(locttDir, entry);
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
  });
}

registerRecoveryHandler("remap_sprint", async (locttDir, entry) => {
  if (entry.kind !== "remap_sprint") return;
  await replayTaskRemap(locttDir, entry);
  await applySprintConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
