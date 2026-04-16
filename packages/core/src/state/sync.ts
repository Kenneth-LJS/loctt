import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SyncState } from "@loctt/contracts";
import { getSyncStatePath } from "../paths/index.js";

export class SyncStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStateError";
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SyncStateError(`${path} must be an object`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SyncStateError(`${path} must be a non-empty string`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new SyncStateError(`${path} must be a boolean`);
  }
}

/** Parses and validates raw YAML content into a SyncState. */
export function parseSyncState(yamlContent: string): SyncState {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "sync state");

  const git = raw["git"];
  assertObject(git, "git");
  assertBoolean(git["enabled"], "git.enabled");
  assertString(git["branch"], "git.branch");

  const lastSynced = git["last_synced_commit"];
  if (lastSynced !== undefined) {
    assertString(lastSynced, "git.last_synced_commit");
  }

  return {
    git: {
      enabled: git["enabled"],
      branch: git["branch"],
      ...(lastSynced !== undefined ? { last_synced_commit: lastSynced } : {}),
    },
  };
}

/** Serializes a SyncState to YAML string. */
export function serializeSyncState(state: SyncState): string {
  return stringifyYaml({ git: state.git });
}

/** Loads sync.yaml from .loctt/local/. */
export async function loadSyncState(locttDir: string): Promise<SyncState> {
  const filePath = getSyncStatePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseSyncState(content);
}

/** Writes sync.yaml to .loctt/local/. Creates directories if needed. */
export async function saveSyncState(locttDir: string, state: SyncState): Promise<void> {
  const filePath = getSyncStatePath(locttDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeSyncState(state), "utf-8");
}
