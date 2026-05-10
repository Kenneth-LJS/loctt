import { readFile } from "node:fs/promises";

import type { WorkflowConfig } from "@loctt/contracts";
import { WorkflowConfigSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { getWorkflowConfigPath } from "../paths/index.js";
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
 * The schema validates shapes; per-collection uniqueness checks
 * still live in `validateWorkflowConfig` (callers that want them
 * should run the validator after parsing).
 *
 * `custom_fields` is filled in as an empty array if missing — old
 * workflow.yaml files predate the field.
 */
export function parseWorkflowConfig(yamlContent: string): WorkflowConfig {
  const raw: unknown = parseYaml(yamlContent);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r["custom_fields"] === undefined) r["custom_fields"] = [];
    if (r["relationships"] === undefined) r["relationships"] = [];
    if (r["priorities"] === undefined) r["priorities"] = [];
  }
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
