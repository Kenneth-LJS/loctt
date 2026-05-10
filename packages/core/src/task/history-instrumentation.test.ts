import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocttState, Task } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { writeTask, writeTaskBody } from "./io.js";
import { archiveTask, unarchiveTask } from "./lifecycle.js";
import { linkTask, unlinkTask } from "./relationships.js";
import { setField, unsetField } from "./update.js";

describe("history instrumentation", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-hist-instr-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const seed: Task = {
    frontmatter: {
      id: "abc",
      key: "T-1",
      title: "Test task",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      status: "not_started",
      labels: ["bug"],
      fields: { sprint_field: "sprint_1" },
    },
    body: "Body.\n",
  };

  async function seedTask(): Promise<void> {
    await writeTask(locttDir, "abc", seed);
  }

  describe("setField", () => {
    it("records field_change for built-in field", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "status", value: "in_progress" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "field_change",
          field: "status",
          before: "not_started",
          after: "in_progress",
        }),
      ]);
    });

    it("skips history for no-op change", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "status", value: "not_started" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(0);
    });

    it("records custom_field_change for custom field", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "sprint_field", value: "sprint_2" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "custom_field_change",
          field: "sprint_field",
          before: "sprint_1",
          after: "sprint_2",
        }),
      ]);
    });

    it("records label_added and label_removed for label changes", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "labels", value: ["feature", "bug"] });

      const history = await readHistory(locttDir, "abc");
      // "feature" was added, "bug" was already there — only "feature" should be recorded
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "label_added", after: "feature" }),
      ]);
    });

    it("records label_removed when removing a label", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "labels", value: [] });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "label_removed", before: "bug" }),
      ]);
    });

    it("records field_change with null before for new field", async () => {
      await seedTask();
      await setField({ locttDir, taskId: "abc", field: "priority", value: "high" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "field_change",
          field: "priority",
          before: null,
          after: "high",
        }),
      ]);
    });
  });

  describe("unsetField", () => {
    it("records field_change with null after for unset built-in field", async () => {
      await seedTask();
      await unsetField(locttDir, "abc", "status");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "field_change",
          field: "status",
          before: "not_started",
          after: null,
        }),
      ]);
    });

    it("records custom_field_change with null after for unset custom field", async () => {
      await seedTask();
      await unsetField(locttDir, "abc", "sprint_field");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "custom_field_change",
          field: "sprint_field",
          before: "sprint_1",
          after: null,
        }),
      ]);
    });

    it("records label_removed for each label when unsetting labels", async () => {
      await seedTask();
      await unsetField(locttDir, "abc", "labels");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "label_removed", before: "bug" }),
      ]);
    });
  });

  describe("archiveTask / unarchiveTask", () => {
    it("records archived entry", async () => {
      await seedTask();
      await archiveTask(locttDir, "abc");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "archived" }),
      ]);
    });

    it("records unarchived entry", async () => {
      await seedTask();
      await archiveTask(locttDir, "abc");
      await unarchiveTask(locttDir, "abc");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(2);
      expect(history).toEqual([
        expect.objectContaining({ kind: "archived" }),
        expect.objectContaining({ kind: "unarchived" }),
      ]);
    });
  });

  describe("linkTask / unlinkTask", () => {
    it("records link_added entry", async () => {
      await seedTask();
      // Write a target task
      await writeTask(locttDir, "def", {
        frontmatter: { ...seed.frontmatter, id: "def", key: "T-2" },
        body: "",
      });

      await linkTask({ locttDir, taskId: "abc", type: "blocks", target: "def" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "link_added",
          meta: { type: "blocks", target: "def" },
        }),
      ]);
    });

    it("records link_removed entry", async () => {
      await seedTask();
      const taskWithLink: Task = {
        frontmatter: {
          ...seed.frontmatter,
          relationships: [{ type: "blocks", target: "def" }],
        },
        body: seed.body,
      };
      await writeTask(locttDir, "abc", taskWithLink);

      await unlinkTask({ locttDir, taskId: "abc", type: "blocks", target: "def" });

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({
          kind: "link_removed",
          meta: { type: "blocks", target: "def" },
        }),
      ]);
    });
  });

  describe("writeTaskBody", () => {
    it("records body_edited entry", async () => {
      await seedTask();
      await writeTaskBody(locttDir, "abc", "Updated body.\n");

      const history = await readHistory(locttDir, "abc");
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "body_edited" }),
      ]);
      // Verify no content is captured
      expect(history[0]).not.toHaveProperty("before");
      expect(history[0]).not.toHaveProperty("after");
    });
  });

  describe("createTask", () => {
    it("records created entry", async () => {
      const state: LocttState = {
        keys: { task: { prefix: "T-", next_number: 1 } },
      };

      const task = await createTask({
        locttDir,
        state,
        options: { project: "task", title: "New task" },
      });

      const history = await readHistory(locttDir, task.frontmatter.id);
      expect(history).toHaveLength(1);
      expect(history).toEqual([
        expect.objectContaining({ kind: "created" }),
      ]);
    });
  });
});
