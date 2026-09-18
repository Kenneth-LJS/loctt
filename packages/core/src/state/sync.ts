import { readFile } from "node:fs/promises";

import type { SyncState } from "@loctt/contracts";
import {
  DEFAULT_GIT_BRANCH,
  SyncStateSchema,
} from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";
import { getSyncStatePath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

export class SyncStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStateError";
  }
}

/** Parses and validates raw YAML content into a SyncState. */
export function parseSyncState(yamlContent: string): SyncState {
  const raw: unknown = parseYaml(yamlContent);
  try {
    return SyncStateSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new SyncStateError(formatZodIssues("sync state", err));
    }
    throw err;
  }
}

export function serializeSyncState(state: SyncState): string {
  const g = state.git;
  const out: Record<string, unknown> = {
    enabled: g.enabled,
    branch: g.branch,
    remote: g.remote,
    auto_push: g.auto_push,
    auto_fetch: g.auto_fetch,
  };
  if (g.last_synced_commit !== undefined) {
    out["last_synced_commit"] = g.last_synced_commit;
  }
  return stringifyYaml({ git: out });
}

export async function loadSyncState(locttDir: string): Promise<SyncState> {
  const filePath = getSyncStatePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseSyncState(content);
}

export async function saveSyncState(locttDir: string, state: SyncState): Promise<void> {
  await writeFileAtomically(getSyncStatePath(locttDir), serializeSyncState(state));
}

export { DEFAULT_GIT_BRANCH };
