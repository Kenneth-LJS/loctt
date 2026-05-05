import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enableGit } from "../git/git-mode.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadSyncState } from "../state/sync.js";
import {
  ConfigRouterError,
  getConfigValue,
  listConfigKeys,
  setConfigValue,
  unsetConfigValue,
} from "./router.js";

describe("config router", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cfg-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email t@t.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name T", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("listConfigKeys returns the known git.* keys", () => {
    const keys = listConfigKeys().map(k => k.key);
    expect(keys).toContain("git.enabled");
    expect(keys).toContain("git.remote");
    expect(keys).toContain("git.branch");
    expect(keys).toContain("git.auto_push");
    expect(keys).toContain("git.auto_fetch");
  });

  it("rejects unknown keys with a helpful message", async () => {
    await enableGit(locttDir, root);
    await expect(getConfigValue(locttDir, "bogus.key")).rejects.toThrow(/unknown config key/);
    await expect(setConfigValue({ locttDir, root }, "bogus.key", "x")).rejects.toThrow(/unknown config key/);
    await expect(unsetConfigValue({ locttDir, root }, "bogus.key")).rejects.toThrow(/unknown config key/);
  });

  it("get returns defaults when sync.yaml is absent (never throws)", async () => {
    expect(await getConfigValue(locttDir, "git.remote")).toBe("origin");
    expect(await getConfigValue(locttDir, "git.branch")).toBe("loctt");
    expect(await getConfigValue(locttDir, "git.auto_push")).toBe(true);
    expect(await getConfigValue(locttDir, "git.auto_fetch")).toBe(true);
    expect(await getConfigValue(locttDir, "git.enabled")).toBe(false);
  });

  it("set/unset error cleanly when git mode is not enabled", async () => {
    await expect(setConfigValue({ locttDir, root }, "git.remote", "upstream")).rejects.toThrow(
      /git mode is not enabled/,
    );
    await expect(unsetConfigValue({ locttDir, root }, "git.remote")).rejects.toThrow(
      /git mode is not enabled/,
    );
  });

  it("listConfigKeys does not mark git.enabled as read-only", () => {
    const def = listConfigKeys().find(k => k.key === "git.enabled");
    expect(def).toBeDefined();
    // The legacy `readOnly` flag has been removed; key is writable via custom handler.
    expect((def as unknown as { readOnly?: boolean }).readOnly).toBeUndefined();
  });

  it("set git.enabled true enables git mode", async () => {
    await setConfigValue({ locttDir, root }, "git.enabled", "true");
    expect(await getConfigValue(locttDir, "git.enabled")).toBe(true);
    const state = await loadSyncState(locttDir);
    expect(state.git.enabled).toBe(true);
  });

  it("set git.enabled false disables git mode", async () => {
    await enableGit(locttDir, root);
    await setConfigValue({ locttDir, root }, "git.enabled", "false");
    expect(await getConfigValue(locttDir, "git.enabled")).toBe(false);
  });

  it("unset git.enabled disables git mode (resets to default)", async () => {
    await enableGit(locttDir, root);
    await unsetConfigValue({ locttDir, root }, "git.enabled");
    expect(await getConfigValue(locttDir, "git.enabled")).toBe(false);
  });

  it("propagates 'not inside a Git repository' from enableGit", async () => {
    const nonGitRoot = await mkdtemp(join(tmpdir(), "loctt-nogit-"));
    try {
      await initLoctt(nonGitRoot);
      const nonGitLocttDir = resolveLocttDir(nonGitRoot);
      await expect(
        setConfigValue({ locttDir: nonGitLocttDir, root: nonGitRoot }, "git.enabled", "true"),
      ).rejects.toThrow(/not inside a Git repository/);
    } finally {
      await rm(nonGitRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("propagates 'already enabled' from enableGit", async () => {
    await enableGit(locttDir, root);
    await expect(
      setConfigValue({ locttDir, root }, "git.enabled", "true"),
    ).rejects.toThrow(/already enabled/);
  });

  it("propagates 'already disabled' from disableGit", async () => {
    // disableGit throws when sync.yaml is missing too — use the after-disable path.
    await enableGit(locttDir, root);
    await setConfigValue({ locttDir, root }, "git.enabled", "false");
    await expect(
      setConfigValue({ locttDir, root }, "git.enabled", "false"),
    ).rejects.toThrow(/already disabled/);
  });

  it("set then get round-trips git.remote (string)", async () => {
    await enableGit(locttDir, root);
    await setConfigValue({ locttDir, root }, "git.remote", "upstream");
    expect(await getConfigValue(locttDir, "git.remote")).toBe("upstream");
    const state = await loadSyncState(locttDir);
    expect(state.git.remote).toBe("upstream");
  });

  it("set then get round-trips git.branch (string)", async () => {
    await enableGit(locttDir, root);
    await setConfigValue({ locttDir, root }, "git.branch", "loctt-data");
    expect(await getConfigValue(locttDir, "git.branch")).toBe("loctt-data");
  });

  it("set then get round-trips git.auto_push (boolean) accepting many literals", async () => {
    await enableGit(locttDir, root);
    for (const v of ["false", "0", "no", "NO", "False"]) {
      await setConfigValue({ locttDir, root }, "git.auto_push", v);
      expect(await getConfigValue(locttDir, "git.auto_push")).toBe(false);
    }
    for (const v of ["true", "1", "yes", "YES", "True"]) {
      await setConfigValue({ locttDir, root }, "git.auto_push", v);
      expect(await getConfigValue(locttDir, "git.auto_push")).toBe(true);
    }
  });

  it("rejects invalid boolean literals", async () => {
    await enableGit(locttDir, root);
    await expect(setConfigValue({ locttDir, root }, "git.auto_push", "maybe")).rejects.toThrow(ConfigRouterError);
  });

  it("rejects empty strings for string keys", async () => {
    await enableGit(locttDir, root);
    await expect(setConfigValue({ locttDir, root }, "git.remote", "   ")).rejects.toThrow(/non-empty/);
  });

  it("unset resets to default", async () => {
    await enableGit(locttDir, root);
    await setConfigValue({ locttDir, root }, "git.remote", "upstream");
    await unsetConfigValue({ locttDir, root }, "git.remote");
    expect(await getConfigValue(locttDir, "git.remote")).toBe("origin");

    await setConfigValue({ locttDir, root }, "git.auto_push", "false");
    await unsetConfigValue({ locttDir, root }, "git.auto_push");
    expect(await getConfigValue(locttDir, "git.auto_push")).toBe(true);
  });
});
