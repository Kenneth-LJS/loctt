import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { readCurrentUserId, writeCurrentUserId } from "./current.js";
import { UserError } from "./errors.js";
import {
  archiveUser,
  createUser,
  deleteUser,
  unarchiveUser,
  updateUser,
} from "./lifecycle.js";
import {
  ensureDefaultUser,
  getCurrentUser,
  resolveUserRef,
  switchCurrentUser,
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
  // SVG inputs could carry inline <script> and execute under the
  // app's origin if served same-origin. The avatar pipeline rejects
  // SVG bytes pre-decode regardless of source-file extension or
  // sharp's ability to rasterise it.
  it("rejects an SVG avatar source by content sniff (extension is irrelevant)", async () => {
    const u = await createUser(locttDir, { name: "X" });
    // Note: file extension is .png to prove the rejection is by
    // content sniffing, not extension matching.
    const svgWithLyingExt = join(root, "pic.png");
    await writeFile(svgWithLyingExt, "<svg><script>alert(1)</script></svg>", "utf-8");
    await expect(
      updateUser(locttDir, u.id, { avatarSourcePath: svgWithLyingExt }),
    ).rejects.toThrow(/SVG avatars are not supported/i);
  });

  it("rejects SVG with leading whitespace and BOM", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const svg = join(root, "weird.svg");
    // UTF-8 BOM (EF BB BF) + whitespace + SVG opener.
    await writeFile(svg, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf, 0x0a, 0x20, 0x09]),
      Buffer.from('<SVG width="1"><script>alert(1)</script></SVG>', "utf-8"),
    ]));
    await expect(
      updateUser(locttDir, u.id, { avatarSourcePath: svg }),
    ).rejects.toThrow(/SVG avatars are not supported/i);
  });

  it("accepts a real PNG and stores it as avatar.jpg (always-JPG output)", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const png = join(root, "pic.png");
    // Generate a real 50x50 PNG via sharp itself. Using a fake
    // 4-byte magic-only file would fail decode and never exercise
    // the resize/re-encode path the chunk-10 pipeline cares about.
    const sharp = (await import("sharp")).default;
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#ff0000" },
    }).png().toBuffer();
    await writeFile(png, buf);

    const updated = await updateUser(locttDir, u.id, { avatarSourcePath: png });
    expect(updated.avatar).toBe("avatar.jpg");

    // The stored file is JPG bytes, not the original PNG.
    const storedPath = join(locttDir, "users", u.id, "avatar.jpg");
    const storedBytes = await readFile(storedPath);
    // JPG starts with FF D8 FF.
    expect(storedBytes[0]).toBe(0xff);
    expect(storedBytes[1]).toBe(0xd8);
    expect(storedBytes[2]).toBe(0xff);
    // PNG file would have started with 89 50 4e 47.
    expect(storedBytes[0]).not.toBe(0x89);
  });

  it("resizes oversized images down to <=500px on the longest side", async () => {
    const u = await createUser(locttDir, { name: "X" });
    const big = join(root, "big.png");
    const sharp = (await import("sharp")).default;
    const buf = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#0000ff" },
    }).png().toBuffer();
    await writeFile(big, buf);

    await updateUser(locttDir, u.id, { avatarSourcePath: big });

    const stored = await readFile(join(locttDir, "users", u.id, "avatar.jpg"));
    const meta = await sharp(stored).metadata();
    expect(meta.width).toBeLessThanOrEqual(500);
    expect(meta.height).toBeLessThanOrEqual(500);
    // 2000x1000 → 500x250 (preserves aspect, longest side caps).
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(250);
  });

  it("rejects sources larger than MAX_AVATAR_BYTES before reading them", async () => {
    const { MAX_AVATAR_BYTES } = await import("./avatar.js");
    const u = await createUser(locttDir, { name: "X" });
    const big = join(root, "huge.png");
    // Create a sparse file at MAX+1 bytes via a single seek-write.
    // Cheaper than allocating a buffer that big in memory.
    const fd = await (await import("node:fs/promises")).open(big, "w");
    await fd.truncate(MAX_AVATAR_BYTES + 1);
    await fd.close();
    await expect(
      updateUser(locttDir, u.id, { avatarSourcePath: big }),
    ).rejects.toThrow(/max is/i);
  });

  it("rejects a missing source path", async () => {
    const u = await createUser(locttDir, { name: "X" });
    await expect(
      updateUser(locttDir, u.id, { avatarSourcePath: join(root, "does-not-exist.png") }),
    ).rejects.toThrow(/avatar source not found/i);
  });

  it("strips EXIF metadata from the stored avatar", async () => {
    // Privacy hygiene: a phone-camera photo can carry GPS + serial
    // number + timestamp. Sharp's default jpeg() encode drops
    // non-orientation EXIF, but we assert it explicitly so a
    // future sharp upgrade or a misremembered .withMetadata()
    // call doesn't leak it back.
    const sharp = (await import("sharp")).default;
    const u = await createUser(locttDir, { name: "X" });
    const src = join(root, "with-exif.jpg");
    // Build a JPEG, then attach an EXIF block. sharp's
    // .withExifMerge accepts an object describing tags.
    const baseJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#222" },
    }).jpeg().toBuffer();
    const withExif = await sharp(baseJpeg)
      .withExifMerge({
        IFD0: { Software: "loctt-test", Artist: "private-info-here" },
      })
      .jpeg()
      .toBuffer();
    await writeFile(src, withExif);
    // Sanity: the source we just made does carry the exif.
    const srcMeta = await sharp(withExif).metadata();
    expect(srcMeta.exif).toBeDefined();

    await updateUser(locttDir, u.id, { avatarSourcePath: src });
    const stored = await readFile(join(locttDir, "users", u.id, "avatar.jpg"));
    const storedMeta = await sharp(stored).metadata();
    expect(storedMeta.exif).toBeUndefined();
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

describe("multi-user switching: state is global, settings are per-user", () => {
  // Regression suite for the "two users, two defaults, switch
  // between operations" flow. The bug class we're guarding against
  // is per-user state accidentally caching across switches, or
  // operations being silently scoped to one user when they should
  // be global.

  async function makeUserWithDefault(name: string, defaultProject: string): Promise<string> {
    const u = await createUser(locttDir, { name });
    const { saveUserSettings } = await import("./settings.js");
    await saveUserSettings(locttDir, u.id, { default_project: defaultProject });
    return u.id;
  }

  async function resolveCurrentUserDefault(): Promise<string | undefined> {
    const current = await getCurrentUser(locttDir);
    if (!current) return undefined;
    const { loadUserSettings } = await import("./settings.js");
    const s = await loadUserSettings(locttDir, current.id);
    const raw = s["default_project"];
    return typeof raw === "string" ? raw : undefined;
  }

  it("two users with distinct default_project resolve independently after switch", async () => {
    // Add a second project so each user's default points to something
    // real.
    const { createProject } = await import("../projects/manage.js");
    await createProject(locttDir, { key: "alt", prefix: "A-", label: "Alt" });

    const aliceId = await makeUserWithDefault("Alice", "task");
    const bobId = await makeUserWithDefault("Bob", "alt");

    await switchCurrentUser(locttDir, aliceId);
    expect(await resolveCurrentUserDefault()).toBe("task");

    await switchCurrentUser(locttDir, bobId);
    expect(await resolveCurrentUserDefault()).toBe("alt");

    // Switch back: must not stick to Bob's value.
    await switchCurrentUser(locttDir, aliceId);
    expect(await resolveCurrentUserDefault()).toBe("task");
  });

  it("tasks are global: a task created under user A is visible under user B", async () => {
    // LocTT is NOT a per-user-scoped tracker. Pin that contract here
    // so a future regression toward "user-scoped lists" is caught.
    const aliceId = await makeUserWithDefault("Alice", "task");
    const bobId = await makeUserWithDefault("Bob", "task");

    await switchCurrentUser(locttDir, aliceId);
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state,
        options: { project: "task", title: "made by Alice" },
      });
      await saveState(locttDir, state);
    });

    await switchCurrentUser(locttDir, bobId);
    const tasks = await loadAllTasks(locttDir);
    const titles = tasks.map(t => t.frontmatter.title);
    expect(titles).toContain("made by Alice");
  });

  it("rapid switching across three users picks up each user's settings in turn", async () => {
    // Stress the resolution cache (if any) by switching among 3
    // users multiple times. If anything is wrongly cached at module
    // scope, the second pass would observe stale state.
    const { createProject } = await import("../projects/manage.js");
    await createProject(locttDir, { key: "alt", prefix: "A-", label: "Alt" });
    await createProject(locttDir, { key: "third", prefix: "X-", label: "Third" });

    const a = await makeUserWithDefault("A", "task");
    const b = await makeUserWithDefault("B", "alt");
    const c = await makeUserWithDefault("C", "third");

    const order = [a, b, c, a, c, b, a];
    const expected = ["task", "alt", "third", "task", "third", "alt", "task"];
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      if (id === undefined) throw new Error("test bug");
      await switchCurrentUser(locttDir, id);
      expect(await resolveCurrentUserDefault(), `step ${i}`).toBe(expected[i]);
    }
  });

  it("a per-user default_project pointing at a hard-deleted project falls through to workspace default", async () => {
    // Regression for stale settings: user once had default=alt, alt
    // got hard-deleted, switching back to that user should not error
    // or resolve to the stale value.
    const { createProject, deleteProject } = await import("../projects/manage.js");
    await createProject(locttDir, { key: "alt", prefix: "A-", label: "Alt" });

    const aliceId = await makeUserWithDefault("Alice", "alt");
    await switchCurrentUser(locttDir, aliceId);
    expect(await resolveCurrentUserDefault()).toBe("alt");

    // Hard delete `alt` (no tasks reference it, so no remap needed).
    await deleteProject(locttDir, "alt", { hard: true });

    // The settings file still says default_project: "alt"; the
    // resolution layer must treat this as stale and fall through.
    // resolveProjectKey returns the workspace default ("task" by
    // initLoctt) in that case.
    const { resolveProjectKey } = await import("../projects/manage.js");
    const { loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    const userDefault = await resolveCurrentUserDefault();
    expect(userDefault).toBe("alt"); // settings file unchanged
    expect(resolveProjectKey(cfg, { userDefault })).toBe("task");
  });

  it("a per-user default_project pointing at an ARCHIVED project still resolves (current behavior)", async () => {
    // Pinning down today's behavior: archived projects remain in
    // projects.yaml, and resolveProjectKey doesn't filter on archived.
    // So a user whose default points at an archived project still
    // resolves to it. Phase 4 will revisit whether archived
    // references should be allowed as targets of new operations;
    // resolving an existing default is a separate question. If a
    // future change makes archived projects unresolvable, update this
    // test alongside it.
    const { createProject, archiveProject } = await import("../projects/manage.js");
    await createProject(locttDir, { key: "alt", prefix: "A-", label: "Alt" });
    const aliceId = await makeUserWithDefault("Alice", "alt");
    await switchCurrentUser(locttDir, aliceId);
    await archiveProject(locttDir, "alt");

    const { resolveProjectKey } = await import("../projects/manage.js");
    const { loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    const userDefault = await resolveCurrentUserDefault();
    expect(resolveProjectKey(cfg, { userDefault })).toBe("alt");
  });

  it("settings written under one user do not leak to another", async () => {
    // Per-user settings live under users/<id>/settings.yaml; the
    // resolver loads by current-user id. Set a value under A, switch
    // to B, confirm B reads no value.
    const aliceId = await makeUserWithDefault("Alice", "task");
    const bobId = await createUser(locttDir, { name: "Bob" });

    await switchCurrentUser(locttDir, aliceId);
    expect(await resolveCurrentUserDefault()).toBe("task");

    await switchCurrentUser(locttDir, bobId.id);
    // Bob has no settings file written; resolver returns undefined.
    expect(await resolveCurrentUserDefault()).toBeUndefined();
  });
});
