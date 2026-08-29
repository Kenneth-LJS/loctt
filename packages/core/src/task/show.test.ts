import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { getAttachmentsDir, getTaskDir } from "../paths/index.js";
import { writeTask } from "./io.js";
import { buildShowModel,discoverAttachments } from "./show.js";

describe("task show model", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-show-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  const task: Task = {
    frontmatter: {
      id: "abc123",
      key: "T-1",
      title: "Show test",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    body: "Description here.\n",
  };

  it("discovers no attachments when only task.md exists", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("discovers attachment files in the attachments/ subdirectory", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "screenshot.png"), "fake-image-data");
    await writeFile(join(attachmentsDir, "notes.txt"), "some notes");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toHaveLength(2);
    const names = attachments.map(a => a.name).sort();
    expect(names).toEqual(["notes.txt", "screenshot.png"]);
    expect(attachments.every(a => a.size > 0)).toBe(true);
  });

  it("derives mime types from known extensions", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "shot.png"), "x");
    await writeFile(join(attachmentsDir, "clip.mp4"), "x");
    await writeFile(join(attachmentsDir, "doc.pdf"), "x");

    const attachments = await discoverAttachments(locttDir, "abc123");
    const byName = Object.fromEntries(attachments.map(a => [a.name, a.mime]));
    expect(byName["shot.png"]).toBe("image/png");
    expect(byName["clip.mp4"]).toBe("video/mp4");
    expect(byName["doc.pdf"]).toBe("application/pdf");
  });

  it("omits the mime field when the extension is unknown", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "blob.xyz"), "x");
    await writeFile(join(attachmentsDir, "README"), "x");

    const attachments = await discoverAttachments(locttDir, "abc123");
    const blob = attachments.find(a => a.name === "blob.xyz");
    const readme = attachments.find(a => a.name === "README");
    expect(blob?.mime).toBeUndefined();
    expect(readme?.mime).toBeUndefined();
    // Field is genuinely absent (not just undefined-on-property) so
    // JSON.stringify omits it on the wire.
    expect("mime" in (blob ?? {})).toBe(false);
    expect("mime" in (readme ?? {})).toBe(false);
  });

  it("returns empty array for nonexistent task directory", async () => {
    const attachments = await discoverAttachments(locttDir, "nonexistent");
    expect(attachments).toEqual([]);
  });

  it("returns empty array when the task has no attachments/ directory", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("does not list system files at the task root as attachments", async () => {
    await writeTask(locttDir, "abc123", task);
    const taskDir = getTaskDir(locttDir, "abc123");
    await writeFile(join(taskDir, "_history.yaml"), "[]");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments).toEqual([]);
  });

  it("skips dotfiles and nested subdirectories inside attachments/", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(join(attachmentsDir, "nested"), { recursive: true });
    await writeFile(join(attachmentsDir, ".hidden"), "x");
    await writeFile(join(attachmentsDir, "real.txt"), "y");
    await writeFile(join(attachmentsDir, "nested", "inner.txt"), "z");

    const attachments = await discoverAttachments(locttDir, "abc123");
    expect(attachments.map(a => a.name)).toEqual(["real.txt"]);
  });

  it("builds a complete show model", async () => {
    await writeTask(locttDir, "abc123", task);
    const attachmentsDir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, "doc.pdf"), "pdf-data");

    const model = await buildShowModel(locttDir, task);
    expect(model.task).toBe(task);
    expect(model.attachments).toHaveLength(1);
    expect(model.attachments[0]?.name).toBe("doc.pdf");
    expect(model.relationships).toEqual([]);
  });

  it("resolves relationship target IDs to current keys", async () => {
    const targetTask: Task = {
      frontmatter: {
        id: "target-id",
        key: "T-2",
        title: "Target",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    const sourceTask: Task = {
      frontmatter: {
        ...task.frontmatter,
        relationships: [{ type: "blocks", target: "target-id" }],
      },
      body: task.body,
    };
    await writeTask(locttDir, "abc123", sourceTask);
    await writeTask(locttDir, "target-id", targetTask);

    const model = await buildShowModel(locttDir, sourceTask);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toEqual({
      type: "blocks",
      target: "target-id",
      resolvedKey: "T-2",
      // Title and status come along so a relationships panel can show
      // what a linked task is without a request per edge. Resolved per
      // call rather than stored on the edge, which would go stale.
      resolvedTitle: "Target",
      missing: false,
    });
  });

  it("marks relationship targets as missing when the task is gone", async () => {
    const sourceTask: Task = {
      frontmatter: {
        ...task.frontmatter,
        relationships: [{ type: "blocks", target: "vanished-id" }],
      },
      body: task.body,
    };
    await writeTask(locttDir, "abc123", sourceTask);

    const model = await buildShowModel(locttDir, sourceTask);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toEqual({
      type: "blocks",
      target: "vanished-id",
      missing: true,
    });
  });

  /**
   * @verifies REL-49
   *
   * **"There is no attachments directory" and "I could not read it"
   * are different answers.** A bare `catch { return [] }` made them
   * the same, so an unreadable directory rendered as
   * "No attachments on this task yet" over a directory holding a
   * file — ERR-1's prohibition, and REL-49's first bullet inverted.
   *
   * Found by the M2 gate and confirmed on the CLI: `loctt show`
   * dropped the section silently too, so the fix is core rather than
   * the web client.
   */
  it("reports an unreadable attachments directory rather than an empty one", async () => {
    const dir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "present.txt"), "x", "utf-8");

    // Sanity: readable, so the failure below cannot be "there was
    // never a file". Paired deliberately.
    expect((await discoverAttachments(locttDir, "abc123")).map(a => a.name))
      .toEqual(["present.txt"]);

    await chmod(dir, 0o000);
    try {
      await expect(discoverAttachments(locttDir, "abc123")).rejects.toThrow(/EACCES|permission/i);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  /**
   * @verifies REL-49
   *
   * The guard the fix must not lose: a task with no attachments has
   * no directory at all, which is the common path and is *not* a
   * failure. Without this, "throw on everything" would satisfy the
   * test above.
   */
  it("still returns [] when the directory does not exist", async () => {
    expect(await discoverAttachments(locttDir, "no-such-task")).toEqual([]);
  });


  /**
   * @verifies REL-25
   *
   * **A corrupt task must not take its neighbours down with it.**
   *
   * Relationship resolution tolerated `TaskNotFoundError` and rethrew
   * everything else, so one unparseable `task.md` made *every* task
   * linking to it answer 500 — naming the corrupt task's ULID, which
   * the user can neither read nor act on, about a task they did not
   * ask for. Found by the M2 gate (F3).
   *
   * From this task's point of view, "the target is gone" and "the
   * target will not parse" are the same broken edge. The corrupt
   * task's own page still reports the parse error with its path and
   * position — that is where the user can act on it.
   */
  it("marks a link to an unparseable task as missing rather than failing the page", async () => {
    const base: Task = {
      frontmatter: {
        id: "abc123", key: "T-1", title: "Source",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    const source: Task = {
      frontmatter: {
        ...base.frontmatter,
        relationships: [{ type: "blocks", target: "broken-id" }],
      },
      body: "",
    };
    await writeTask(locttDir, "abc123", source);

    // A target on disk whose frontmatter will not parse.
    await mkdir(getTaskDir(locttDir, "broken-id"), { recursive: true });
    await writeFile(
      join(getTaskDir(locttDir, "broken-id"), "task.md"),
      '---\nid: broken-id\nkey: T-9\nstatus: "backlog\n---\n',
      "utf-8",
    );

    const model = await buildShowModel(locttDir, source);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]?.missing).toBe(true);
  });

  /**
   * @verifies REL-25
   *
   * The guard the fix must not lose: a healthy target still resolves.
   * Without this, marking every edge missing would satisfy the test
   * above.
   */
  it("still resolves a healthy link target", async () => {
    const target: Task = {
      frontmatter: {
        id: "live-id", key: "T-2", title: "Live",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    const source: Task = {
      frontmatter: {
        id: "abc123", key: "T-1", title: "Source",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        relationships: [{ type: "blocks", target: "live-id" }],
      },
      body: "",
    };
    await writeTask(locttDir, "abc123", source);
    await writeTask(locttDir, "live-id", target);

    const model = await buildShowModel(locttDir, source);
    expect(model.relationships[0]?.missing).toBe(false);
    expect(model.relationships[0]?.resolvedKey).toBe("T-2");
  });

  /**
   * @verifies REL-49
   *
   * **The gate's F5, and the test whose absence caused it.**
   *
   * REL-49 was marked covered by two tags asserting only that
   * `discoverAttachments` *throws* on an unreadable directory.
   * Nothing asserted that a **caller survives** it — so when the
   * throw was introduced (correctly, replacing a silent `[]`),
   * `buildShowModel`'s `Promise.all` let it reject the whole model
   * and the entire task read began failing on all three surfaces.
   * The UI suite was 332/332 green while the app violated the case.
   *
   * "The section degrades" is the assertion. "The reader throws" is
   * not, and was never enough.
   */
  it("degrades only the attachments section when the directory is unreadable", async () => {
    const task: Task = {
      frontmatter: {
        id: "abc123", key: "T-1", title: "Survivor",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      body: "still here",
    };
    await writeTask(locttDir, "abc123", task);
    const dir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "present.txt"), "x", "utf-8");
    await chmod(dir, 0o000);

    try {
      const model = await buildShowModel(locttDir, task);
      // The task itself survives — the point of the case.
      expect(model.task.body).toBe("still here");
      expect(model.relationships).toEqual([]);
      // The section says why, rather than claiming emptiness.
      expect(model.attachments).toEqual([]);
      expect(model.attachmentsError).toMatch(/EACCES|permission/i);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  /**
   * @verifies REL-49
   *
   * The paired positive: a readable directory carries no error, so
   * the guard above cannot pass by reporting a failure every time.
   */
  it("carries no attachmentsError when the directory reads fine", async () => {
    const task: Task = {
      frontmatter: {
        id: "abc123", key: "T-1", title: "Fine",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    };
    await writeTask(locttDir, "abc123", task);
    const dir = getAttachmentsDir(locttDir, "abc123");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "ok.txt"), "x", "utf-8");

    const model = await buildShowModel(locttDir, task);
    expect(model.attachmentsError).toBeUndefined();
    expect(model.attachments.map(a => a.name)).toEqual(["ok.txt"]);
  });
});
