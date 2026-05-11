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
 * `completed` sprint requires explicit edit through this layer
 * (callers that need it pass force=true) — without that guard, a
 * casual reopen could disrupt downstream reporting that assumes
 * "completed" is a terminal state.
 */
const SPRINT_STATE_TRANSITIONS: Readonly<Record<SprintState, ReadonlySet<SprintState>>> = {
  future: new Set<SprintState>(["future", "active", "completed"]),
  active: new Set<SprintState>(["future", "active", "completed"]),
  completed: new Set<SprintState>(["completed"]),
};

export function findSprint(config: SprintsConfig, key: string): SprintDef {
  const def = config.sprints.find(s => s.key === key);
  if (!def) throw new SprintError(`unknown sprint: ${key}`);
  return def;
}

export async function createSprint(
  locttDir: string,
  def: SprintDef,
): Promise<void> {
  assertIsoDate(def.start_date, "start_date");
  assertIsoDate(def.end_date, "end_date");
  if (def.end_date < def.start_date) {
    throw new SprintError(
      `end_date (${def.end_date}) must not be before start_date (${def.start_date})`,
    );
  }
  if (!VALID_SPRINT_STATES.has(def.state)) {
    throw new SprintError(
      `state must be one of active|completed|future, got: ${def.state}`,
    );
  }
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    if (config.sprints.some(s => s.key === def.key)) {
      throw new SprintError(`sprint with key '${def.key}' already exists`);
    }
    await saveSprintsConfig(locttDir, { sprints: [...config.sprints, def] });
  });
}

export interface EditSprintOptions {
  readonly label?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly state?: SprintState;
  readonly goal?: string | null;
  /**
   * If true, allow a state transition that would otherwise be
   * blocked (currently: re-opening a completed sprint). Defaults
   * to false.
   */
  readonly force?: boolean;
}

export async function editSprint(
  locttDir: string,
  key: string,
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
    const idx = config.sprints.findIndex(s => s.key === key);
    if (idx === -1) throw new SprintError(`unknown sprint: ${key}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${key}`);

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
      key: existing.key,
      label: changes.label ?? existing.label,
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

/** Marks a sprint as archived. No-op when already archived. */
export async function archiveSprint(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.key === key);
    if (idx === -1) throw new SprintError(`unknown sprint: ${key}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${key}`);
    if (existing.archived === true) return;
    const next = [...config.sprints];
    next[idx] = { ...existing, archived: true };
    await saveSprintsConfig(locttDir, { sprints: next });
  });
}

/** Clears the archived flag on a sprint. */
export async function unarchiveSprint(locttDir: string, key: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.key === key);
    if (idx === -1) throw new SprintError(`unknown sprint: ${key}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${key}`);
    if (existing.archived !== true) return;
    const cleared: SprintDef = {
      key: existing.key,
      label: existing.label,
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
  /**
   * If true, hard-delete the sprint from sprints.yaml and either
   * unset or remap the `sprint` field on every affected task. The
   * default is a soft-delete (archive).
   */
  readonly hard?: boolean;
  readonly remapTo?: string;
}

export async function deleteSprint(
  locttDir: string,
  key: string,
  options: DeleteSprintOptions = {},
): Promise<{ affectedTaskCount: number }> {
  if (options.hard !== true) {
    if (options.remapTo !== undefined) {
      throw new SprintError(`--remap-to only applies to --hard delete`);
    }
    await archiveSprint(locttDir, key);
    return { affectedTaskCount: 0 };
  }
  return withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    if (!config.sprints.some(s => s.key === key)) {
      throw new SprintError(`unknown sprint: ${key}`);
    }
    if (options.remapTo !== undefined) {
      if (options.remapTo === key) {
        throw new SprintError(`remap target must differ from the sprint being deleted`);
      }
      if (!config.sprints.some(s => s.key === options.remapTo)) {
        throw new SprintError(`unknown remap target sprint: ${options.remapTo}`);
      }
    }

    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(t => t.frontmatter.sprint === key);

    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_sprint",
      started_at: new Date().toISOString(),
      from: key,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    await replayTaskRemap(locttDir, entry);
    await applySprintConfigDeletion(locttDir, key);
    await clearJournalEntry(locttDir, entry.id);

    return { affectedTaskCount: affected.length };
  });
}

/** Idempotent config-edit half of deleteSprint. */
async function applySprintConfigDeletion(locttDir: string, key: string): Promise<void> {
  const config = await loadSprintsConfig(locttDir);
  if (!config.sprints.some(s => s.key === key)) return;
  await saveSprintsConfig(locttDir, {
    sprints: config.sprints.filter(s => s.key !== key),
  });
}

registerRecoveryHandler("remap_sprint", async (locttDir, entry) => {
  if (entry.kind !== "remap_sprint") return;
  await replayTaskRemap(locttDir, entry);
  await applySprintConfigDeletion(locttDir, entry.from);
  await clearJournalEntry(locttDir, entry.id);
});
