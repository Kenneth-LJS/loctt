/**
 * K150 / B45: add/remove for labels and multi-value custom fields, and
 * creating values on the fly (labels, open choice fields).
 *
 * @verifies TSK-C14 TSK-C15
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadLabelsConfig } from "../config/labels.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { createCustomField, editCustomField } from "../config/workflow-entities.js";
import { initLoctt } from "../init/init.js";
import { archiveLabel, createLabel } from "../labels/manage.js";
import { resolveLocttDir } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "./create.js";
import { readHistory } from "./history.js";
import { readTask } from "./io.js";
import { editTaskFields, UnknownFieldValueError } from "./list-edit.js";

describe("editTaskFields (K150)", () => {
  let root: string;
  let locttDir: string;
  let task: Task;
  let bug: string;
  let infra: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-list-edit-"));
    await initLoctt(root, { prefix: "T", docs: false, timezone: "UTC" });
    locttDir = resolveLocttDir(root);
    bug = (await createLabel(locttDir, { name: "bug" })).id;
    infra = (await createLabel(locttDir, { name: "infra" })).id;
    await createCustomField(locttDir, {
      key: "platforms", label: "Platforms", type: "enum", multi: true, searchable: false,
      values: [{ key: "ios", label: "iOS" }, { key: "android", label: "Android" }],
    });
    await createCustomField(locttDir, {
      key: "area", label: "Area", type: "enum", multi: false, searchable: false,
      values: [{ key: "ui", label: "UI" }],
    });
    await createCustomField(locttDir, {
      key: "tags", label: "Tags", type: "string", multi: true, searchable: false,
    });
    const workflowConfig = await loadWorkflowConfig(locttDir);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const project = Object.keys(state.keys)[0] as string;
      const created = await createTask({
        locttDir, state, workflowConfig, archivedGuard,
        options: { project, title: "one", labels: [bug] },
      });
      await saveState(locttDir, state);
      return created;
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const id = (): string => task.frontmatter.id;
  const reread = async (): Promise<Task> => readTask(locttDir, id());

  describe("add and remove", () => {
    it("adds a label by name to the current list and records one history entry", async () => {
      const r = await editTaskFields({ locttDir, taskId: id(), lists: { labels: { add: ["infra"] } } });
      expect(r.changed).toBe(true);
      expect((await reread()).frontmatter.labels).toEqual([bug, infra]);
      const history = await readHistory(locttDir, id());
      expect(history.filter(h => h.kind === "label_added" && h.after === infra)).toHaveLength(1);
    });

    it("removes a label given by ID or by name", async () => {
      await editTaskFields({ locttDir, taskId: id(), lists: { labels: { add: [infra] } } });
      await editTaskFields({ locttDir, taskId: id(), lists: { labels: { remove: ["bug"] } } });
      expect((await reread()).frontmatter.labels).toEqual([infra]);
    });

    it("is a no-op, with no write at all, when every add is present and every remove absent", async () => {
      const before = await readFile(join(locttDir, "tasks", id(), "task.md"), "utf-8");
      const historyBefore = await readHistory(locttDir, id());
      const r = await editTaskFields({
        locttDir, taskId: id(), lists: { labels: { add: ["bug"], remove: ["infra"] } },
      });
      expect(r.changed).toBe(false);
      expect(await readFile(join(locttDir, "tasks", id(), "task.md"), "utf-8")).toBe(before);
      expect(await readHistory(locttDir, id())).toEqual(historyBefore);
    });

    it("adds and removes choice values by key or label on a multi field", async () => {
      await editTaskFields({ locttDir, taskId: id(), lists: { platforms: { add: ["iOS", "android"] } } });
      expect((await reread()).frontmatter.fields?.["platforms"]).toEqual(["ios", "android"]);
      await editTaskFields({ locttDir, taskId: id(), lists: { platforms: { remove: ["iOS"] } } });
      expect((await reread()).frontmatter.fields?.["platforms"]).toEqual(["android"]);
    });

    it("adds to a free multi field (strings) by plain equality", async () => {
      await editTaskFields({ locttDir, taskId: id(), lists: { tags: { add: ["a", "b", "a"] } } });
      await editTaskFields({ locttDir, taskId: id(), lists: { tags: { remove: ["a"] } } });
      expect((await reread()).frontmatter.fields?.["tags"]).toEqual(["b"]);
    });

    it("keeps concurrent adds: each applies to the list as it is under the lock", async () => {
      await Promise.all([
        editTaskFields({ locttDir, taskId: id(), lists: { platforms: { add: ["ios"] } } }),
        editTaskFields({ locttDir, taskId: id(), lists: { platforms: { add: ["android"] } } }),
      ]);
      expect([...((await reread()).frontmatter.fields?.["platforms"] as string[])].sort())
        .toEqual(["android", "ios"]);
    });

    it("removes a stored member given literally even when it no longer resolves", async () => {
      // A label ID that names no label (deleted since): removable as stored.
      const ghost = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      await editTaskFields({ locttDir, taskId: id(), set: [{ field: "labels", value: [bug] }] });
      const raw = await readFile(join(locttDir, "tasks", id(), "task.md"), "utf-8");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(locttDir, "tasks", id(), "task.md"), raw.replace(`- ${bug}`, `- ${bug}\n  - ${ghost}`));
      await editTaskFields({ locttDir, taskId: id(), lists: { labels: { remove: [ghost] } } });
      expect((await reread()).frontmatter.labels).toEqual([bug]);
    });

    it("refuses an unknown label name, naming it, and writes nothing", async () => {
      const labelsBefore = await readFile(join(locttDir, "config", "labels.yaml"), "utf-8");
      const err = await editTaskFields({ locttDir, taskId: id(), lists: { labels: { add: ["nope"] } } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnknownFieldValueError);
      expect((err as UnknownFieldValueError).message).toBe("No label named 'nope'.");
      expect((err as UnknownFieldValueError).creatable).toBe(true);
      expect(await readFile(join(locttDir, "config", "labels.yaml"), "utf-8")).toBe(labelsBefore);
      expect((await reread()).frontmatter.labels).toEqual([bug]);
    });

    it("refuses removing a name that matches no label rather than calling it absent", async () => {
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { labels: { remove: ["nope"] } } }))
        .rejects.toThrow("No label named 'nope'.");
    });

    it("refuses an ambiguous label name, listing each with its ID", async () => {
      await createLabel(locttDir, { name: "infra" });
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { labels: { add: ["infra"] } } }))
        .rejects.toThrow(/'infra' matches 2 labels: .* Use the ID\./);
    });

    it("refuses an archived label on add, as the replace form does", async () => {
      await archiveLabel(locttDir, infra);
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { labels: { add: ["infra"] } } }))
        .rejects.toThrow(/archived/i);
    });

    it("refuses add/remove on a field that is not a list", async () => {
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { area: { add: ["ui"] } } }))
        .rejects.toThrow("area holds one value, not a list. Set it instead.");
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { status: { add: ["done"] } } }))
        .rejects.toThrow(/status is not a list field/);
    });

    it("refuses a value both added and removed, and a field both set and edited", async () => {
      await expect(editTaskFields({
        locttDir, taskId: id(), lists: { labels: { add: ["infra"], remove: ["infra"] } },
      })).rejects.toThrow("'infra' is both added to and removed from labels.");
      await expect(editTaskFields({
        locttDir, taskId: id(), set: [{ field: "labels", value: [] }], lists: { labels: { add: ["infra"] } },
      })).rejects.toThrow(/both replaced and edited/);
    });

    it("refuses to add to a list the file holds as something else", async () => {
      const path = join(locttDir, "tasks", id(), "task.md");
      const raw = await readFile(path, "utf-8");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, raw.replace("title: one", "title: one\nfields:\n  tags: not-a-list"));
      await expect(editTaskFields({ locttDir, taskId: id(), lists: { tags: { add: ["x"] } } }))
        .rejects.toThrow(/can't be read as a list/);
    });
  });

  describe("creating on the fly", () => {
    it("creates an unknown label only with createMissing, and attaches it", async () => {
      const r = await editTaskFields({
        locttDir, taskId: id(), lists: { labels: { add: ["urgent"] } }, createMissing: true,
      });
      const labels = await loadLabelsConfig(locttDir);
      const urgent = labels.labels.find(l => l.name === "urgent");
      expect(urgent).toBeDefined();
      expect(r.created).toEqual([{ field: "labels", id: urgent?.id, name: "urgent" }]);
      expect((await reread()).frontmatter.labels).toEqual([bug, urgent?.id]);
    });

    it("never creates an ID-shaped label name", async () => {
      await expect(editTaskFields({
        locttDir, taskId: id(), lists: { labels: { add: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] } }, createMissing: true,
      })).rejects.toThrow("No label with ID '01ARZ3NDEKTSV4RRFFQ69G5FAV'.");
    });

    it("refuses a new value on a closed field even with createMissing, and writes nothing", async () => {
      const wf = await readFile(join(locttDir, "config", "workflow.yaml"), "utf-8");
      await expect(editTaskFields({
        locttDir, taskId: id(), lists: { platforms: { add: ["Windows"] } }, createMissing: true,
      })).rejects.toThrow("platforms does not allow new values. Choose one of: iOS, Android.");
      expect(await readFile(join(locttDir, "config", "workflow.yaml"), "utf-8")).toBe(wf);
    });

    it("refuses an unknown value on an open field without createMissing, marked creatable", async () => {
      await editCustomField(locttDir, "platforms", { allow_new_values: true });
      const err = await editTaskFields({
        locttDir, taskId: id(), lists: { platforms: { add: ["Windows"] } },
      }).catch((e: unknown) => e);
      expect((err as UnknownFieldValueError).message).toBe("No platforms value named 'Windows'.");
      expect((err as UnknownFieldValueError).creatable).toBe(true);
    });

    it("appends a new value to an open field with a key from the label, collision-safe", async () => {
      await editCustomField(locttDir, "platforms", { allow_new_values: true });
      // "i OS!" derives `i_os`; add one that collides with an existing key.
      await editTaskFields({
        locttDir, taskId: id(), lists: { platforms: { add: ["Windows Phone", "IOS"] } }, createMissing: true,
      });
      const def = (await loadWorkflowConfig(locttDir)).custom_fields.find(f => f.key === "platforms");
      expect(def?.values?.map(v => [v.key, v.label])).toEqual([
        ["ios", "iOS"], ["android", "Android"], ["windows_phone", "Windows Phone"], ["ios_2", "IOS"],
      ]);
      expect(def?.allow_new_values).toBe(true);
      expect((await reread()).frontmatter.fields?.["platforms"]).toEqual(["windows_phone", "ios_2"]);
    });

    it("creates a value for a single open field through the replace form", async () => {
      await editCustomField(locttDir, "area", { allow_new_values: true });
      const r = await editTaskFields({
        locttDir, taskId: id(), set: [{ field: "area", value: "Billing" }], createMissing: true,
      });
      expect(r.created).toEqual([{ field: "area", id: "billing", name: "Billing" }]);
      expect((await reread()).frontmatter.fields?.["area"]).toBe("billing");
    });

    it("an existing label, matched by value label, is reused rather than duplicated", async () => {
      await editCustomField(locttDir, "area", { allow_new_values: true });
      await editTaskFields({ locttDir, taskId: id(), set: [{ field: "area", value: "UI" }], createMissing: true });
      const def = (await loadWorkflowConfig(locttDir)).custom_fields.find(f => f.key === "area");
      expect(def?.values).toHaveLength(1);
      expect((await reread()).frontmatter.fields?.["area"]).toBe("ui");
    });

    it("keeps a stored value the config no longer lists when the whole list is resent", async () => {
      await editCustomField(locttDir, "platforms", { allow_new_values: true });
      const path = join(locttDir, "tasks", id(), "task.md");
      const raw = await readFile(path, "utf-8");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, raw.replace("title: one", "title: one\nfields:\n  platforms:\n    - retired"));
      await editTaskFields({
        locttDir, taskId: id(), set: [{ field: "platforms", value: ["retired", "Windows"] }], createMissing: true,
      }).catch(() => undefined);
      const def = (await loadWorkflowConfig(locttDir)).custom_fields.find(f => f.key === "platforms");
      expect(def?.values?.map(v => v.key)).not.toContain("retired");
    });

    it("creates nothing when the rest of the change is refused", async () => {
      await editCustomField(locttDir, "platforms", { allow_new_values: true });
      const labelsBefore = await readFile(join(locttDir, "config", "labels.yaml"), "utf-8");
      const wfBefore = await readFile(join(locttDir, "config", "workflow.yaml"), "utf-8");
      await expect(editTaskFields({
        locttDir,
        taskId: id(),
        set: [{ field: "status", value: "no_such_status" }],
        lists: { labels: { add: ["urgent"] }, platforms: { add: ["Windows"] } },
        createMissing: true,
      })).rejects.toThrow(/no_such_status/);
      expect(await readFile(join(locttDir, "config", "labels.yaml"), "utf-8")).toBe(labelsBefore);
      expect(await readFile(join(locttDir, "config", "workflow.yaml"), "utf-8")).toBe(wfBefore);
    });
  });
});
