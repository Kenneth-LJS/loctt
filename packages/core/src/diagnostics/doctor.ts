import { getCalendarConfigPath, loadCalendarConfig } from "../config/calendar.js";
import { getLabelsConfigPath,loadLabelsConfig } from "../config/labels.js";
import { getMilestonesConfigPath,loadMilestonesConfig } from "../config/milestones.js";
import { getProjectsConfigPath, loadProjectsConfig } from "../config/projects.js";
import { loadQueriesConfig } from "../config/queries.js";
import { getSprintsConfigPath,loadSprintsConfig } from "../config/sprints.js";
import { validateTaskAgainstWorkflow,validateWorkflowConfig } from "../config/validation.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { getConfigDir,getQueriesConfigPath, getStateFilePath, getTasksDir, getUsersDir, getWorkflowConfigPath, resolveLocttDir } from "../paths/index.js";
import { loadState } from "../state/state.js";
import { loadAllTasks } from "../task/lookup.js";
import { validateRelationships } from "../task/traversal.js";
import { loadAllUsers } from "../users/profile.js";
import { fileExists } from "../utils/fs.js";

export type CheckStatus = "ok" | "warn" | "error";

export interface DiagnosticCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

/** Runs diagnostic checks on a .loctt tracker. */
export async function runDoctor(root: string): Promise<readonly DiagnosticCheck[]> {
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
    } catch {
      // Skip on error — earlier checks already surfaced parse failures.
    }
  }

  return checks;
}
