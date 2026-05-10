import { readFile } from "node:fs/promises";

import type { SyncState } from "@loctt/contracts";
import {
  DEFAULT_GIT_AUTO_FETCH,
  DEFAULT_GIT_AUTO_PUSH,
  DEFAULT_GIT_BRANCH,
  DEFAULT_GIT_REMOTE,
} from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getSyncStatePath } from "../paths/index.js";
import {
  assertBoolean as _assertBoolean,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

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

/** Parses and validates raw YAML content into a SyncState. Migrates older formats. */
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

  // Migrate-on-read: fill defaults for newer fields if missing.
  let remote: string;
  if (git["remote"] === undefined) {
    remote = DEFAULT_GIT_REMOTE;
  } else {
    assertString(git["remote"], "git.remote");
    remote = git["remote"];
  }

  let autoPush: boolean;
  if (git["auto_push"] === undefined) {
    autoPush = DEFAULT_GIT_AUTO_PUSH;
  } else {
    assertBoolean(git["auto_push"], "git.auto_push");
    autoPush = git["auto_push"];
  }

  let autoFetch: boolean;
  if (git["auto_fetch"] === undefined) {
    autoFetch = DEFAULT_GIT_AUTO_FETCH;
  } else {
    assertBoolean(git["auto_fetch"], "git.auto_fetch");
    autoFetch = git["auto_fetch"];
  }

  return {
    git: {
      enabled: git["enabled"],
      branch: git["branch"],
      remote,
      auto_push: autoPush,
      auto_fetch: autoFetch,
      ...(lastSynced !== undefined ? { last_synced_commit: lastSynced } : {}),
    },
  };
}

/** Serializes a SyncState to YAML string. */
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

/** Loads sync.yaml from .loctt/local/. */
export async function loadSyncState(locttDir: string): Promise<SyncState> {
  const filePath = getSyncStatePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseSyncState(content);
}

/** Writes sync.yaml to .loctt/local/. Creates directories if needed. */
export async function saveSyncState(locttDir: string, state: SyncState): Promise<void> {
  await writeFileAtomically(getSyncStatePath(locttDir), serializeSyncState(state));
}

export { DEFAULT_GIT_BRANCH };
