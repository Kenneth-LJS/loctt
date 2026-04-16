import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { readTask,writeTask } from "./io.js";
import { linkTask, RelationshipError,unlinkTask } from "./relationships.js";

describe("relationships", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-rel-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const seed: Task = {
    frontmatter: {
      id: "abc",
      key: "T-1",
      title: "Task with rels",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "",
  };

  async function seedTask(): Promise<void> {
    await writeTask(locttDir, "abc", seed);
  }

  describe("linkTask", () => {
    it("adds a relationship to a task", async () => {
      await seedTask();
      const updated = await linkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      expect(updated.frontmatter.relationships).toEqual([
        { type: "parent", target: "xyz" },
      ]);
    });

    it("appends to existing relationships", async () => {
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter,
          relationships: [{ type: "parent", target: "xyz" }],
        },
      });
      const updated = await linkTask({ locttDir, taskId: "abc", type: "blocks", target: "def" });
      expect(updated.frontmatter.relationships).toHaveLength(2);
    });

    it("throws on duplicate relationship", async () => {
      await seedTask();
      await linkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      await expect(linkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" }))
        .rejects.toThrow(RelationshipError);
    });

    it("persists to disk", async () => {
      await seedTask();
      await linkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.relationships).toHaveLength(1);
    });
  });

  describe("unlinkTask", () => {
    it("removes a relationship", async () => {
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter,
          relationships: [
            { type: "parent", target: "xyz" },
            { type: "blocks", target: "def" },
          ],
        },
      });
      const updated = await unlinkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      expect(updated.frontmatter.relationships).toEqual([
        { type: "blocks", target: "def" },
      ]);
    });

    it("removes relationships key when last relationship is removed", async () => {
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter,
          relationships: [{ type: "parent", target: "xyz" }],
        },
      });
      const updated = await unlinkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      expect(updated.frontmatter.relationships).toBeUndefined();
    });

    it("throws when relationship does not exist", async () => {
      await seedTask();
      await expect(unlinkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" }))
        .rejects.toThrow(RelationshipError);
    });

    it("persists to disk", async () => {
      await writeTask(locttDir, "abc", {
        ...seed,
        frontmatter: {
          ...seed.frontmatter,
          relationships: [{ type: "parent", target: "xyz" }],
        },
      });
      await unlinkTask({ locttDir, taskId: "abc", type: "parent", target: "xyz" });
      const loaded = await readTask(locttDir, "abc");
      expect(loaded.frontmatter.relationships).toBeUndefined();
    });
  });
});
