import {
  DEFAULT_GIT_AUTO_FETCH,
  DEFAULT_GIT_AUTO_PUSH,
  DEFAULT_GIT_BRANCH,
  DEFAULT_GIT_REMOTE,
  type SyncState,
} from "@loctt/contracts";

import { disableGit, enableGit } from "../git/git-mode.js";
import { getSyncStatePath } from "../paths/index.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { fileExists } from "../utils/fs.js";

export class ConfigRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigRouterError";
  }
}

type ConfigType = "string" | "boolean";

export interface ConfigContext {
  readonly locttDir: string;
  readonly root: string;
}

/**
 * Optional per-key handler for keys whose mutation cannot be expressed as a
 * straight sync.yaml field write (e.g. git.enabled toggles entire git mode).
 * When present, set/unset route through these instead of writeGitKey.
 */
export interface ConfigCustomHandler {
  readonly set: (ctx: ConfigContext, value: string | boolean) => Promise<void>;
  readonly unset: (ctx: ConfigContext) => Promise<void>;
}

export interface ConfigKeyDef {
  readonly key: string;
  readonly type: ConfigType;
  readonly description: string;
  readonly customHandler?: ConfigCustomHandler;
}

const gitEnabledHandler: ConfigCustomHandler = {
  set: async (ctx, value) => {
    if (typeof value !== "boolean") {
      throw new ConfigRouterError("git.enabled must be a boolean");
    }
    if (value) {
      await enableGit(ctx.locttDir, ctx.root);
    } else {
      await disableGit(ctx.locttDir);
    }
  },
  unset: async (ctx) => {
    // Default for git.enabled is false — symmetric with set(false).
    await disableGit(ctx.locttDir);
  },
};

export const CONFIG_KEYS: readonly ConfigKeyDef[] = [
  { key: "git.enabled", type: "boolean", description: "Whether git-backed mode is enabled", customHandler: gitEnabledHandler },
  { key: "git.remote", type: "string", description: "Remote name to push/fetch the loctt branch" },
  { key: "git.branch", type: "string", description: "Branch name used to store loctt task data" },
  { key: "git.auto_push", type: "boolean", description: "Automatically push to remote after publish" },
  { key: "git.auto_fetch", type: "boolean", description: "Automatically fetch from remote before sync" },
];

export function listConfigKeys(): readonly ConfigKeyDef[] {
  return CONFIG_KEYS;
}

function findKeyDef(key: string): ConfigKeyDef {
  const def = CONFIG_KEYS.find(d => d.key === key);
  if (!def) {
    const valid = CONFIG_KEYS.map(d => d.key).join(", ");
    throw new ConfigRouterError(`unknown config key '${key}'. valid keys: ${valid}`);
  }
  return def;
}

export function parseConfigValue(def: ConfigKeyDef, raw: string): string | boolean {
  if (def.type === "boolean") {
    const v = raw.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
    throw new ConfigRouterError(`'${def.key}' is a boolean — got '${raw}'. accepted: true/false/1/0/yes/no`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ConfigRouterError(`'${def.key}' must be a non-empty string`);
  }
  return trimmed;
}

function defaultFor(key: string): string | boolean {
  switch (key) {
    case "git.remote": return DEFAULT_GIT_REMOTE;
    case "git.branch": return DEFAULT_GIT_BRANCH;
    case "git.auto_push": return DEFAULT_GIT_AUTO_PUSH;
    case "git.auto_fetch": return DEFAULT_GIT_AUTO_FETCH;
    case "git.enabled": return false;
    default: throw new ConfigRouterError(`no default for '${key}'`);
  }
}

async function requireSyncState(locttDir: string): Promise<SyncState> {
  const path = getSyncStatePath(locttDir);
  if (!(await fileExists(path))) {
    throw new ConfigRouterError("git mode is not enabled; run 'loctt git enable' first");
  }
  return loadSyncState(locttDir);
}

function readGitKey(state: SyncState, key: string): string | boolean | undefined {
  switch (key) {
    case "git.enabled": return state.git.enabled;
    case "git.branch": return state.git.branch;
    case "git.remote": return state.git.remote;
    case "git.auto_push": return state.git.auto_push;
    case "git.auto_fetch": return state.git.auto_fetch;
    default: return undefined;
  }
}

function writeGitKey(state: SyncState, key: string, value: string | boolean): SyncState {
  const g = { ...state.git };
  switch (key) {
    case "git.branch":
      if (typeof value !== "string") throw new ConfigRouterError("git.branch must be a string");
      g.branch = value;
      break;
    case "git.remote":
      if (typeof value !== "string") throw new ConfigRouterError("git.remote must be a string");
      g.remote = value;
      break;
    case "git.auto_push":
      if (typeof value !== "boolean") throw new ConfigRouterError("git.auto_push must be a boolean");
      g.auto_push = value;
      break;
    case "git.auto_fetch":
      if (typeof value !== "boolean") throw new ConfigRouterError("git.auto_fetch must be a boolean");
      g.auto_fetch = value;
      break;
    default:
      throw new ConfigRouterError(`cannot write '${key}' via this command`);
  }
  return { git: g };
}

export async function getConfigValue(
  locttDir: string,
  key: string,
): Promise<string | boolean | undefined> {
  const def = findKeyDef(key);
  if (def.key.startsWith("git.")) {
    const path = getSyncStatePath(locttDir);
    if (!(await fileExists(path))) {
      // Return the default so 'get' is never an error path.
      return defaultFor(key);
    }
    const state = await loadSyncState(locttDir);
    return readGitKey(state, key);
  }
  throw new ConfigRouterError(`no router for '${key}'`);
}

export async function setConfigValue(
  ctx: ConfigContext,
  key: string,
  rawValue: string,
): Promise<void> {
  const def = findKeyDef(key);
  const parsed = parseConfigValue(def, rawValue);

  if (def.customHandler) {
    await def.customHandler.set(ctx, parsed);
    return;
  }

  if (def.key.startsWith("git.")) {
    const state = await requireSyncState(ctx.locttDir);
    const next = writeGitKey(state, key, parsed);
    await saveSyncState(ctx.locttDir, next);
    return;
  }
  throw new ConfigRouterError(`no router for '${key}'`);
}

export async function unsetConfigValue(ctx: ConfigContext, key: string): Promise<void> {
  const def = findKeyDef(key);

  if (def.customHandler) {
    await def.customHandler.unset(ctx);
    return;
  }

  if (def.key.startsWith("git.")) {
    const state = await requireSyncState(ctx.locttDir);
    const def2 = defaultFor(key);
    const next = writeGitKey(state, key, def2);
    await saveSyncState(ctx.locttDir, next);
    return;
  }
  throw new ConfigRouterError(`no router for '${key}'`);
}
