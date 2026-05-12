import { BUILTIN_FILTER_FIELD_KEYS } from "@loctt/contracts";

import { getCalendarConfigPath, loadCalendarConfig } from "../config/calendar.js";
import { getLabelsConfigPath,loadLabelsConfig } from "../config/labels.js";
import { loadListViewConfig } from "../config/list-view.js";
import { getMilestonesConfigPath,loadMilestonesConfig } from "../config/milestones.js";
import { getProjectsConfigPath, loadProjectsConfig } from "../config/projects.js";
import { loadQueriesConfig } from "../config/queries.js";
import { getSprintsConfigPath,loadSprintsConfig } from "../config/sprints.js";
import { validateTaskAgainstWorkflow,validateWorkflowConfig } from "../config/validation.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { getConfigDir, getListViewConfigPath, getQueriesConfigPath, getStateFilePath, getTasksDir, getUsersDir, getWorkflowConfigPath, resolveLocttDir } from "../paths/index.js";
import { loadKeyIndex, rebuildKeyIndex } from "../state/key-index.js";
import { loadState } from "../state/state.js";
import { readTask } from "../task/io.js";
import { listTaskIds } from "../task/list-ids.js";
import { loadAllTasks } from "../task/load-all.js";
import { findStructuralCycles,validateRelationships } from "../task/traversal.js";
import { loadAllUsers } from "../users/profile.js";
import { fileExists } from "../utils/fs.js";

export type CheckStatus = "ok" | "warn" | "error";

export interface DiagnosticCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

export interface DoctorOptions {
  /**
   * When true, rebuild the on-disk key index from a full task scan
   * after running checks. Used as the recovery path after out-of-
   * band edits to a task's `key` / `key_history`, which LocTT can
   * not auto-detect (the indexed task id still exists; only the
   * key↔id mapping changed).
   */
  readonly rebuildIndex?: boolean;
}

/** Runs diagnostic checks on a .loctt tracker. */
export async function runDoctor(
  root: string,
  options: DoctorOptions = {},
): Promise<readonly DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const locttDir = resolveLocttDir(root);

  // Check .loctt exists
  if (!(await fileExists(locttDir))) {
    checks.push({ name: ".loctt directory", status: "error", message: "not found — run loctt init" });
    return checks;
  }
  checks.push({ name: ".loctt directory", status: "ok", message: "exists" });

  // Check config directory
  if (!(await fileExists(getConfigDir(locttDir)))) {
    checks.push({ name: "config directory", status: "error", message: "missing .loctt/config/" });
  } else {
    checks.push({ name: "config directory", status: "ok", message: "exists" });
  }

  // Check tasks directory
  if (!(await fileExists(getTasksDir(locttDir)))) {
    checks.push({ name: "tasks directory", status: "warn", message: "missing .loctt/tasks/ — will be created on first task" });
  } else {
    checks.push({ name: "tasks directory", status: "ok", message: "exists" });
  }

  // Check workflow.yaml
  let workflowConfig: Awaited<ReturnType<typeof loadWorkflowConfig>> | undefined;
  const workflowPath = getWorkflowConfigPath(locttDir);
  if (!(await fileExists(workflowPath))) {
    checks.push({ name: "workflow.yaml", status: "error", message: "missing" });
  } else {
    try {
      workflowConfig = await loadWorkflowConfig(locttDir);
      const errors = validateWorkflowConfig(workflowConfig);
      if (errors.length > 0) {
        checks.push({
          name: "workflow.yaml",
          status: "warn",
          message: `${errors.length} validation issue(s): ${errors.map(e => e.message).join("; ")}`,
        });
      } else {
        checks.push({ name: "workflow.yaml", status: "ok", message: "valid" });
      }
    } catch (err) {
      checks.push({ name: "workflow.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // Check queries.yaml
  const queriesPath = getQueriesConfigPath(locttDir);
  if (!(await fileExists(queriesPath))) {
    checks.push({ name: "queries.yaml", status: "warn", message: "missing — saved views unavailable" });
  } else {
    try {
      await loadQueriesConfig(locttDir);
      checks.push({ name: "queries.yaml", status: "ok", message: "valid" });
    } catch (err) {
      checks.push({ name: "queries.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // Check state.yaml
  const statePath = getStateFilePath(locttDir);
  if (!(await fileExists(statePath))) {
    checks.push({ name: "state.yaml", status: "error", message: "missing" });
  } else {
    try {
      await loadState(locttDir);
      checks.push({ name: "state.yaml", status: "ok", message: "valid" });
    } catch (err) {
      checks.push({ name: "state.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // Check projects.yaml — required since per-project counters
  // were introduced.
  const projectsPath = getProjectsConfigPath(locttDir);
  let projectsConfig: Awaited<ReturnType<typeof loadProjectsConfig>> | undefined;
  if (!(await fileExists(projectsPath))) {
    checks.push({ name: "projects.yaml", status: "error", message: "missing" });
  } else {
    try {
      projectsConfig = await loadProjectsConfig(locttDir);
      checks.push({
        name: "projects.yaml",
        status: "ok",
        message: `${projectsConfig.projects.length} project(s)`,
      });
    } catch (err) {
      checks.push({ name: "projects.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // Optional sibling configs — present if the user has registered
  // any. Doctor surfaces parse errors but missing files are fine.
  let labelsConfig: Awaited<ReturnType<typeof loadLabelsConfig>> | undefined;
  if (await fileExists(getLabelsConfigPath(locttDir))) {
    try {
      labelsConfig = await loadLabelsConfig(locttDir);
      checks.push({ name: "labels.yaml", status: "ok", message: `${labelsConfig.labels.length} label(s)` });
    } catch (err) {
      checks.push({ name: "labels.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  let milestonesConfig: Awaited<ReturnType<typeof loadMilestonesConfig>> | undefined;
  if (await fileExists(getMilestonesConfigPath(locttDir))) {
    try {
      milestonesConfig = await loadMilestonesConfig(locttDir);
      checks.push({
        name: "milestones.yaml",
        status: "ok",
        message: `${milestonesConfig.milestones.length} milestone(s)`,
      });
    } catch (err) {
      checks.push({ name: "milestones.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  let sprintsConfig: Awaited<ReturnType<typeof loadSprintsConfig>> | undefined;
  if (await fileExists(getSprintsConfigPath(locttDir))) {
    try {
      sprintsConfig = await loadSprintsConfig(locttDir);
      checks.push({
        name: "sprints.yaml",
        status: "ok",
        message: `${sprintsConfig.sprints.length} sprint(s)`,
      });
    } catch (err) {
      checks.push({ name: "sprints.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  if (await fileExists(getCalendarConfigPath(locttDir))) {
    try {
      await loadCalendarConfig(locttDir);
      checks.push({ name: "calendar.yaml", status: "ok", message: "valid" });
    } catch (err) {
      checks.push({ name: "calendar.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // list-view.yaml: optional workspace filter-chip config. Surfaces
  // parse errors, then cross-checks every entry in
  // filters.visible/hidden against the union of built-in field keys
  // and declared custom_fields[].key. Dangling refs are informational
  // — the resolution order treats them as missing and falls through.
  if (await fileExists(getListViewConfigPath(locttDir))) {
    try {
      const lv = await loadListViewConfig(locttDir);
      const entries = [
        ...(lv.filters?.visible ?? []),
        ...(lv.filters?.hidden ?? []),
      ];
      checks.push({
        name: "list-view.yaml",
        status: "ok",
        message: `${entries.length} chip entry/entries`,
      });

      if (workflowConfig && entries.length > 0) {
        const customFieldKeys = new Set(workflowConfig.custom_fields.map(f => f.key));
        const dangling = entries.filter(
          k => !BUILTIN_FILTER_FIELD_KEYS.has(k) && !customFieldKeys.has(k),
        );
        if (dangling.length > 0) {
          const sample = dangling.slice(0, 3).join(", ");
          const more = dangling.length > 3 ? ` (+${dangling.length - 3} more)` : "";
          checks.push({
            name: "list-view.yaml references",
            status: "warn",
            message: `${dangling.length} entry/entries refer to unknown fields: ${sample}${more}`,
          });
        }
      }
    } catch (err) {
      checks.push({ name: "list-view.yaml", status: "error", message: `parse error: ${(err as Error).message}` });
    }
  }

  // Users — folder-per-user. Surfaces malformed entries via load.
  if (await fileExists(getUsersDir(locttDir))) {
    try {
      const users = await loadAllUsers(locttDir);
      checks.push({
        name: "users/",
        status: "ok",
        message: `${users.length} user(s)`,
      });
    } catch (err) {
      checks.push({ name: "users/", status: "error", message: `load error: ${(err as Error).message}` });
    }
  }

  // Check relationships and dangling references using the loaded
  // configs. Walk every task once and aggregate.
  if (workflowConfig) {
    try {
      const relErrors = await validateRelationships(locttDir, workflowConfig);
      if (relErrors.length > 0) {
        checks.push({
          name: "relationships",
          status: "warn",
          message: `${relErrors.length} issue(s) found`,
        });
      }
      const tasks = await loadAllTasks(locttDir);
      // Aggregate field-reference errors across tasks.
      const aux = {
        ...(projectsConfig !== undefined ? { projects: projectsConfig } : {}),
        ...(labelsConfig !== undefined ? { labels: labelsConfig } : {}),
        ...(milestonesConfig !== undefined ? { milestones: milestonesConfig } : {}),
        ...(sprintsConfig !== undefined ? { sprints: sprintsConfig } : {}),
      };
      let danglingCount = 0;
      const samples: string[] = [];
      for (const task of tasks) {
        const errors = validateTaskAgainstWorkflow(task.frontmatter, workflowConfig, aux);
        // Only count reference errors (project/milestone/sprint/labels) here;
        // workflow-key errors are out of scope for this aggregate view.
        const refErrors = errors.filter(e =>
          e.field === "project"
          || e.field === "milestone"
          || e.field === "sprint"
          || e.field.startsWith("labels["),
        );
        if (refErrors.length > 0) {
          danglingCount += refErrors.length;
          if (samples.length < 3) {
            samples.push(`${task.frontmatter.key}: ${refErrors[0]?.message ?? ""}`);
          }
        }
      }
      if (danglingCount > 0) {
        checks.push({
          name: "task references",
          status: "warn",
          message: `${danglingCount} dangling reference(s); e.g. ${samples.join("; ")}`,
        });
      } else if (relErrors.length === 0) {
        checks.push({
          name: "tasks",
          status: "ok",
          message: `${tasks.length} task(s) found, references valid`,
        });
      }

      // Structural cycle scan. Pre-fix versions of linkTask let an
      // inverse-key call slip past the cycle guard; cycles may also
      // be introduced by direct frontmatter edits or by a sync that
      // didn't run reconcile. Surface them here without auto-repair.
      const cycles = findStructuralCycles(tasks, workflowConfig);
      if (cycles.length > 0) {
        const byId = new Map(tasks.map(t => [t.frontmatter.id, t]));
        const byKeyToString = (ids: readonly string[]): string =>
          ids.map(id => byId.get(id)?.frontmatter.key ?? id).join(" -> ");
        const sample = cycles
          .slice(0, 2)
          .map(c => `${c.relationshipKey}: ${byKeyToString(c.path)}`)
          .join("; ");
        const more = cycles.length > 2 ? ` (+${cycles.length - 2} more)` : "";
        checks.push({
          name: "structural cycles",
          status: "warn",
          message: `${cycles.length} cycle(s) found: ${sample}${more}`,
        });
      }
    } catch {
      // Skip on error — earlier checks already surfaced parse failures.
    }
  }

  // Key-index integrity. The index is a cache LocTT maintains; the
  // only on-disk drift case is out-of-band edits to a task's `key`
  // / `key_history` (vim, scripts), which LocTT cannot auto-detect
  // because the indexed task id is still present. Surface drift
  // here so the user knows to rerun with --rebuild-index.
  if (await fileExists(getTasksDir(locttDir))) {
    try {
      const index = await loadKeyIndex(locttDir);
      if (!index) {
        checks.push({
          name: "key index",
          status: "warn",
          message: "no index on disk — will rebuild on next lookup",
        });
      } else {
        const allTaskIds = new Set(await listTaskIds(locttDir));
        const issues: string[] = [];
        const indexedIds = new Set<string>();
        for (const [indexedKey, id] of Object.entries(index.entries)) {
          indexedIds.add(id);
          if (!allTaskIds.has(id)) {
            issues.push(`${indexedKey} → ${id} (target missing)`);
            continue;
          }
          try {
            const task = await readTask(locttDir, id);
            const current = task.frontmatter.key;
            const history = task.frontmatter.key_history ?? [];
            if (current !== indexedKey && !history.includes(indexedKey)) {
              issues.push(`${indexedKey} → ${id} (now has key ${current})`);
            }
          } catch {
            issues.push(`${indexedKey} → ${id} (unreadable)`);
          }
        }
        const orphanIds = [...allTaskIds].filter(id => !indexedIds.has(id));
        if (issues.length > 0 || orphanIds.length > 0) {
          const parts: string[] = [];
          if (issues.length > 0) {
            const sample = issues.slice(0, 3).join("; ");
            const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
            parts.push(`${issues.length} stale entry/entries: ${sample}${more}`);
          }
          if (orphanIds.length > 0) {
            parts.push(`${orphanIds.length} task dir(s) not in index`);
          }
          checks.push({
            name: "key index",
            status: "warn",
            message: `${parts.join("; ")} — rerun with --rebuild-index to repair`,
          });
        } else {
          checks.push({
            name: "key index",
            status: "ok",
            message: `${Object.keys(index.entries).length} entry/entries, in sync`,
          });
        }
      }
    } catch (err) {
      checks.push({
        name: "key index",
        status: "error",
        message: `check failed: ${(err as Error).message}`,
      });
    }
  }

  if (options.rebuildIndex) {
    try {
      const rebuilt = await rebuildKeyIndex(locttDir);
      checks.push({
        name: "key index rebuild",
        status: "ok",
        message: `rebuilt with ${Object.keys(rebuilt.entries).length} entry/entries`,
      });
    } catch (err) {
      checks.push({
        name: "key index rebuild",
        status: "error",
        message: `failed: ${(err as Error).message}`,
      });
    }
  }

  return checks;
}
