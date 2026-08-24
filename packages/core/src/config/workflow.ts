
import type { WorkflowConfig } from "@loctt/contracts";
import { WorkflowConfigSchema } from "@loctt/contracts";
import { z } from "zod";

import { getWorkflowConfigPath } from "../paths/index.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

/** Errors thrown when workflow config is invalid. */
export class WorkflowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConfigError";
  }
}

/**
 * Parses and validates raw YAML content into a WorkflowConfig.
 *
 * The schema validates the shape of each entry. Per-collection
 * uniqueness checks live in `validateWorkflowConfig`, because Zod
 * validates entries independently and cannot see two entries collide.
 *
 * Reads do not run those checks: a config that is already on disk is
 * reported by `loctt doctor` rather than made unloadable. Every
 * *write* runs them — `saveWorkflowConfig` rejects rather than
 * persisting a config `doctor` would flag.
 */
export function parseWorkflowConfig(yamlContent: string): WorkflowConfig {
  const raw: unknown = safeParseYaml(yamlContent, "workflow.yaml");
  try {
    return WorkflowConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new WorkflowConfigError(formatZodIssues("workflow config", err));
    }
    throw err;
  }
}

export async function loadWorkflowConfig(locttDir: string): Promise<WorkflowConfig> {
  const filePath = getWorkflowConfigPath(locttDir);
  // Rethrown as a named cause rather than a bare errno: these throw on
  // absence too (deliberately — the file is required), so the caller
  // needs to know which file and why.
  const file = await readFileState(filePath);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT", path: filePath });
  }
  return parseWorkflowConfig(file.content);
}
