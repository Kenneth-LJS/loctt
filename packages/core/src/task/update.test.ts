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
      fields: { sprint: "sprint_1" },
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
        sprint: "sprint_1",
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
      const updated = await unsetField(locttDir, "abc", "sprint");
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
});
