import { mkdir,readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SyncState } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getSyncStatePath } from "../paths/index.js";
import {
  assertBoolean as _assertBoolean,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";

export class SyncStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStateError";
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, SyncStateError);
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, SyncStateError);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  _assertBoolean(value, path, SyncStateError);
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
