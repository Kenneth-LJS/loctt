import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { WorkflowConfig } from "@loctt/contracts";
import { getWorkflowConfigPath } from "../paths/index.js";

/** Errors thrown when workflow config is invalid. */
export class WorkflowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkflowConfigError(`${path} must be a non-empty string`);
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkflowConfigError(`${path} must be an array`);
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkflowConfigError(`${path} must be an object`);
  }
}

const VALID_STATUS_CATEGORIES = new Set(["pending", "active", "completed", "discarded"]);
const VALID_FIELD_TYPES = new Set(["string", "number", "date", "boolean", "enum"]);

function parseStatuses(raw: unknown): WorkflowConfig["statuses"] {
  assertArray(raw, "statuses");
  return raw.map((item, i) => {
    assertObject(item, `statuses[${i}]`);
    assertString(item["key"], `statuses[${i}].key`);
    assertString(item["label"], `statuses[${i}].label`);
    assertString(item["category"], `statuses[${i}].category`);
    if (!VALID_STATUS_CATEGORIES.has(item["category"])) {
      throw new WorkflowConfigError(
        `statuses[${i}].category must be one of: ${[...VALID_STATUS_CATEGORIES].join(", ")}`
      );
    }
    return {
      key: item["key"],
      label: item["label"],
      category: item["category"] as WorkflowConfig["statuses"][number]["category"],
    };
  });
}

function parsePriorities(raw: unknown): WorkflowConfig["priorities"] {
  assertArray(raw, "priorities");
  return raw.map((item, i) => {
    assertObject(item, `priorities[${i}]`);
    assertString(item["key"], `priorities[${i}].key`);
    assertString(item["label"], `priorities[${i}].label`);
    const value = item["value"];
    if (value !== undefined && typeof value !== "number") {
      throw new WorkflowConfigError(`priorities[${i}].value must be a number`);
    }
    return {
      key: item["key"],
      label: item["label"],
      ...(value !== undefined ? { value: value as number } : {}),
    };
  });
}

function parseTaskTypes(raw: unknown): WorkflowConfig["task_types"] {
  assertArray(raw, "task_types");
  return raw.map((item, i) => {
    assertObject(item, `task_types[${i}]`);
    assertString(item["key"], `task_types[${i}].key`);
    assertString(item["label"], `task_types[${i}].label`);
    return { key: item["key"], label: item["label"] };
  });
}

function parseRelationships(raw: unknown): WorkflowConfig["relationships"] {
  assertArray(raw, "relationships");
  return raw.map((item, i) => {
    assertObject(item, `relationships[${i}]`);
    assertString(item["key"], `relationships[${i}].key`);
    assertString(item["label"], `relationships[${i}].label`);
    assertString(item["inverse"], `relationships[${i}].inverse`);
    assertString(item["inverse_label"], `relationships[${i}].inverse_label`);
    return {
      key: item["key"],
      label: item["label"],
      inverse: item["inverse"],
      inverse_label: item["inverse_label"],
      ...(item["structural"] === true ? { structural: true } : {}),
    };
  });
}

function parseCustomFields(raw: unknown): WorkflowConfig["custom_fields"] {
  if (raw === undefined) return [];
  assertArray(raw, "custom_fields");
  return raw.map((item, i) => {
    assertObject(item, `custom_fields[${i}]`);
    assertString(item["key"], `custom_fields[${i}].key`);
    assertString(item["label"], `custom_fields[${i}].label`);
    assertString(item["type"], `custom_fields[${i}].type`);
    if (!VALID_FIELD_TYPES.has(item["type"])) {
      throw new WorkflowConfigError(
        `custom_fields[${i}].type must be one of: ${[...VALID_FIELD_TYPES].join(", ")}`
      );
    }
    const multi = item["multi"];
    if (typeof multi !== "boolean") {
      throw new WorkflowConfigError(`custom_fields[${i}].multi must be a boolean`);
    }
    const searchable = item["searchable"];
    if (typeof searchable !== "boolean") {
      throw new WorkflowConfigError(`custom_fields[${i}].searchable must be a boolean`);
    }

    const values = item["values"];
    let parsedValues: WorkflowConfig["custom_fields"][number]["values"];
    if (values !== undefined) {
      assertArray(values, `custom_fields[${i}].values`);
      parsedValues = values.map((v, j) => {
        assertObject(v, `custom_fields[${i}].values[${j}]`);
        assertString(v["key"], `custom_fields[${i}].values[${j}].key`);
        assertString(v["label"], `custom_fields[${i}].values[${j}].label`);
        const val = v["value"];
        if (val !== undefined && typeof val !== "number") {
          throw new WorkflowConfigError(`custom_fields[${i}].values[${j}].value must be a number`);
        }
        return {
          key: v["key"],
          label: v["label"],
          ...(val !== undefined ? { value: val as number } : {}),
        };
      });
    }

    return {
      key: item["key"],
      label: item["label"],
      type: item["type"] as WorkflowConfig["custom_fields"][number]["type"],
      multi,
      searchable,
      ...(parsedValues ? { values: parsedValues } : {}),
    };
  });
}

/**
 * Parses and validates raw YAML content into a WorkflowConfig.
 * Throws WorkflowConfigError for invalid data.
 */
export function parseWorkflowConfig(yamlContent: string): WorkflowConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "workflow config");

  const keyConfig = raw["key"];
  assertObject(keyConfig, "key");
  assertString(keyConfig["prefix"], "key.prefix");

  return {
    key: { prefix: keyConfig["prefix"] },
    statuses: parseStatuses(raw["statuses"]),
    priorities: parsePriorities(raw["priorities"]),
    task_types: parseTaskTypes(raw["task_types"]),
    relationships: parseRelationships(raw["relationships"]),
    custom_fields: parseCustomFields(raw["custom_fields"]),
  };
}

/**
 * Loads and parses workflow.yaml from the given .loctt directory.
 * Throws if file doesn't exist or content is invalid.
 */
export async function loadWorkflowConfig(locttDir: string): Promise<WorkflowConfig> {
  const filePath = getWorkflowConfigPath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseWorkflowConfig(content);
}
