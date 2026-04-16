import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "@loctt/contracts";
import { writeTask, readTask } from "./io.js";
import { setField, unsetField, TaskUpdateError } from "./update.js";

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
      const updated = await setField(locttDir, "abc", "priority", "high");
      expect(updated.frontmatter.priority).toBe("high");
      expect(updated.frontmatter.updated_at).not.toBe("2026-01-01T00:00:00Z");
    });

    it("updates status_updated_at when setting status", async () => {
      await seedTask();
      const updated = await setField(locttDir, "abc", "status", "done");
      expect(updated.frontmatter.status).toBe("done");
      expect(updated.frontmatter.status_updated_at).toBeTruthy();
    });

    it("sets title", async () => {
      await seedTask();
      const updated = await setField(locttDir, "abc", "title", "New title");
      expect(updated.frontmatter.title).toBe("New title");
    });

    it("sets a custom field under fields:", async () => {
      await seedTask();
      const updated = await setField(locttDir, "abc", "owner_team", "platform");
      expect(updated.frontmatter.fields).toEqual({
        sprint: "sprint_1",
        owner_team: "platform",
      });
    });

    it("throws on immutable field", async () => {
      await seedTask();
      await expect(setField(locttDir, "abc", "id", "new")).rejects.toThrow(TaskUpdateError);
      await expect(setField(locttDir, "abc", "key", "T-2")).rejects.toThrow(TaskUpdateError);
      await expect(setField(locttDir, "abc", "created_at", "x")).rejects.toThrow(TaskUpdateError);
    });

    it("persists changes to disk", async () => {
      await seedTask();
      await setField(locttDir, "abc", "priority", "low");
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.priority).toBe("low");
    });

    it("preserves body when setting fields", async () => {
      await seedTask();
      const updated = await setField(locttDir, "abc", "priority", "low");
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
