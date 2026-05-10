import { readFile } from "node:fs/promises";

import type { LocttState } from "@loctt/contracts";
import { LocttStateSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";
import { getStateFilePath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export function parseState(yamlContent: string): LocttState {
  const raw: unknown = parseYaml(yamlContent);
  try {
    return LocttStateSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new StateError(formatZodIssues("state", err));
    }
    throw err;
  }
}

export function serializeState(state: LocttState): string {
  const out: Record<string, unknown> = { keys: state.keys };
  if (state.retired_keys !== undefined && Object.keys(state.retired_keys).length > 0) {
    out["retired_keys"] = state.retired_keys;
  }
  return stringifyYaml(out);
}

export async function loadState(locttDir: string): Promise<LocttState> {
  const filePath = getStateFilePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseState(content);
}

/**
 * Writes state.yaml atomically. Coordination across writers
 * requires the caller to hold `withStateLock` around the
 * read-modify-write pair.
 */
export async function saveState(locttDir: string, state: LocttState): Promise<void> {
  await writeFileAtomically(getStateFilePath(locttDir), serializeState(state));
}
