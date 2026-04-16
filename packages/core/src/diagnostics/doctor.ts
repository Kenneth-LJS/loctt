import { resolveLocttDir, getWorkflowConfigPath, getQueriesConfigPath, getStateFilePath, getTasksDir, getConfigDir } from "../paths/index.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { loadQueriesConfig } from "../config/queries.js";
import { loadState } from "../state/state.js";
import { validateWorkflowConfig } from "../config/validation.js";
import { loadAllTasks } from "../task/lookup.js";
import { validateRelationships } from "../task/traversal.js";
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
  const workflowPath = getWorkflowConfigPath(locttDir);
  if (!(await fileExists(workflowPath))) {
    checks.push({ name: "workflow.yaml", status: "error", message: "missing" });
  } else {
    try {
      const config = await loadWorkflowConfig(locttDir);
      const errors = validateWorkflowConfig(config);
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

  // Check relationships if workflow config loaded
  try {
    const config = await loadWorkflowConfig(locttDir);
    const relErrors = await validateRelationships(locttDir, config);
    if (relErrors.length > 0) {
      checks.push({
        name: "relationships",
        status: "warn",
        message: `${relErrors.length} issue(s) found`,
      });
    } else {
      const tasks = await loadAllTasks(locttDir);
      checks.push({
        name: "tasks",
        status: "ok",
        message: `${tasks.length} task(s) found, relationships valid`,
      });
    }
  } catch {
    // Skip relationship check if config can't load
  }

  return checks;
}
