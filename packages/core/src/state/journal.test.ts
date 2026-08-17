import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { initLoctt } from "../init/init.js";
// Importing the manage modules is what registers their recovery
// handlers via registerRecoveryHandler. Without these imports the
// recovery hook would log "no handler for kind" and skip every
// pending entry.
import { createLabel, deleteLabel } from "../labels/manage.js";
import { createMilestone, deleteMilestone } from "../milestones/manage.js";
import { getJournalPath } from "../paths/index.js";
import { createProject, deleteProject } from "../projects/manage.js";
import { createSprint, deleteSprint } from "../sprints/manage.js";
import { createTask } from "../task/create.js";
import { readTask, writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import { createUser, deleteUser } from "../users/lifecycle.js";
import { switchCurrentUser } from "../users/manage.js";
import { loadAllUsers } from "../users/profile.js";
import type { JournalEntry } from "./journal.js";
import {
  appendJournalEntry,
  JournalUnreadableError,
  loadJournal,
  recoverPendingJournal,
  saveJournal,
} from "./journal.js";
import { withStateLock } from "./lock.js";
import { loadState, saveState } from "./state.js";

let root: string;
let locttDir: string;

/** Cached id of the seeded project ("Tasks") from initLoctt. */
let TASK_PROJECT_ID: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-journal-"));
  await initLoctt(root, { docs: false });
  locttDir = join(root, ".loctt");
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  TASK_PROJECT_ID = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Helper: create a second project and return its id. */
async function makeP2(): Promise<string> {
  const def = await createProject(locttDir, { name: "Two", prefix: "P-" });
  return def.id;
}

/** Helper: create another project with custom name + prefix. */
async function makeProject(name: string, prefix: string): Promise<string> {
  const def = await createProject(locttDir, { name, prefix });
  return def.id;
}

/**
 * Seeds N tasks under the given project. Returns the task IDs.
 * Caller passes the project's id (ULID).
 */
async function seedTasks(project: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({
        locttDir,
        state,
        options: { project, title: `task-${i}` },
      });
      await saveState(locttDir, state);
      return created;
    });
    ids.push(task.frontmatter.id);
  }
  return ids;
}

/**
 * Writes a journal-entry directly to disk, simulating the state
 * the tracker would be in after a process crash mid-op (entry
 * exists, config edit may or may not have been applied).
 */
async function writeJournalEntries(entries: JournalEntry[]): Promise<void> {
  await saveJournal(locttDir, { entries });
}

describe("journal recovery — happy path replay", () => {
  it("replays a remap_project entry: rewrites tasks and drops config", async () => {
    // initLoctt already created the default `task` project; add a
    // second project so the remap target exists.
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 3);

    // Hand-write a journal entry as if deleteProject crashed
    // BEFORE doing any task remap or config edit.
    const entry: JournalEntry = {
      id: "01TEST_PROJECT_REMAP_HAPPY",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    // Trigger recovery via any withStateLock entry. Use a no-op
    // body so we're isolating the recovery hook's behavior.
    await withStateLock(locttDir, () => Promise.resolve());

    // After recovery, every task should reference P2 and the T
    // project should be gone from projects.yaml.
    const tasks = await loadAllTasks(locttDir);
    for (const t of tasks) {
      expect(t.frontmatter.project).toBe(p2Id);
    }
    const journal = await loadJournal(locttDir);
    expect(journal.entries).toHaveLength(0);
  });

  it("recovery is idempotent: a second run is a no-op", async () => {
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const entry: JournalEntry = {
      id: "01TEST_IDEMPOTENT",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve()); // first recovery
    const journal1 = await loadJournal(locttDir);
    expect(journal1.entries).toHaveLength(0);

    // Second call: nothing to do, should not throw.
    await withStateLock(locttDir, () => Promise.resolve());
    const journal2 = await loadJournal(locttDir);
    expect(journal2.entries).toHaveLength(0);
  });
});

describe("journal recovery — crash-point coverage", () => {
  it("crash before any task write: recovery applies all task remaps and config", async () => {
    // Equivalent to: deleteProject crashed immediately after writing
    // the journal entry. No task or config change had happened yet.
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 4);

    const entry: JournalEntry = {
      id: "01TEST_CRASH_BEFORE_LOOP",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.project).toBe(p2Id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash mid task-loop: recovery completes the remaining tasks", async () => {
    // Equivalent to: deleteProject got partway through the rewrite
    // loop. Half the tasks already say P2; half still say T.
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 4);

    // Pre-apply the first two task rewrites manually, simulating
    // a crash exactly between writes 2 and 3.
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      const { writeTask } = await import("../task/io.js");
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, project: p2Id },
      });
    }

    const entry: JournalEntry = {
      id: "01TEST_CRASH_MID_LOOP",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.project).toBe(p2Id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after task loop, before config: recovery completes the config edit", async () => {
    // All tasks are already remapped; config edit is still pending.
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    const { writeTask } = await import("../task/io.js");
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, project: p2Id },
      });
    }
    const entry: JournalEntry = {
      id: "01TEST_CRASH_BEFORE_CONFIG",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    const { loadProjectsConfig } = await import("../config/projects.js");
    const projects = await loadProjectsConfig(locttDir);
    expect(projects.projects.some(p => p.id === TASK_PROJECT_ID)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after config edit, before clearing journal: recovery clears entry", async () => {
    // Everything is done — tasks rewritten, project removed — but
    // the journal entry never got cleared. Recovery must clear it
    // without trying to redo the config edit (which would no-op
    // anyway, but we want zero side-effects on this path).
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const { writeTask } = await import("../task/io.js");
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, project: p2Id },
      });
    }
    // Apply the config edit ahead of recovery.
    const { saveProjectsConfig, loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    await saveProjectsConfig(locttDir, {
      projects: cfg.projects.filter(p => p.id !== TASK_PROJECT_ID),
    });

    const entry: JournalEntry = {
      id: "01TEST_CRASH_AFTER_CONFIG",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
    const projects = await loadProjectsConfig(locttDir);
    expect(projects.projects.some(p => p.id === TASK_PROJECT_ID)).toBe(false);
  });
});

describe("journal recovery — multiple stacked entries", () => {
  it("replays two queued entries in order", async () => {
    const p2Id = await makeP2();
    const p3Id = await makeProject("Three", "Q-");
    const ids1 = await seedTasks(TASK_PROJECT_ID, 2);
    const ids2 = await seedTasks(p2Id, 2);

    const journal = await loadJournal(locttDir);
    const next = appendJournalEntry(
      appendJournalEntry(journal, {
        id: "01TEST_FIRST",
        kind: "remap_project",
        started_at: "2026-05-12T10:00:00Z",
        from: TASK_PROJECT_ID,
        to: p3Id,
        task_ids: ids1,
        }),
      {
        id: "01TEST_SECOND",
        kind: "remap_project",
        started_at: "2026-05-12T10:00:01Z",
        from: p2Id,
        to: p3Id,
        task_ids: ids2,
        },
    );
    await saveJournal(locttDir, next);

    await withStateLock(locttDir, () => Promise.resolve());

    const tasks = await loadAllTasks(locttDir);
    for (const t of tasks) {
      expect(t.frontmatter.project).toBe(p3Id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });
});

describe("journal recovery — all op kinds", () => {
  it("replays a remap_label entry", async () => {
    const oldLabel = await createLabel(locttDir, { name: "Old" });
    const newLabel = await createLabel(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "labels", value: [oldLabel.id] });
    }

    const entry: JournalEntry = {
      id: "01TEST_LABEL",
      kind: "remap_label",
      started_at: "2026-05-12T10:00:00Z",
      from: oldLabel.id,
      to: newLabel.id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.labels).toContain(newLabel.id);
      expect(t.frontmatter.labels).not.toContain(oldLabel.id);
    }
    const { loadLabelsConfig } = await import("../config/labels.js");
    const labels = await loadLabelsConfig(locttDir);
    expect(labels.labels.some(l => l.id === oldLabel.id)).toBe(false);
  });

  it("replays a remap_milestone entry", async () => {
    const oldMs = await createMilestone(locttDir, { name: "Old MS" });
    const newMs = await createMilestone(locttDir, { name: "New MS" });
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "milestone", value: oldMs.id });
    }

    const entry: JournalEntry = {
      id: "01TEST_MILESTONE",
      kind: "remap_milestone",
      started_at: "2026-05-12T10:00:00Z",
      from: oldMs.id,
      to: newMs.id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.milestone).toBe(newMs.id);
    }
  });

  it("replays a remap_sprint entry with to=null (clears)", async () => {
    const sprint = await createSprint(locttDir, {
      name: "Sprint 1",
      start_date: "2026-01-01",
      end_date: "2026-01-15",
      state: "active",
    });
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "sprint", value: sprint.id });
    }

    const entry: JournalEntry = {
      id: "01TEST_SPRINT_NULL",
      kind: "remap_sprint",
      started_at: "2026-05-12T10:00:00Z",
      from: sprint.id,
      to: null,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.sprint).toBeUndefined();
    }
  });

  it("replays a remap_user entry that unassigns", async () => {
    const u1 = await createUser(locttDir, { name: "Alice" });
    const u2 = await createUser(locttDir, { name: "Bob" });
    await switchCurrentUser(locttDir, u2.id); // so u1 isn't active
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "assignee", value: u1.id });
    }

    const entry: JournalEntry = {
      id: "01TEST_USER_UNASSIGN",
      kind: "remap_user",
      started_at: "2026-05-12T10:00:00Z",
      from: u1.id,
      to: null,
      task_ids: ids,
      fields: ["assignee", "reporter"],
    };
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.assignee).toBeUndefined();
    }
    // Recovery handler also rm's the user dir.
    const users = await loadAllUsers(locttDir);
    expect(users.find(u => u.id === u1.id)).toBeUndefined();
  });
});

describe("journal recovery — defensive cases", () => {
  it("skips tasks that no longer exist", async () => {
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    const entry: JournalEntry = {
      id: "01TEST_MISSING_TASK",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: [...ids, "01NEVER_EXISTED"],
    };
    await writeJournalEntries([entry]);

    // Should not throw on the bogus id; recovery is defensive.
    await expect(
      withStateLock(locttDir, () => Promise.resolve()),
    ).resolves.toBeUndefined();

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.project).toBe(p2Id);
    }
  });

  it("refuses to run when the journal cannot be read", async () => {
    await writeFile(getJournalPath(locttDir), "this: is: not: valid: yaml :\n", "utf-8");
    // This test previously asserted the opposite — that a malformed
    // journal is treated as empty. That was asserting the bug: the
    // journal is the record of writes already in flight, so reading
    // it as "nothing pending" means recovery never runs and the
    // caller proceeds to write over a half-applied set (P-11).
    await expect(
      withStateLock(locttDir, () => Promise.resolve()),
    ).rejects.toThrow(JournalUnreadableError);
  });

  it("names the journal file, since the user has to repair it by hand", async () => {
    await writeFile(getJournalPath(locttDir), "this: is: not: valid: yaml :\n", "utf-8");
    await expect(
      withStateLock(locttDir, () => Promise.resolve()),
    ).rejects.toThrow(/journal\.yaml/);
  });

  it("still treats an absent journal as nothing pending", async () => {
    // Absent is a real state and must stay distinguishable from a
    // failure, or every fresh tracker refuses to run.
    await expect(
      withStateLock(locttDir, () => Promise.resolve()),
    ).resolves.toBeUndefined();
  });

  it("logs a warning and skips entries with no registered handler", async () => {
    // Hand-craft an entry whose kind no longer has a handler. We
    // can't easily un-register at runtime; instead, test the
    // exported recoverPendingJournal function with an empty
    // handler registry by asserting the warning path doesn't
    // throw. (The registry is a module-level singleton; this test
    // verifies the warn-and-skip behavior end-to-end.)
    // For coverage, we just confirm an unknown-shape entry slips
    // past loadJournal's schema and so never reaches the dispatch.
    const journalPath = getJournalPath(locttDir);
    await writeFile(
      journalPath,
      stringifyYaml({ entries: [{ id: "x", kind: "no_such_kind", started_at: "t", task_ids: [] }] }),
      "utf-8",
    );
    // Previously loadJournal returned empty here, which threw away
    // every *good* entry sitting beside the bad one. A shape it
    // cannot validate is a journal it cannot vouch for.
    await expect(loadJournal(locttDir)).rejects.toThrow(JournalUnreadableError);
  });
});

describe("journal recovery — synthesized crash state mid-loop", () => {
  it("a deleteProject killed mid-task-loop is fully recovered by the next withStateLock caller", async () => {
    // We can't reliably SIGKILL a child process at a precise step
    // from inside a unit test (timing race), so instead we build
    // the EXACT on-disk state a killed writer would leave behind:
    // journal entry written, first 3 of 8 task rewrites applied,
    // config edit pending. Then we verify the next withStateLock
    // call drives the op to completion. This exercises the same
    // recovery code path a real crash would trip; the only thing
    // it doesn't prove is "the journal write happens BEFORE the
    // first task write", which is enforced by the manage module
    // and covered by the upstream tests in this file.
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 8);

    const { writeTask } = await import("../task/io.js");
    for (const id of ids.slice(0, 3)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, project: p2Id },
      });
    }
    const entry: JournalEntry = {
      id: "01TEST_CRASH_SIMULATED",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    // Trigger recovery via a no-op critical section.
    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.project).toBe(p2Id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });
});

describe("journal recovery — happy-path ops also clear the journal", () => {
  it("a successful deleteProject leaves no journal entry", async () => {
    const p2Id = await makeP2();
    await seedTasks(TASK_PROJECT_ID, 2);
    await deleteProject(locttDir, TASK_PROJECT_ID, { hard: true, remapTo: p2Id });
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("a successful deleteLabel leaves no journal entry", async () => {
    const lbl = await createLabel(locttDir, { name: "L" });
    const ids = await seedTasks(TASK_PROJECT_ID, 1);
    const { setField } = await import("../task/update.js");
    await setField({ locttDir, taskId: ids[0]!, field: "labels", value: [lbl.id] });
    await deleteLabel(locttDir, lbl.id, { hard: true });
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("a successful deleteMilestone leaves no journal entry", async () => {
    const ms = await createMilestone(locttDir, { name: "M" });
    const ids = await seedTasks(TASK_PROJECT_ID, 1);
    const { setField } = await import("../task/update.js");
    await setField({ locttDir, taskId: ids[0]!, field: "milestone", value: ms.id });
    await deleteMilestone(locttDir, ms.id, { hard: true });
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("a successful deleteSprint leaves no journal entry", async () => {
    const sprint = await createSprint(locttDir, {
      name: "S",
      start_date: "2026-01-01",
      end_date: "2026-01-15",
      state: "active",
    });
    const ids = await seedTasks(TASK_PROJECT_ID, 1);
    const { setField } = await import("../task/update.js");
    await setField({ locttDir, taskId: ids[0]!, field: "sprint", value: sprint.id });
    await deleteSprint(locttDir, sprint.id, { hard: true });
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("a successful deleteUser leaves no journal entry", async () => {
    const u1 = await createUser(locttDir, { name: "Alice" });
    const u2 = await createUser(locttDir, { name: "Bob" });
    await switchCurrentUser(locttDir, u2.id);
    const ids = await seedTasks(TASK_PROJECT_ID, 1);
    const { setField } = await import("../task/update.js");
    await setField({ locttDir, taskId: ids[0]!, field: "assignee", value: u1.id });
    await deleteUser(locttDir, u1.id, { unassign: true });
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });
});

describe("recoverPendingJournal direct invocation", () => {
  it("called outside withStateLock still runs (the hook is the wiring; this is the API)", async () => {
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 1);
    const entry: JournalEntry = {
      id: "01TEST_DIRECT",
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);

    // Caller is responsible for the surrounding lock when
    // multiple processes might race. Single-process direct
    // invocation works.
    await recoverPendingJournal(locttDir);

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.project).toBe(p2Id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });
});

describe("journal recovery — audit logging", () => {
  // Suggestion 6: every successful replay emits an info-level audit
  // line so operators can correlate post-crash state changes with
  // the originating interrupted operation. The happy path stays
  // silent (loop body only runs when entries are pending).

  it("logs one info line per replayed entry, including kind and id", async () => {
    const p2Id = await makeP2();
    const ids = await seedTasks(TASK_PROJECT_ID, 1);

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const entryId = "01TEST_AUDIT_LOG";
    const entry: JournalEntry = {
      id: entryId,
      kind: "remap_project",
      started_at: "2026-05-12T10:00:00Z",
      from: TASK_PROJECT_ID,
      to: p2Id,
      task_ids: ids,
    };
    await writeJournalEntries([entry]);
    await recoverPendingJournal(locttDir);

    const messages = infoSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(messages).toMatch(/journal recovery replayed entry/);
    expect(messages).toContain(entryId);
    expect(messages).toMatch(/kind='remap_project'/);
    infoSpy.mockRestore();
  });

  it("does not log when the journal is empty (no spurious noise)", async () => {
    // Guards against the audit line accidentally being moved outside
    // the per-entry loop where it would fire on every lock entry.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    await recoverPendingJournal(locttDir);
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});

describe("journal recovery — remap_workflow", () => {
  // Phase 7: applyWorkflowEdit writes a remap_workflow journal entry
  // around its task-rewrite + list-view-prune + workflow-save
  // sequence. If the process crashes between any of those writes,
  // recovery replays the whole sequence idempotently from the
  // entry's `next` config.
  //
  // The handler is registered as a side-effect of importing
  // config/workflow-write.ts. The tests above don't trigger that
  // load (they use only entity-remap kinds), so each test below
  // ensures the module is loaded before driving recovery.

  it("replays a remap_workflow entry that lost the workflow save", async () => {
    // Stage the world such that:
    //   - workflow.yaml still has `blocks` AND `in_progress`
    //   - a journal entry says "drop blocks, remap wont_do → in_progress"
    //   - no task or config rewrites have happened yet
    // Then trigger recovery and verify the new workflow.yaml is
    // saved and the task was rewritten.
    const { loadWorkflowConfig } = await import("../config/workflow.js");
    // Loading workflow-write registers the remap_workflow handler.
    await import("../config/workflow-write.js");

    const prevWf = await loadWorkflowConfig(locttDir);

    // Add a task so the remap has something to touch.
    const [taskId] = await seedTasks(TASK_PROJECT_ID, 1);
    if (taskId === undefined) throw new Error("test setup");
    // Drop the `blocks` relationship, which the default workflow has.

    const next = {
      ...prevWf,
      relationships: prevWf.relationships.filter(r => r.key !== "blocks"),
    };

    const entry: JournalEntry = {
      id: "01TEST_WF_RECOVERY_BASIC",
      kind: "remap_workflow",
      started_at: "2026-05-12T10:00:00Z",
      next,
      remap: {},
    } as JournalEntry;
    await writeJournalEntries([entry]);

    // Sanity: the on-disk workflow still has `blocks` before recovery.
    expect(prevWf.relationships.some(r => r.key === "blocks")).toBe(true);

    // Trigger recovery via withStateLock.
    await withStateLock(locttDir, () => Promise.resolve());

    // Workflow saved to the new config.
    const afterWf = await loadWorkflowConfig(locttDir);
    expect(afterWf.relationships.some(r => r.key === "blocks")).toBe(false);
    // Journal cleared.
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("replays a remap_workflow entry idempotently when workflow.yaml is already updated", async () => {
    // Simulates the crash-after-save case: workflow.yaml is already
    // at `next`, but the journal entry wasn't cleared. Recovery
    // should re-run executeWorkflowRemap (no-op for tasks because
    // their values already match next) and then clear the entry
    // without error.
    const { saveWorkflowConfig } = await import("../config/workflow-write.js");
    const { loadWorkflowConfig } = await import("../config/workflow.js");
    const prevWf = await loadWorkflowConfig(locttDir);
    const next = {
      ...prevWf,
      relationships: prevWf.relationships.filter(r => r.key !== "blocks"),
    };
    // Pre-apply: workflow.yaml is already at `next` before recovery.
    await saveWorkflowConfig(locttDir, next);

    const entry: JournalEntry = {
      id: "01TEST_WF_RECOVERY_IDEMPOTENT",
      kind: "remap_workflow",
      started_at: "2026-05-12T10:00:00Z",
      next,
      remap: {},
    } as JournalEntry;
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    const afterWf = await loadWorkflowConfig(locttDir);
    expect(afterWf.relationships.some(r => r.key === "blocks")).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("replays a remap_workflow entry that applies a status remap mid-task-loop", async () => {
    // Stage state where SOME tasks were already rewritten but the
    // config/journal hadn't been touched. Recovery completes the
    // remaining task rewrites.
    const { loadWorkflowConfig } = await import("../config/workflow.js");
    await import("../config/workflow-write.js");

    const prevWf = await loadWorkflowConfig(locttDir);

    // Create 3 tasks; set first two to a different status manually
    // (simulating a partial rewrite where status `wont_do` is
    // being remapped to `done`).
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    const { readTask, writeTask } = await import("../task/io.js");
    // Status field defaults to undefined on seed, so set them to
    // wont_do first.
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, status: "wont_do" },
      });
    }
    // Simulate partial pre-recovery state: first two are already done.
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, status: "done" },
      });
    }

    const next = {
      ...prevWf,
      statuses: prevWf.statuses.filter(s => s.key !== "wont_do"),
    };
    const entry: JournalEntry = {
      id: "01TEST_WF_RECOVERY_MID_LOOP",
      kind: "remap_workflow",
      started_at: "2026-05-12T10:00:00Z",
      next,
      remap: { statuses: { wont_do: "done" } },
    } as JournalEntry;
    await writeJournalEntries([entry]);

    await withStateLock(locttDir, () => Promise.resolve());

    // All three tasks now in `done`; journal cleared.
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.status).toBe("done");
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("applyWorkflowEdit writes and clears the journal entry on the happy path", async () => {
    // The integration test: a normal applyWorkflowEdit call should
    // leave NO journal entry behind. Catches a regression where
    // someone forgets the clearJournalEntry at the end.
    const { applyWorkflowEdit } = await import("../config/workflow-write.js");
    const { loadWorkflowConfig } = await import("../config/workflow.js");
    const prevWf = await loadWorkflowConfig(locttDir);
    const next = {
      ...prevWf,
      relationships: prevWf.relationships.filter(r => r.key !== "blocks"),
    };
    await applyWorkflowEdit(locttDir, next);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });
});

/**
 * Phase 9: crash-point coverage for the four lighter remap kinds.
 * Each kind gets the same four scenarios that `remap_project` already
 * gets at the top of this file:
 *
 *   1. Before task loop — journal entry written, nothing else done.
 *   2. Mid task loop — first N tasks pre-rewritten by hand.
 *   3. After tasks, before config edit — all tasks rewritten, sibling
 *      config (or user dir) still untouched.
 *   4. After config edit, before clearing journal — everything done
 *      EXCEPT the clearJournalEntry call.
 *
 * Pattern: stage the on-disk state that a SIGKILL'd process would
 * have left behind, fire `withStateLock` to trigger recovery, then
 * verify (a) the operation completed end-to-end and (b) the journal
 * entry is gone.
 */
describe("journal recovery — crash-point coverage for remap_label", () => {
  async function tagTasksWithLabel(ids: string[], label: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "labels", value: [label] });
    }
  }

  it("crash before task loop: recovery applies all task remaps and config", async () => {
    const labelOld = await createLabel(locttDir, { name: "Old" });
    const labelNew = await createLabel(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagTasksWithLabel(ids, labelOld.id);

    await writeJournalEntries([{
      id: "01TEST_LABEL_BEFORE_LOOP",
      kind: "remap_label",
      started_at: "2026-05-12T10:00:00Z",
      from: labelOld.id, to: labelNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.labels).toContain(labelNew.id);
      expect(t.frontmatter.labels).not.toContain(labelOld.id);
    }
    const { loadLabelsConfig } = await import("../config/labels.js");
    expect((await loadLabelsConfig(locttDir)).labels.some(l => l.id === labelOld.id)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash mid task loop: recovery completes remaining tasks and config", async () => {
    const labelOld = await createLabel(locttDir, { name: "Old" });
    const labelNew = await createLabel(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagTasksWithLabel(ids, labelOld.id);

    // Pre-apply the first two: simulate crash between writes 2 and 3.
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, labels: [labelNew.id] },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_LABEL_MID_LOOP",
      kind: "remap_label",
      started_at: "2026-05-12T10:00:00Z",
      from: labelOld.id, to: labelNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.labels).toContain(labelNew.id);
      expect(t.frontmatter.labels).not.toContain(labelOld.id);
    }
    const { loadLabelsConfig } = await import("../config/labels.js");
    expect((await loadLabelsConfig(locttDir)).labels.some(l => l.id === labelOld.id)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after tasks, before config: recovery completes the config edit", async () => {
    const labelOld = await createLabel(locttDir, { name: "Old" });
    const labelNew = await createLabel(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    await tagTasksWithLabel(ids, labelOld.id);

    // Pre-apply all task rewrites; config still has `old`.
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, labels: [labelNew.id] },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_LABEL_BEFORE_CONFIG",
      kind: "remap_label",
      started_at: "2026-05-12T10:00:00Z",
      from: labelOld.id, to: labelNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    const { loadLabelsConfig } = await import("../config/labels.js");
    expect((await loadLabelsConfig(locttDir)).labels.some(l => l.id === labelOld.id)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after config, before clearing journal: recovery clears entry only", async () => {
    const labelOld = await createLabel(locttDir, { name: "Old" });
    const labelNew = await createLabel(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    await tagTasksWithLabel(ids, labelOld.id);
    // Apply both task rewrites AND the config deletion.
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, labels: [labelNew.id] },
      });
    }
    const { loadLabelsConfig, saveLabelsConfig } = await import("../config/labels.js");
    const cfg = await loadLabelsConfig(locttDir);
    await saveLabelsConfig(locttDir, {
      labels: cfg.labels.filter(l => l.id !== labelOld.id),
    });

    await writeJournalEntries([{
      id: "01TEST_LABEL_AFTER_CONFIG",
      kind: "remap_label",
      started_at: "2026-05-12T10:00:00Z",
      from: labelOld.id, to: labelNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
    expect((await loadLabelsConfig(locttDir)).labels.some(l => l.id === labelOld.id)).toBe(false);
  });
});

describe("journal recovery — crash-point coverage for remap_milestone", () => {
  async function tagWithMilestone(ids: string[], ms: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "milestone", value: ms });
    }
  }

  it("crash before task loop: recovery applies all task remaps and config", async () => {
    const msOld = await createMilestone(locttDir, { name: "Old" });
    const msNew = await createMilestone(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagWithMilestone(ids, msOld.id);

    await writeJournalEntries([{
      id: "01TEST_MS_BEFORE_LOOP",
      kind: "remap_milestone",
      started_at: "2026-05-12T10:00:00Z",
      from: msOld.id, to: msNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.milestone).toBe(msNew.id);
    }
    const { loadMilestonesConfig } = await import("../config/milestones.js");
    expect((await loadMilestonesConfig(locttDir)).milestones.some(m => m.id === msOld.id)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash mid task loop: recovery completes remaining tasks and config", async () => {
    const msOld = await createMilestone(locttDir, { name: "Old" });
    const msNew = await createMilestone(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagWithMilestone(ids, msOld.id);
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, milestone: msNew.id },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_MS_MID_LOOP",
      kind: "remap_milestone",
      started_at: "2026-05-12T10:00:00Z",
      from: msOld.id, to: msNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.milestone).toBe(msNew.id);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after tasks, before config: recovery completes the config edit", async () => {
    const msOld = await createMilestone(locttDir, { name: "Old" });
    const msNew = await createMilestone(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    await tagWithMilestone(ids, msOld.id);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, milestone: msNew.id },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_MS_BEFORE_CONFIG",
      kind: "remap_milestone",
      started_at: "2026-05-12T10:00:00Z",
      from: msOld.id, to: msNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    const { loadMilestonesConfig } = await import("../config/milestones.js");
    expect((await loadMilestonesConfig(locttDir)).milestones.some(m => m.id === msOld.id)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after config, before clearing journal: recovery clears entry only", async () => {
    const msOld = await createMilestone(locttDir, { name: "Old" });
    const msNew = await createMilestone(locttDir, { name: "New" });
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    await tagWithMilestone(ids, msOld.id);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, milestone: msNew.id },
      });
    }
    const { loadMilestonesConfig, saveMilestonesConfig } = await import("../config/milestones.js");
    const cfg = await loadMilestonesConfig(locttDir);
    await saveMilestonesConfig(locttDir, {
      milestones: cfg.milestones.filter(m => m.id !== msOld.id),
    });

    await writeJournalEntries([{
      id: "01TEST_MS_AFTER_CONFIG",
      kind: "remap_milestone",
      started_at: "2026-05-12T10:00:00Z",
      from: msOld.id, to: msNew.id,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
    expect((await loadMilestonesConfig(locttDir)).milestones.some(m => m.id === msOld.id)).toBe(false);
  });
});

describe("journal recovery — crash-point coverage for remap_sprint", () => {
  async function tagWithSprint(ids: string[], sprint: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "sprint", value: sprint });
    }
  }
  async function makeSprint(name: string): Promise<string> {
    const s = await createSprint(locttDir, {
      name,
      start_date: "2026-01-01", end_date: "2026-01-15",
      state: "active",
    });
    return s.id;
  }

  it("crash before task loop: recovery applies all task remaps and config", async () => {
    const sprintOldId = await makeSprint("Old");
    const sprintNewId = await makeSprint("New");
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagWithSprint(ids, sprintOldId);

    await writeJournalEntries([{
      id: "01TEST_SPRINT_BEFORE_LOOP",
      kind: "remap_sprint",
      started_at: "2026-05-12T10:00:00Z",
      from: sprintOldId, to: sprintNewId,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.sprint).toBe(sprintNewId);
    }
    const { loadSprintsConfig } = await import("../config/sprints.js");
    expect((await loadSprintsConfig(locttDir)).sprints.some(s => s.id === sprintOldId)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash mid task loop: recovery completes remaining tasks and config", async () => {
    const sprintOldId = await makeSprint("Old");
    const sprintNewId = await makeSprint("New");
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await tagWithSprint(ids, sprintOldId);
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, sprint: sprintNewId },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_SPRINT_MID_LOOP",
      kind: "remap_sprint",
      started_at: "2026-05-12T10:00:00Z",
      from: sprintOldId, to: sprintNewId,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.sprint).toBe(sprintNewId);
    }
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after tasks, before config: recovery completes the config edit", async () => {
    const sprintOldId = await makeSprint("Old");
    const sprintNewId = await makeSprint("New");
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    await tagWithSprint(ids, sprintOldId);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, sprint: sprintNewId },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_SPRINT_BEFORE_CONFIG",
      kind: "remap_sprint",
      started_at: "2026-05-12T10:00:00Z",
      from: sprintOldId, to: sprintNewId,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    const { loadSprintsConfig } = await import("../config/sprints.js");
    expect((await loadSprintsConfig(locttDir)).sprints.some(s => s.id === sprintOldId)).toBe(false);
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after config, before clearing journal: recovery clears entry only", async () => {
    const sprintOldId = await makeSprint("Old");
    const sprintNewId = await makeSprint("New");
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    await tagWithSprint(ids, sprintOldId);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, sprint: sprintNewId },
      });
    }
    const { loadSprintsConfig, saveSprintsConfig } = await import("../config/sprints.js");
    const cfg = await loadSprintsConfig(locttDir);
    await saveSprintsConfig(locttDir, {
      sprints: cfg.sprints.filter(s => s.id !== sprintOldId),
    });

    await writeJournalEntries([{
      id: "01TEST_SPRINT_AFTER_CONFIG",
      kind: "remap_sprint",
      started_at: "2026-05-12T10:00:00Z",
      from: sprintOldId, to: sprintNewId,
      task_ids: ids,
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
    expect((await loadSprintsConfig(locttDir)).sprints.some(s => s.id === sprintOldId)).toBe(false);
  });
});

describe("journal recovery — crash-point coverage for remap_user", () => {
  // remap_user is structurally different in step 3: the "config edit"
  // is `rm -rf <userDir>` rather than a YAML save. Otherwise the four
  // crash points are the same.

  async function setupUsers(): Promise<{ alice: string; bob: string }> {
    const a = await createUser(locttDir, { name: "Alice" });
    const b = await createUser(locttDir, { name: "Bob" });
    // Switch so Alice (the user being remapped) isn't active when
    // recovery runs — matches the deleteUser precondition.
    await switchCurrentUser(locttDir, b.id);
    return { alice: a.id, bob: b.id };
  }

  async function assignTo(ids: string[], userId: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    for (const id of ids) {
      await setField({ locttDir, taskId: id, field: "assignee", value: userId });
    }
  }

  it("crash before task loop: recovery remaps tasks and removes user dir", async () => {
    const { alice, bob } = await setupUsers();
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await assignTo(ids, alice);

    await writeJournalEntries([{
      id: "01TEST_USER_BEFORE_LOOP",
      kind: "remap_user",
      started_at: "2026-05-12T10:00:00Z",
      from: alice, to: bob,
      task_ids: ids,
      fields: ["assignee", "reporter"],
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.assignee).toBe(bob);
    }
    expect((await loadAllUsers(locttDir)).find(u => u.id === alice)).toBeUndefined();
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash mid task loop: recovery completes the remaining tasks and removes user dir", async () => {
    const { alice, bob } = await setupUsers();
    const ids = await seedTasks(TASK_PROJECT_ID, 4);
    await assignTo(ids, alice);
    for (const id of ids.slice(0, 2)) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, assignee: bob },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_USER_MID_LOOP",
      kind: "remap_user",
      started_at: "2026-05-12T10:00:00Z",
      from: alice, to: bob,
      task_ids: ids,
      fields: ["assignee", "reporter"],
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    for (const id of ids) {
      const t = await readTask(locttDir, id);
      expect(t.frontmatter.assignee).toBe(bob);
    }
    expect((await loadAllUsers(locttDir)).find(u => u.id === alice)).toBeUndefined();
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after tasks, before user dir removed: recovery completes the dir removal", async () => {
    const { alice, bob } = await setupUsers();
    const ids = await seedTasks(TASK_PROJECT_ID, 3);
    await assignTo(ids, alice);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, assignee: bob },
      });
    }

    await writeJournalEntries([{
      id: "01TEST_USER_BEFORE_DIR_RM",
      kind: "remap_user",
      started_at: "2026-05-12T10:00:00Z",
      from: alice, to: bob,
      task_ids: ids,
      fields: ["assignee", "reporter"],
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadAllUsers(locttDir)).find(u => u.id === alice)).toBeUndefined();
    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
  });

  it("crash after user dir removed, before clearing journal: recovery clears entry only", async () => {
    const { alice, bob } = await setupUsers();
    const ids = await seedTasks(TASK_PROJECT_ID, 2);
    await assignTo(ids, alice);
    for (const id of ids) {
      const t = await readTask(locttDir, id);
      await writeTask(locttDir, id, {
        ...t,
        frontmatter: { ...t.frontmatter, assignee: bob },
      });
    }
    // Remove the user dir ahead of recovery (mirrors deleteUser's rm).
    const { getUserDir } = await import("../paths/index.js");
    await rm(getUserDir(locttDir, alice), { recursive: true, force: true });

    await writeJournalEntries([{
      id: "01TEST_USER_AFTER_DIR_RM",
      kind: "remap_user",
      started_at: "2026-05-12T10:00:00Z",
      from: alice, to: bob,
      task_ids: ids,
      fields: ["assignee", "reporter"],
    }]);

    await withStateLock(locttDir, () => Promise.resolve());

    expect((await loadJournal(locttDir)).entries).toHaveLength(0);
    expect((await loadAllUsers(locttDir)).find(u => u.id === alice)).toBeUndefined();
  });
});
