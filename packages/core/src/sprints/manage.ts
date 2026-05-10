import type { SprintDef, SprintsConfig, SprintState, Task } from "@loctt/contracts";

import {
  loadSprintsConfig,
  saveSprintsConfig,
} from "../config/sprints.js";
import { withStateLock } from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/lookup.js";

export class SprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SprintError";
  }
}

export function findSprint(config: SprintsConfig, key: string): SprintDef {
  const def = config.sprints.find(s => s.key === key);
  if (!def) throw new SprintError(`unknown sprint: ${key}`);
  return def;
}

export async function createSprint(
  locttDir: string,
  def: SprintDef,
): Promise<void> {
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
}

export async function editSprint(
  locttDir: string,
  key: string,
  changes: EditSprintOptions,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const config = await loadSprintsConfig(locttDir);
    const idx = config.sprints.findIndex(s => s.key === key);
    if (idx === -1) throw new SprintError(`unknown sprint: ${key}`);
    const existing = config.sprints[idx];
    if (!existing) throw new SprintError(`unknown sprint: ${key}`);

    const updated: SprintDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      start_date: changes.start_date ?? existing.start_date,
      end_date: changes.end_date ?? existing.end_date,
      state: changes.state ?? existing.state,
      ...(changes.goal === null
        ? {}
        : changes.goal !== undefined
          ? { goal: changes.goal }
          : existing.goal !== undefined
            ? { goal: existing.goal }
            : {}),
    };
    const next = [...config.sprints];
    next[idx] = updated;
    await saveSprintsConfig(locttDir, { sprints: next });
  });
}

export interface DeleteSprintOptions {
  readonly remapTo?: string;
}

export async function deleteSprint(
  locttDir: string,
  key: string,
  options: DeleteSprintOptions = {},
): Promise<{ affectedTaskCount: number }> {
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
    let affected = 0;

    for (const task of tasks) {
      if (task.frontmatter.sprint !== key) continue;
      const fm = { ...task.frontmatter } as Record<string, unknown>;
      if (options.remapTo !== undefined) {
        fm["sprint"] = options.remapTo;
      } else {
        delete fm["sprint"];
      }
      fm["updated_at"] = new Date().toISOString();
      const updated: Task = { ...task, frontmatter: fm as unknown as Task["frontmatter"] };
      await writeTask(locttDir, task.frontmatter.id, updated);
      affected += 1;
    }

    await saveSprintsConfig(locttDir, {
      sprints: config.sprints.filter(s => s.key !== key),
    });

    return { affectedTaskCount: affected };
  });
}
