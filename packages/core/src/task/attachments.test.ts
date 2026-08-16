import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAttachmentPath, getAttachmentsDir } from "../paths/index.js";
import {
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  detachFile,
} from "./attachments.js";
import { readHistory } from "./history.js";

describe("attachments", () => {
  let root: string;
  let locttDir: string;
  let sourceDir: string;
  const taskId = "task-attach-1";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-attach-test-"));
    locttDir = join(root, ".loctt");
    sourceDir = join(root, "sources");
    await mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makeSource(name: string, content = "hello"): Promise<string> {
    const p = join(sourceDir, name);
    await writeFile(p, content, "utf-8");
    return p;
  }

  describe("attachFile", () => {
    it("copies a file into attachments/ and returns metadata", async () => {
      const src = await makeSource("design.pdf", "pdf-bytes");
      const result = await attachFile({ locttDir, taskId, sourcePath: src });

      expect(result.name).toBe("design.pdf");
      expect(result.size).toBe("pdf-bytes".length);
      expect(result.overwritten).toBe(false);

      const dst = getAttachmentPath(locttDir, taskId, "design.pdf");
      const st = await stat(dst);
      expect(st.isFile()).toBe(true);
    });

    it("appends an attachment_added history entry", async () => {
      const src = await makeSource("notes.txt", "abcdef");
      await attachFile({ locttDir, taskId, sourcePath: src });

      const history = await readHistory(locttDir, taskId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        kind: "attachment_added",
        meta: { name: "notes.txt", size: 6 },
      });
    });

    it("throws AttachmentExistsError when the destination already exists and force is not set", async () => {
      const src = await makeSource("dupe.txt", "first");
      await attachFile({ locttDir, taskId, sourcePath: src });
      await writeFile(src, "second", "utf-8");

      await expect(
        attachFile({ locttDir, taskId, sourcePath: src }),
      ).rejects.toBeInstanceOf(AttachmentExistsError);
    });

    it("overwrites and reports overwritten: true when force is set", async () => {
      const src = await makeSource("dupe.txt", "first");
      await attachFile({ locttDir, taskId, sourcePath: src });
      await writeFile(src, "second-longer", "utf-8");

      const result = await attachFile({
        locttDir,
        taskId,
        sourcePath: src,
        force: true,
      });
      expect(result.overwritten).toBe(true);
      expect(result.size).toBe("second-longer".length);

      const history = await readHistory(locttDir, taskId);
      expect(history.filter(e => e.kind === "attachment_added")).toHaveLength(2);
    });

    it("throws when the source is a directory", async () => {
      const dir = join(sourceDir, "a-dir");
      await mkdir(dir, { recursive: true });

      await expect(
        attachFile({ locttDir, taskId, sourcePath: dir }),
      ).rejects.toBeInstanceOf(AttachmentSourceError);
    });

    it("throws when the source does not exist", async () => {
      await expect(
        attachFile({
          locttDir,
          taskId,
          sourcePath: join(sourceDir, "missing.txt"),
        }),
      ).rejects.toBeInstanceOf(AttachmentSourceError);
    });

    it("uses only the basename even if the source path contains traversal", async () => {
      // Create a real target file at sourceDir/passwd. The path with
      // ".." in the middle still resolves to that file via fs APIs and
      // path.basename() gives us "passwd" as the destination basename.
      await makeSource("passwd", "x");
      const traversingPath = join(sourceDir, "sub", "..", "passwd");

      const result = await attachFile({
        locttDir,
        taskId,
        sourcePath: traversingPath,
      });
      expect(result.name).toBe("passwd");

      const dst = getAttachmentPath(locttDir, taskId, "passwd");
      const st = await stat(dst);
      expect(st.isFile()).toBe(true);
    });

    it("rejects symlinks outright", async () => {
      const target = await makeSource("real.txt", "real");
      const link = join(sourceDir, "linky.txt");
      await symlink(target, link);

      await expect(
        attachFile({ locttDir, taskId, sourcePath: link }),
      ).rejects.toBeInstanceOf(AttachmentSourceError);
      await expect(
        attachFile({ locttDir, taskId, sourcePath: link }),
      ).rejects.toThrow(/symlink/);
    });

    it("rejects dotfiles", async () => {
      const src = await makeSource(".env", "secret=1");
      await expect(
        attachFile({ locttDir, taskId, sourcePath: src }),
      ).rejects.toBeInstanceOf(AttachmentSourceError);
    });

    it("rejects sources larger than maxBytes", async () => {
      const src = await makeSource("big.bin", "x".repeat(1024));
      await expect(
        attachFile({ locttDir, taskId, sourcePath: src, maxBytes: 100 }),
      ).rejects.toBeInstanceOf(AttachmentSourceError);
    });

    it("creates attachments/ lazily", async () => {
      const before = getAttachmentsDir(locttDir, taskId);
      await expect(stat(before)).rejects.toThrow();

      const src = await makeSource("a.txt", "a");
      await attachFile({ locttDir, taskId, sourcePath: src });

      const st = await stat(getAttachmentsDir(locttDir, taskId));
      expect(st.isDirectory()).toBe(true);
    });
  });

  describe("detachFile", () => {
    it("removes an existing attachment and appends history", async () => {
      const src = await makeSource("byebye.txt", "x");
      await attachFile({ locttDir, taskId, sourcePath: src });

      await detachFile({ locttDir, taskId, name: "byebye.txt" });

      await expect(
        stat(getAttachmentPath(locttDir, taskId, "byebye.txt")),
      ).rejects.toThrow();

      const history = await readHistory(locttDir, taskId);
      expect(history.at(-1)).toMatchObject({
        kind: "attachment_removed",
        meta: { name: "byebye.txt" },
      });
    });

    it("throws AttachmentNotFoundError if the file is missing", async () => {
      await expect(
        detachFile({ locttDir, taskId, name: "nope.txt" }),
      ).rejects.toBeInstanceOf(AttachmentNotFoundError);
    });

    it("rejects names containing path separators", async () => {
      await expect(
        detachFile({ locttDir, taskId, name: "../task.md" }),
      ).rejects.toThrow();
      await expect(
        detachFile({ locttDir, taskId, name: "foo/bar" }),
      ).rejects.toThrow();
    });

    it("rejects '..' as a name", async () => {
      await expect(
        detachFile({ locttDir, taskId, name: ".." }),
      ).rejects.toThrow();
    });

    it("rejects names containing null bytes", async () => {
      await expect(
        detachFile({ locttDir, taskId, name: "ok\0.txt" }),
      ).rejects.toThrow();
    });
  });

  /**
   * @verifies REL-C5
   *
   * REL-C5 asks for a 300-character basename, which cannot exist: the
   * OS caps a single path component at 255 bytes, so the *source* file
   * could never be created and the CLI path is unreachable. A
   * 255-character name attaches fine.
   *
   * The refusal is still reachable through total path length, which is
   * what these use — a deep `locttDir` plus a legal basename. That is
   * the case's real content: a filesystem refusal must be named rather
   * than surfacing a raw errno, and must leave nothing behind.
   */
  describe("a destination the filesystem refuses", () => {
    let deepRoot: string;
    let deepLoctt: string;

    beforeEach(async () => {
      deepRoot = await mkdtemp(join(tmpdir(), "loctt-deep-"));
      // Nest until the attachments dir is as deep as the OS will take.
      // The target is a directory that creates fine but leaves no room
      // for a long basename inside it — the depth cannot be hardcoded
      // because tmpdir()'s own length varies by platform.
      let dir = deepRoot;
      for (;;) {
        const next = join(dir, "y".repeat(250));
        try {
          await mkdir(getAttachmentsDir(next, taskId), { recursive: true });
          dir = next;
        } catch {
          break;
        }
      }
      deepLoctt = dir;
      // Sanity: we must have nested at least once, or the fixture is
      // just an ordinary directory and proves nothing.
      expect(deepLoctt).not.toBe(deepRoot);
    });

    afterEach(async () => {
      await rm(deepRoot, { recursive: true, force: true });
    });

    it("names the file and the limit instead of leaking ENAMETOOLONG", async () => {
      const name = `${"z".repeat(200)}.txt`;
      const src = join(root, name);
      await writeFile(src, "payload");

      const err = await attachFile({ locttDir: deepLoctt, taskId, sourcePath: src })
        .catch((e: unknown) => e) as Error;

      // Guard the fixture: if the OS accepted the write, this test is
      // asserting nothing and should fail loudly rather than pass.
      expect(err).toBeInstanceOf(Error);
      expect(err.message).not.toMatch(/ENAMETOOLONG/);
      expect(err.message).toContain(name);
      expect(err.message).toMatch(/255/);
    });

    it("leaves no partial file behind", async () => {
      const name = `${"z".repeat(200)}.txt`;
      const src = join(root, name);
      await writeFile(src, "payload");

      await attachFile({ locttDir: deepLoctt, taskId, sourcePath: src }).catch(() => undefined);

      // On this platform the name is rejected before any descriptor is
      // opened, so nothing is created and removing the `rm` in
      // attachFile does not fail this test — it is a guard against a
      // future failure mode (a partially-copied large file, or a
      // filesystem that creates before erroring), not proof of today's.
      // Kept because a truncated file left here would be silently
      // overwritten by the next `attach --force` and read as real.
      const listed = await readdir(getAttachmentsDir(deepLoctt, taskId)).catch(() => []);
      expect(listed).toEqual([]);
    });
  });
});
