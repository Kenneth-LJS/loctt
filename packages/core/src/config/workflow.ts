import { readFile } from "node:fs/promises";

import type { WorkflowConfig } from "@loctt/contracts";
import { WorkflowConfigSchema } from "@loctt/contracts";
import { z } from "zod";

import { getWorkflowConfigPath } from "../paths/index.js";
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
  const content = await readFile(filePath, "utf-8");
  return parseWorkflowConfig(content);
}
