import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { readTask,writeTask } from "./io.js";
import { setField, TaskUpdateError,unsetField } from "./update.js";

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
});
