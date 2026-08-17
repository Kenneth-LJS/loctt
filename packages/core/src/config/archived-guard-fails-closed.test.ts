import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskFrontmatter } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAllUsersDetailed } from "../users/profile.js";
import {
  ArchivedReferenceError,
  assertNotArchivedReferences,
  loadArchivedGuardConfigs,
} from "./archived-guard.js";

/**
 * V7: a guard that cannot see must stop, not wave the caller through.
 *
 * Three bare catches left each slice undefined on a read failure, and
 * `archivedIds(undefined)` is an empty set — so the guard silently
 * allowed every reference it could not check. Verified against core
 * 2026-08-17: blocks with the config intact, allows when unreadable.
 *
 * These run at the **core** layer deliberately. The CLI's `set` path
 * resolves the entity name before the guard runs and throws on the
 * unreadable file first, so a CLI-level test passes while asserting
 * nothing — the exact shape of the fourteen tests CLAUDE.md records.
 */

const LABEL_ID = "01J000000000000000000LABEL";
const MILESTONE_ID = "01J00000000000000000MSTONE";
const USER_ID = "01J0000000000000000000USER";

let dir: string;

function labelsPath(): string {
  return join(dir, "config", "labels.yaml");
}

function milestonesPath(): string {
  return join(dir, "config", "milestones.yaml");
}

function userProfilePath(): string {
  return join(dir, "users", USER_ID, "profile.yaml");
}

/** A task introducing a brand-new reference — the case the guard checks. */
function frontmatter(patch: Partial<TaskFrontmatter>): TaskFrontmatter {
  return {
    id: "01J0000000000000000000TASK",
    key: "T1",
    title: "a task",
    status: "backlog",
    ...patch,
  } as TaskFrontmatter;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-guard-v7-"));
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "users", USER_ID), { recursive: true });

  // `loadProjectsConfig` reads unconditionally, so the guard cannot
  // load at all without one.
  await writeFile(
    join(dir, "config", "projects.yaml"),
    `projects:\n  - id: 01J00000000000000000PROJ\n    name: Web\n    prefix: T\n`,
    "utf-8",
  );
  await writeFile(
    labelsPath(),
    `labels:\n  - id: ${LABEL_ID}\n    name: blocker\n    archived: true\n`,
    "utf-8",
  );
  await writeFile(
    milestonesPath(),
    `milestones:\n  - id: ${MILESTONE_ID}\n    name: v1\n    archived: true\n`,
    "utf-8",
  );
  await writeFile(
    userProfilePath(),
    `id: ${USER_ID}\nname: ken\ntimezone: UTC\narchived: true\n`,
    "utf-8",
  );
});

afterEach(async () => {
  for (const p of [labelsPath(), milestonesPath(), userProfilePath()]) {
    await chmod(p, 0o644).catch(() => {});
  }
  await rm(dir, { recursive: true, force: true });
});

describe("control: the guard works when it can read its config", () => {
  it("blocks an archived label", async () => {
    const aux = await loadArchivedGuardConfigs(dir);
    expect(() =>
      assertNotArchivedReferences(frontmatter({ labels: [LABEL_ID] }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("blocks an archived milestone", async () => {
    const aux = await loadArchivedGuardConfigs(dir);
    expect(() =>
      assertNotArchivedReferences(frontmatter({ milestone: MILESTONE_ID }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("blocks an archived assignee", async () => {
    const aux = await loadArchivedGuardConfigs(dir);
    expect(() =>
      assertNotArchivedReferences(frontmatter({ assignee: USER_ID }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("allows a reference that is not archived", async () => {
    const aux = await loadArchivedGuardConfigs(dir);
    expect(() =>
      assertNotArchivedReferences(frontmatter({ labels: ["01J0000000000000000FRESH"] }), undefined, aux),
    ).not.toThrow();
  });
});

describe("V7: the guard fails closed on a slice it could not read", () => {
  it("refuses a new label when labels.yaml is unreadable", async () => {
    await chmod(labelsPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    // Before the fix this passed silently: the slice was undefined,
    // `archivedIds(undefined)` was empty, and the archived label
    // attached with a success report.
    expect(() =>
      assertNotArchivedReferences(frontmatter({ labels: [LABEL_ID] }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("refuses a new milestone when milestones.yaml is unreadable", async () => {
    await chmod(milestonesPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    expect(() =>
      assertNotArchivedReferences(frontmatter({ milestone: MILESTONE_ID }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("refuses a new assignee when the user profile is unreadable", async () => {
    await chmod(userProfilePath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    expect(() =>
      assertNotArchivedReferences(frontmatter({ assignee: USER_ID }), undefined, aux),
    ).toThrow(ArchivedReferenceError);
  });

  it("says the answer is unknown rather than claiming the entity is archived", async () => {
    await chmod(labelsPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    // The distinction matters: "it is archived, unarchive it" sends the
    // user somewhere that will not help. Naming the unreadable file is
    // what lets them fix the real problem.
    try {
      assertNotArchivedReferences(frontmatter({ labels: [LABEL_ID] }), undefined, aux);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ArchivedReferenceError);
      expect((err as Error).message).toMatch(/could not determine/i);
      expect((err as Error).message).toMatch(/labels\.yaml/);
    }
  });

  it("records the unreadable slice so callers can report it", async () => {
    await chmod(labelsPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    expect(aux.unreadable?.map(u => u.field)).toContain("labels");
  });

  it("reports nothing unreadable when every slice reads", async () => {
    const aux = await loadArchivedGuardConfigs(dir);
    // Guards against the marker appearing always, which would make
    // every write refuse and the distinction meaningless.
    expect(aux.unreadable).toBeUndefined();
  });
});

describe("one damaged file does not freeze the tracker", () => {
  it("still allows editing a task that already carries the reference", async () => {
    await chmod(labelsPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    const prev = frontmatter({ labels: [LABEL_ID] });
    const next = frontmatter({ labels: [LABEL_ID], status: "in_progress" });

    // The label is not *new*, so the guard has no decision to make.
    // Refusing here would make an unreadable labels.yaml block every
    // write on every task that has a label — destruction by another
    // route (P-11).
    expect(() => assertNotArchivedReferences(next, prev, aux)).not.toThrow();
  });

  it("still allows a field the unreadable slice has nothing to do with", async () => {
    await chmod(labelsPath(), 0o000);
    const aux = await loadArchivedGuardConfigs(dir);

    expect(() =>
      assertNotArchivedReferences(frontmatter({ status: "done" }), undefined, aux),
    ).not.toThrow();
  });
});

describe("loadAllUsersDetailed keeps what it cannot read", () => {
  it("reports an unreadable profile instead of dropping the user", async () => {
    await chmod(userProfilePath(), 0o000);
    const { profiles, unreadable } = await loadAllUsersDetailed(dir);

    // The old behaviour returned `profiles: []` and nothing else, so
    // the user simply ceased to exist as far as every caller knew.
    expect(profiles).toHaveLength(0);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]?.id).toBe(USER_ID);
  });

  it("returns the profile normally when it reads", async () => {
    const { profiles, unreadable } = await loadAllUsersDetailed(dir);
    expect(profiles.map(p => p.id)).toEqual([USER_ID]);
    expect(unreadable).toHaveLength(0);
  });
});
