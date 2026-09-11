import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { getTaskDir, getTaskFilePath } from "../paths/index.js";
import { readHistory } from "./history.js";
import { readTask,writeTask } from "./io.js";
import { attributableErrors,setField, setFields, TaskUpdateError,unsetField } from "./update.js";

describe("setField / unsetField", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-update-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const seed: Task = {
    frontmatter: {
      id: "abc",
      key: "T-1",
      title: "Original",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      status: "not_started",
      fields: { sprint_field: "sprint_1" },
    },
    body: "Body text.\n",
  };

  async function seedTask(): Promise<void> {
    await writeTask(locttDir, "abc", seed);
  }

  describe("setField", () => {
    it("sets a built-in optional field", async () => {
      await seedTask();
      const updated = await setField({ locttDir, taskId: "abc", field: "priority", value: "high" });
      expect(updated.frontmatter.priority).toBe("high");
      expect(updated.frontmatter.updated_at).not.toBe("2026-01-01T00:00:00Z");
    });

    it("updates status_updated_at when setting status", async () => {
      await seedTask();
      const updated = await setField({ locttDir, taskId: "abc", field: "status", value: "done" });
      expect(updated.frontmatter.status).toBe("done");
      expect(updated.frontmatter.status_updated_at).toBeTruthy();
    });

    it("sets title", async () => {
      await seedTask();
      const updated = await setField({ locttDir, taskId: "abc", field: "title", value: "New title" });
      expect(updated.frontmatter.title).toBe("New title");
    });

    it("sets a custom field under fields:", async () => {
      await seedTask();
      const updated = await setField({ locttDir, taskId: "abc", field: "owner_team", value: "platform" });
      expect(updated.frontmatter.fields).toEqual({
        sprint_field: "sprint_1",
        owner_team: "platform",
      });
    });

    it("throws on immutable field", async () => {
      await seedTask();
      await expect(setField({ locttDir, taskId: "abc", field: "id", value: "new" })).rejects.toThrow(TaskUpdateError);
      await expect(setField({ locttDir, taskId: "abc", field: "key", value: "T-2" })).rejects.toThrow(TaskUpdateError);
      await expect(setField({ locttDir, taskId: "abc", field: "created_at", value: "x" })).rejects.toThrow(TaskUpdateError);
    });

    it("persists changes to disk", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "priority", value: "low" });
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.priority).toBe("low");
    });

    it("preserves body when setting fields", async () => {
      await seedTask();
      const updated = await setField({ locttDir, taskId: "abc", field: "priority", value: "low" });
      expect(updated.body).toBe("Body text.\n");
    });
  });

  describe("unsetField", () => {
    it("unsets a built-in optional field", async () => {
      await seedTask();
      const updated = await unsetField(locttDir, "abc", "status");
      expect(updated.frontmatter.status).toBeUndefined();
    });

    it("unsets a custom field", async () => {
      await seedTask();
      const updated = await unsetField(locttDir, "abc", "sprint_field");
      expect(updated.frontmatter.fields).toBeUndefined();
    });

    it("throws on required field", async () => {
      await seedTask();
      await expect(unsetField(locttDir, "abc", "title")).rejects.toThrow(TaskUpdateError);
      await expect(unsetField(locttDir, "abc", "id")).rejects.toThrow(TaskUpdateError);
    });

    it("throws when custom field is not set", async () => {
      await seedTask();
      await expect(unsetField(locttDir, "abc", "nonexistent")).rejects.toThrow("not set");
    });

    it("persists changes to disk", async () => {
      await seedTask();
      await unsetField(locttDir, "abc", "status");
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.status).toBeUndefined();
    });
  });

  describe("completed_date auto-management", () => {
    const workflowConfig = {
      key: { prefix: "T-" },
      statuses: [
        { key: "not_started", label: "Not started", category: "pending" as const },
        { key: "in_progress", label: "In progress", category: "active" as const },
        { key: "done", label: "Done", category: "completed" as const },
      ],
      priorities: [],
      task_types: [],
      relationships: [],
      // Match the seed task's custom field so validation doesn't
      // reject the existing `sprint_field` value during status updates.
      custom_fields: [{
        key: "sprint_field",
        label: "Sprint",
        type: "string" as const,
        multi: false,
        searchable: false,
      }],
    };

    it("sets completed_date when transitioning into a completed status", async () => {
      await seedTask();
      const updated = await setField({
        locttDir,
        taskId: "abc",
        field: "status",
        value: "done",
        workflowConfig,
      });
      expect(updated.frontmatter.completed_date).toBeDefined();
      expect(updated.frontmatter.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("clears completed_date when transitioning out of a completed status", async () => {
      await seedTask();
      // First mark done
      await setField({
        locttDir, taskId: "abc", field: "status", value: "done", workflowConfig,
      });
      // Then move back
      const reopened = await setField({
        locttDir, taskId: "abc", field: "status", value: "in_progress", workflowConfig,
      });
      expect(reopened.frontmatter.completed_date).toBeUndefined();
    });

    it("does not touch completed_date when transitioning between non-completed statuses", async () => {
      await seedTask();
      const updated = await setField({
        locttDir, taskId: "abc", field: "status", value: "in_progress", workflowConfig,
      });
      expect(updated.frontmatter.completed_date).toBeUndefined();
    });

    it("does not retouch completed_date when going completed → completed", async () => {
      const cfg = {
        ...workflowConfig,
        statuses: [
          ...workflowConfig.statuses,
          { key: "wont_do", label: "Won't do", category: "completed" as const },
        ],
      };
      await seedTask();
      const first = await setField({
        locttDir, taskId: "abc", field: "status", value: "done", workflowConfig: cfg,
      });
      const dateOnFirst = first.frontmatter.completed_date;
      // Wait one tick to ensure timestamps would differ if we re-set
      await new Promise(r => setTimeout(r, 10));
      const second = await setField({
        locttDir, taskId: "abc", field: "status", value: "wont_do", workflowConfig: cfg,
      });
      // Both completed → preserve original date
      expect(second.frontmatter.completed_date).toBe(dateOnFirst);
    });

    it("rejects direct writes to completed_date", async () => {
      await seedTask();
      await expect(
        setField({
          locttDir, taskId: "abc", field: "completed_date", value: "2025-01-01",
        }),
      ).rejects.toThrow(/auto-managed/);
    });

    it("rejects unset on completed_date", async () => {
      await seedTask();
      await expect(unsetField(locttDir, "abc", "completed_date"))
        .rejects.toThrow(/auto-managed/);
    });
  });

  describe("setFields", () => {
    it("applies multiple set changes in one write with a single updated_at", async () => {
      await seedTask();
      // The user has to exist. `setFields` used to write the raw string
      // without resolving it, so `"u1"` reached disk as a reference to
      // nobody — this test asserted that bug. `setField` has rejected an
      // unknown user since MSL-C1; the two paths now agree.
      const { createUser } = await import("../users/lifecycle.js");
      const user = await createUser(locttDir, { name: "u1" });
      const updated = await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "priority", value: "high" },
          { field: "assignee", value: "u1" },
          { field: "title", value: "Renamed" },
        ],
      });
      expect(updated.frontmatter.priority).toBe("high");
      // Stored as the id, not the name — identity is a ULID (P-2).
      expect(updated.frontmatter.assignee).toBe(user.id);
      expect(updated.frontmatter.title).toBe("Renamed");
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.updated_at).toBe(updated.frontmatter.updated_at);
    });

    it("mixes set and unset (value === undefined) in one call", async () => {
      await seedTask();
      // The milestone is incidental setup, but it has to exist: setField
      // resolves a milestone reference to its id, and an unknown one is
      // refused rather than stored blindly (MSL-C1). Storing an
      // unresolvable name is what made milestone progress report 0/0.
      const { createMilestone } = await import("../milestones/manage.js");
      const ms = await createMilestone(locttDir, { name: "m1" });
      await setField({ locttDir, taskId: "abc", field: "milestone", value: ms.id });
      const updated = await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "priority", value: "low" },
          { field: "milestone", value: undefined },
        ],
      });
      expect(updated.frontmatter.priority).toBe("low");
      expect(updated.frontmatter.milestone).toBeUndefined();
    });

    it("appends history entries for each change", async () => {
      await seedTask();
      // As above: the assignee must resolve, or the write is refused.
      const { createUser } = await import("../users/lifecycle.js");
      await createUser(locttDir, { name: "u1" });
      await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "priority", value: "high" },
          { field: "assignee", value: "u1" },
        ],
      });
      const h = await readHistory(locttDir, "abc");
      const kinds = h.map(e => e.kind);
      expect(kinds.filter(k => k === "field_change").length).toBeGreaterThanOrEqual(2);
    });

    it("stamps status_updated_at when status is in the batch", async () => {
      await seedTask();
      const updated = await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "status", value: "done" },
          { field: "priority", value: "high" },
        ],
      });
      expect(updated.frontmatter.status).toBe("done");
      expect(updated.frontmatter.status_updated_at).toBe(updated.frontmatter.updated_at);
    });

    it("rejects duplicate field in changes", async () => {
      await seedTask();
      await expect(setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "priority", value: "high" },
          { field: "priority", value: "low" },
        ],
      })).rejects.toThrow(/duplicate/);
    });

    it("rejects immutable fields", async () => {
      await seedTask();
      await expect(setFields({
        locttDir, taskId: "abc",
        changes: [{ field: "id", value: "x" }],
      })).rejects.toThrow(TaskUpdateError);
    });

    // @verifies BRD-9
    // @verifies XS-9
    //
    // The board's cross-column drag writes `status` and `board_rank`
    // in ONE change set, so a crash between them cannot leave a card
    // in a column its status contradicts. `board_rank` is auto-managed
    // and refused by default; the board-move path is granted it.
    it("writes status and board_rank together when board_rank is granted", async () => {
      await seedTask();
      const updated = await setFields({
        locttDir,
        taskId: "abc",
        changes: [
          { field: "status", value: "in_progress" },
          { field: "board_rank", value: "v" },
        ],
        allowAutoManaged: new Set(["board_rank"]),
      });

      expect(updated.frontmatter.status).toBe("in_progress");
      // Top-level, not nested under `fields:` — a rank stored there is
      // invisible to every reader and the card renders unranked.
      expect(updated.frontmatter.board_rank).toBe("v");
      expect(updated.frontmatter.fields).not.toHaveProperty("board_rank");

      // Re-read from disk: the response is not the file.
      const onDisk = await readTask(locttDir, "abc");
      expect(onDisk.frontmatter.status).toBe("in_progress");
      expect(onDisk.frontmatter.board_rank).toBe("v");

      // One write, so both entries share the batch's timestamp, and
      // the rank is recorded as a built-in field change rather than a
      // `custom_field_change` naming a `fields:` key that never existed.
      const history = await readHistory(locttDir, "abc");
      const rank = history.find(e => e.field === "board_rank");
      const status = history.find(e => e.field === "status");
      expect(rank?.kind).toBe("field_change");
      expect(rank?.after).toBe("v");
      expect(status?.after).toBe("in_progress");
      expect(rank?.timestamp).toBe(status?.timestamp);
    });

    // @verifies XS-9
    //
    // The grant is per-field and opt-in. Without this, widening it to
    // "any auto-managed field" would let a caller stamp
    // `completed_date` by hand, which the server computes from the
    // workspace timezone.
    it("still refuses an auto-managed field the caller was not granted", async () => {
      await seedTask();
      await expect(setFields({
        locttDir,
        taskId: "abc",
        changes: [
          { field: "status", value: "in_progress" },
          { field: "completed_date", value: "2026-01-02" },
        ],
        allowAutoManaged: new Set(["board_rank"]),
      })).rejects.toThrow(/auto-managed/);
    });

    // @verifies XS-9
    //
    // The default must not change: `loctt set <task> board_rank u` is
    // still refused, which is why the field is auto-managed at all.
    it("refuses board_rank when no grant is passed", async () => {
      await seedTask();
      await expect(setFields({
        locttDir,
        taskId: "abc",
        changes: [{ field: "board_rank", value: "v" }],
      })).rejects.toThrow(/auto-managed/);
    });

    it("rejects empty changes", async () => {
      await seedTask();
      await expect(setFields({ locttDir, taskId: "abc", changes: [] }))
        .rejects.toThrow(/at least one/);
    });

    it("custom fields work in batch", async () => {
      await seedTask();
      const updated = await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "owner_team", value: "platform" },
          { field: "impact", value: "high" },
        ],
      });
      expect(updated.frontmatter.fields).toMatchObject({
        sprint_field: "sprint_1",
        owner_team: "platform",
        impact: "high",
      });
    });
  });

  /**
   * TSK-29, last bullet. Whole-frontmatter validation on write meant a
   * value that was legal when written became a hard error the moment
   * `workflow.yaml` changed under it — freezing every *other* field on
   * the task. Measured on core at `fd8e881`:
   *
   *     loctt set T-1 priority high
   *     -> Error: invalid value: status: unknown status "in_progress";
   *               valid: backlog, done, wont_do
   *
   * The line these draw is between the value being *written* (validate
   * strictly, unchanged) and values already on disk that the write does
   * not touch (preserve; P1 leaves the file the user's until they act,
   * P7 wants drift surfaced rather than turned into a wall).
   */
  describe("orphaned enum values (TSK-29)", () => {
    // `in_progress` is deliberately absent: the seeded task references
    // it, so it stands for a status deleted from workflow.yaml.
    const driftedConfig = {
      key: { prefix: "T-" },
      statuses: [
        { key: "backlog", label: "Backlog", category: "pending" as const },
        { key: "done", label: "Done", category: "completed" as const },
      ],
      priorities: [
        { key: "high", label: "High", value: 2 },
        { key: "low", label: "Low", value: 1 },
      ],
      task_types: [{ key: "bug", label: "Bug" }],
      relationships: [],
      custom_fields: [{
        key: "sprint_field",
        label: "Sprint",
        type: "string" as const,
        multi: false,
        searchable: false,
      }],
    };

    /** Seeded with a status that `driftedConfig` no longer declares. */
    async function seedOrphaned(): Promise<void> {
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: { ...seed.frontmatter, status: "in_progress" },
      });
    }

    it("lets an unrelated field be written while status is orphaned", async () => {
      await seedOrphaned();
      const updated = await setField({
        locttDir, taskId: "abc", field: "priority", value: "high",
        workflowConfig: driftedConfig,
      });
      expect(updated.frontmatter.priority).toBe("high");
    });

    it("does not rewrite the orphaned status as a side effect", async () => {
      await seedOrphaned();
      await setField({
        locttDir, taskId: "abc", field: "priority", value: "high",
        workflowConfig: driftedConfig,
      });
      // Straight off disk: P1 says the file is the truth, and the
      // unknown value stays until the user acts on it.
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.status).toBe("in_progress");
    });

    it("still refuses an invalid new value for the field being written", async () => {
      await seedOrphaned();
      await expect(
        setField({
          locttDir, taskId: "abc", field: "priority", value: "bogus",
          workflowConfig: driftedConfig,
        }),
      ).rejects.toThrow(/unknown priority "bogus"/);
    });

    it("still refuses an invalid new status even though status is already orphaned", async () => {
      // The dangerous direction: the orphan and the bad write are the
      // same field, so a filter keyed on field name alone would let
      // `nonsense` through. It is a *different* error than the
      // pre-existing one, so it is still this write's fault.
      await seedOrphaned();
      await expect(
        setField({
          locttDir, taskId: "abc", field: "status", value: "nonsense",
          workflowConfig: driftedConfig,
        }),
      ).rejects.toThrow(/unknown status "nonsense"/);
    });

    it("lets the user repair the orphaned status by choosing a valid one", async () => {
      await seedOrphaned();
      const updated = await setField({
        locttDir, taskId: "abc", field: "status", value: "done",
        workflowConfig: driftedConfig,
      });
      expect(updated.frontmatter.status).toBe("done");
    });

    it("names the offending field on the error, not the field being written", async () => {
      // The second defect: the envelope carried `field: "priority"` —
      // what the user had just edited — while the message was about
      // status, so a UI keying off it highlighted the wrong input.
      await seedOrphaned();
      const err = await setField({
        locttDir, taskId: "abc", field: "priority", value: "bogus",
        workflowConfig: driftedConfig,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TaskUpdateError);
      expect((err as TaskUpdateError).field).toBe("priority");
    });

    it("attributes a bad custom-field value to that custom field", async () => {
      await seedOrphaned();
      const err = await setField({
        locttDir, taskId: "abc", field: "sprint_field", value: 42,
        workflowConfig: driftedConfig,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TaskUpdateError);
      // `fields.sprint_field`, as the validator reports it — the UI
      // needs the path it can key a row off, not the bare name.
      expect((err as TaskUpdateError).field).toBe("fields.sprint_field");
    });

    it("lets a custom field be repaired while it is itself orphaned", async () => {
      // `errorOwner` must strip the `fields.` prefix: the validator
      // says `fields.sprint_field`, the write says `sprint_field`. If
      // they do not meet, the field cannot be repaired — the same
      // freeze as TSK-29, one level down.
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter,
          status: "backlog",
          // A number where the config now declares `string`.
          fields: { sprint_field: 42 },
        },
      });
      const updated = await setField({
        locttDir, taskId: "abc", field: "sprint_field", value: "sprint_2",
        workflowConfig: driftedConfig,
      });
      expect(updated.frontmatter.fields?.["sprint_field"]).toBe("sprint_2");
    });

    it("refuses a still-invalid write to an already-invalid custom field", () => {
      // The case only correct `fields.` handling can catch. The error
      // is byte-identical before and after, so condition 2 drops it;
      // it is caught solely because `errorOwner("fields.sprint_field")`
      // is `sprint_field`, which the write touched. Without the prefix
      // strip the owner reads `fields`, misses `touched`, and a value
      // the config rejects is written to disk.
      const base = {
        id: "abc", key: "T-1", title: "t",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        status: "backlog",
      };
      const errors = attributableErrors(
        { ...base, fields: { sprint_field: 1 } },
        { ...base, fields: { sprint_field: 2 } },
        new Set(["sprint_field"]),
        driftedConfig,
        undefined,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("fields.sprint_field");
    });

    it("lets an unrelated batch through while status is orphaned", async () => {
      await seedOrphaned();
      const updated = await setFields({
        locttDir, taskId: "abc",
        changes: [
          { field: "priority", value: "low" },
          { field: "task_type", value: "bug" },
        ],
        workflowConfig: driftedConfig,
      });
      expect(updated.frontmatter.priority).toBe("low");
      expect(updated.frontmatter.task_type).toBe("bug");
      expect(updated.frontmatter.status).toBe("in_progress");
    });

    it("refuses the whole batch when one value in it is invalid", async () => {
      await seedOrphaned();
      await expect(
        setFields({
          locttDir, taskId: "abc",
          changes: [
            { field: "priority", value: "low" },
            { field: "task_type", value: "nope" },
          ],
          workflowConfig: driftedConfig,
        }),
      ).rejects.toThrow(/unknown task_type "nope"/);
      // Nothing landed: the refusal is before the write.
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.priority).toBeUndefined();
    });

    it("refuses a setField that leaves the written field invalid the same way", async () => {
      // Single-field analogue of the batch case below. `sprint_field`
      // goes number -> number under a `string` declaration, so the
      // error is byte-identical and condition 2 drops it; the refusal
      // rests entirely on `setField` naming the field it writes.
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter, status: "backlog", fields: { sprint_field: 1 },
        },
      });
      await expect(
        setField({
          locttDir, taskId: "abc", field: "sprint_field", value: 2,
          workflowConfig: driftedConfig,
        }),
      ).rejects.toThrow(/expected string, got number/);
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.fields?.["sprint_field"]).toBe(1);
    });

    it("refuses a batch that leaves a touched field invalid the same way", async () => {
      // The batch analogue of the custom-field case: `sprint_field`
      // goes from one wrong-typed number to another, so the error text
      // is unchanged and condition 2 drops it. It is refused only
      // because the batch's `touched` set names the fields it writes —
      // if that set were empty, this bad value would reach disk.
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter, status: "backlog", fields: { sprint_field: 1 },
        },
      });
      await expect(
        setFields({
          locttDir, taskId: "abc",
          changes: [{ field: "sprint_field", value: 2 }],
          workflowConfig: driftedConfig,
        }),
      ).rejects.toThrow(/expected string, got number/);
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.fields?.["sprint_field"]).toBe(1);
    });

    /**
     * The safety property the write paths cannot stage.
     *
     * `attributableErrors` drops an error only when it is on an
     * untouched field AND was already failing identically. No current
     * write can invalidate a field it does not name — the only
     * side-effect field, `completed_date`, is not validated — so this
     * calls the function directly rather than pretending a route to it
     * exists. Without the "already failing" half, a *newly* invalid
     * untouched field would be silently written to disk.
     */
    it("reports a newly-invalid untouched field rather than dropping it", () => {
      const base = {
        id: "abc", key: "T-1", title: "t",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      // `before` is clean; `after` has an invalid status nobody touched.
      const errors = attributableErrors(
        { ...base, status: "backlog" },
        { ...base, status: "in_progress" },
        new Set(["priority"]),
        driftedConfig,
        undefined,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("status");
    });

    it("drops an untouched field that was already failing identically", () => {
      const base = {
        id: "abc", key: "T-1", title: "t",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        status: "in_progress",
      };
      const errors = attributableErrors(
        base, base, new Set(["priority"]), driftedConfig, undefined,
      );
      expect(errors).toEqual([]);
    });
  });

  /**
   * DEG-4-PROV: a valid write over a corrupt field repairs it AND records
   * the repair honestly — the history entry's `before` is the raw corrupt
   * value (lifted into health, absent from frontmatter) and `meta` marks
   * it as a corruption repair. Before this was built, `before` was null
   * (buildSetFieldHistory read only frontmatter) and the provenance was
   * silently lost.
   *
   * @verifies DEG-4
   */
  describe("repair provenance (DEG-4-PROV)", () => {
    /** Write a task.md with a corrupt `due_date: 42` so readTask lifts it into health. */
    async function seedCorrupt(): Promise<void> {
      await mkdir(getTaskDir(locttDir, "abc"), { recursive: true });
      await writeFile(
        getTaskFilePath(locttDir, "abc"),
        "---\n"
        + "id: abc\nkey: T-1\ntitle: Original\n"
        + "created_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n"
        + "status: not_started\ndue_date: 42\n"
        + "---\nBody.\n",
        "utf-8",
      );
    }

    it("records the raw corrupt value as `before` and stamps meta.was_corrupt", async () => {
      await seedCorrupt();
      // Precondition: the corrupt field is in health, not frontmatter.
      const loaded = await readTask(locttDir, "abc");
      expect((loaded.health ?? []).some(h => h.field === "due_date")).toBe(true);
      expect(loaded.frontmatter.due_date).toBeUndefined();

      await setField({ locttDir, taskId: "abc", field: "due_date", value: "2026-06-01" });

      const history = await readHistory(locttDir, "abc");
      const repair = history.find(e => e.field === "due_date");
      expect(repair).toBeDefined();
      // The honest before is the raw corrupt value (42), not null.
      expect(repair?.before).toBe(42);
      expect(repair?.after).toBe("2026-06-01");
      expect(repair?.meta?.was_corrupt).toBe(true);
    });

    it("a normal (non-repair) write carries no was_corrupt marker", async () => {
      await seedTask(); // healthy task, no health findings
      await setField({ locttDir, taskId: "abc", field: "priority", value: "high" });
      const history = await readHistory(locttDir, "abc");
      const entry = history.find(e => e.field === "priority");
      expect(entry?.meta?.was_corrupt).toBeUndefined();
    });

    it("repairing a corrupt LABELS array records provenance (not silently lost)", async () => {
      // The reviewer-flagged gap: the labels branch returned before the
      // repair-provenance wrapper, so repairing a corrupt labels array lost
      // its was_corrupt marker. A non-array labels value is corrupt and is
      // lifted into health as "labels".
      const { createLabel } = await import("../labels/manage.js");
      await mkdir(getTaskDir(locttDir, "abc"), { recursive: true });
      await writeFile(
        getTaskFilePath(locttDir, "abc"),
        "---\n"
        + "id: abc\nkey: T-1\ntitle: Original\n"
        + "created_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n"
        + "status: not_started\nlabels: notanarray\n"
        + "---\nBody.\n",
        "utf-8",
      );
      const loaded = await readTask(locttDir, "abc");
      expect((loaded.health ?? []).some(h => h.field === "labels")).toBe(true);

      // The label must exist for the write to resolve (entity resolution).
      const label = await createLabel(locttDir, { name: "urgent" });

      await setField({ locttDir, taskId: "abc", field: "labels", value: [label.id] });
      const history = await readHistory(locttDir, "abc");
      // The repair is marked: a labels entry carries the was_corrupt
      // provenance (the field_change carrying the raw corrupt value).
      const marked = history.some(e => e.field === "labels" && e.meta?.was_corrupt === true);
      expect(marked).toBe(true);
    });
  });
});
