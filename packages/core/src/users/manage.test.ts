import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/lookup.js";
import { readCurrentUserId, writeCurrentUserId } from "./current.js";
import {
  archiveUser,
  createUser,
  deleteUser,
  ensureDefaultUser,
  getCurrentUser,
  resolveUserRef,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  UserError,
} from "./manage.js";
import { loadAllUsers, userExists } from "./profile.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-users-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ensureDefaultUser", () => {
  it("creates exactly one default user when none exist", async () => {
    // initLoctt already ran ensureDefaultUser; the registered user
    // should be the active one.
    const all = await loadAllUsers(locttDir);
    expect(all).toHaveLength(1);
    const current = await getCurrentUser(locttDir);
    expect(current?.id).toBe(all[0]?.id);
  });

  it("is a no-op when users already exist", async () => {
    const before = await loadAllUsers(locttDir);
    await ensureDefaultUser(locttDir);
    const after = await loadAllUsers(locttDir);
    expect(after).toHaveLength(before.length);
  });
});

describe("createUser", () => {
  it("generates a UUID, writes profile.yaml, optionally switches", async () => {
    const created = await createUser(locttDir, {
      name: "Sara",
      email: "sara@example.com",
      timezone: "Asia/Singapore",
      switchToOnCreate: true,
    });
    expect(created.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(created.name).toBe("Sara");
    expect(created.email).toBe("sara@example.com");
    expect(created.timezone).toBe("Asia/Singapore");
    expect(await readCurrentUserId(locttDir)).toBe(created.id);
  });

  it("rejects an empty name", async () => {
    await expect(createUser(locttDir, { name: "   " })).rejects.toThrow(/non-empty/);
  });
});

describe("updateUser", () => {
  it("updates the name", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const updated = await updateUser(locttDir, u.id, { name: "Y" });
    expect(updated.name).toBe("Y");
  });

  it("clears email when set to null", async () => {
    const u = await createUser(locttDir, { name: "X", email: "x@x.com" });
    const updated = await updateUser(locttDir, u.id, { email: null });
    expect(updated.email).toBeUndefined();
  });
});

describe("avatar handling", () => {
  // SVG attachments could carry inline <script> and execute under the
  // app's origin. The allowlist intentionally omits svg.
  it("rejects an SVG avatar source", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const svg = join(root, "pic.svg");
    await writeFile(svg, "<svg><script>alert(1)</script></svg>", "utf-8");
    await expect(
      updateUser(locttDir, u.id, { avatarSourcePath: svg }),
    ).rejects.toThrow(/unsupported avatar extension/i);
  });

  it("accepts a PNG avatar source", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const png = join(root, "pic.png");
    // Minimal 1x1 PNG (a few bytes of arbitrary content is enough — the
    // implementation only inspects extension and size, not content).
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const updated = await updateUser(locttDir, u.id, { avatarSourcePath: png });
    expect(updated.avatar).toBe("avatar.png");
  });
});

describe("archiveUser", () => {
  it("sets the archived flag", async () => {
    const u = await createUser(locttDir, { name: "X" });
    await archiveUser(locttDir, u.id);
    const all = await loadAllUsers(locttDir);
    expect(all.find(p => p.id === u.id)?.archived).toBe(true);
  });

  it("blocks archiving the active user", async () => {
    const current = await getCurrentUser(locttDir);
    await expect(archiveUser(locttDir, current!.id)).rejects.toThrow(/active user/);
  });

  it("unarchive clears the flag", async () => {
    const u = await createUser(locttDir, { name: "X" });
    await archiveUser(locttDir, u.id);
    await unarchiveUser(locttDir, u.id);
    const all = await loadAllUsers(locttDir);
    expect(all.find(p => p.id === u.id)?.archived).toBeUndefined();
  });
});

describe("switchCurrentUser", () => {
  it("switches active user", async () => {
    const u = await createUser(locttDir, { name: "Other" });
    await switchCurrentUser(locttDir, u.id);
    expect(await readCurrentUserId(locttDir)).toBe(u.id);
  });

  it("throws on unknown user", async () => {
    await expect(switchCurrentUser(locttDir, "nonexistent")).rejects.toThrow(UserError);
  });
});

describe("deleteUser", () => {
  it("blocks deleting the active user", async () => {
    const current = await getCurrentUser(locttDir);
    await expect(deleteUser(locttDir, current!.id)).rejects.toThrow(/active user/);
  });

  it("deletes a user with no task references", async () => {
    const u = await createUser(locttDir, { name: "Removable" });
    const result = await deleteUser(locttDir, u.id);
    expect(result.remappedAssigneeCount).toBe(0);
    expect(await userExists(locttDir, u.id)).toBe(false);
  });

  it("requires --remap-to or --unassign when user has task refs", async () => {
    const u = await createUser(locttDir, { name: "Assigned" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "T", assignee: u.id },
      });
      await saveState(locttDir, state);
    });
    await expect(deleteUser(locttDir, u.id)).rejects.toThrow(/pass remapTo or unassign/);
  });

  it("rejects passing both --remap-to and --unassign", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const other = await createUser(locttDir, { name: "Other" });
    await expect(
      deleteUser(locttDir, u.id, { remapTo: other.id, unassign: true }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("remaps assignee/reporter to the target user", async () => {
    const u = await createUser(locttDir, { name: "Old" });
    const target = await createUser(locttDir, { name: "New" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "T", assignee: u.id, reporter: u.id },
      });
      await saveState(locttDir, state);
    });
    const result = await deleteUser(locttDir, u.id, { remapTo: target.id });
    expect(result.remappedAssigneeCount).toBe(1);
    expect(result.remappedReporterCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.assignee).toBe(target.id);
    expect(tasks[0]?.frontmatter.reporter).toBe(target.id);
  });

  it("clears assignee/reporter with --unassign", async () => {
    const u = await createUser(locttDir, { name: "Old" });
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir,
        state,
        options: { project: "task", title: "T", assignee: u.id },
      });
      await saveState(locttDir, state);
    });
    await deleteUser(locttDir, u.id, { unassign: true });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.assignee).toBeUndefined();
  });
});

describe("resolveUserRef", () => {
  it("resolves by ID", async () => {
    const u = await createUser(locttDir, { name: "Findme" });
    const found = await resolveUserRef(locttDir, u.id);
    expect(found.id).toBe(u.id);
  });

  it("resolves by exact name when unique", async () => {
    const u = await createUser(locttDir, { name: "UniqueName" });
    const found = await resolveUserRef(locttDir, "UniqueName");
    expect(found.id).toBe(u.id);
  });

  it("throws on ambiguous name", async () => {
    await createUser(locttDir, { name: "Same" });
    await createUser(locttDir, { name: "Same" });
    await expect(resolveUserRef(locttDir, "Same")).rejects.toThrow(/multiple users/);
  });

  it("throws on unknown name", async () => {
    await expect(resolveUserRef(locttDir, "NotHere")).rejects.toThrow(/unknown user/);
  });
});

describe(".gitignore is created by init", () => {
  it("includes the per-checkout entries", async () => {
    const content = await readFile(join(locttDir, ".gitignore"), "utf-8");
    expect(content).toContain(".current-user");
    expect(content).toContain("users/*/settings.yaml");
  });
});

describe("getCurrentUser self-heals when .current-user is stale", () => {
  it("repairs by picking another user when the pointer references a deleted one", async () => {
    // Stash current id, create a second user, then delete the
    // current-user pointer file.
    await createUser(locttDir, { name: "Backup" });
    await writeCurrentUserId(locttDir, "01HSV0000000000000NOTHERE");
    const current = await getCurrentUser(locttDir);
    expect(current).not.toBeNull();
    expect(current!.id).not.toBe("01HSV0000000000000NOTHERE");
  });

  it("returns null when no users exist", async () => {
    // Nuke users dir and pointer.
    await rm(join(locttDir, "users"), { recursive: true, force: true });
    await writeFile(join(locttDir, ".current-user"), "");
    const current = await getCurrentUser(locttDir);
    expect(current).toBeNull();
  });
});
