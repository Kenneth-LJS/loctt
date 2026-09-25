import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAttachmentPath, getAttachmentsDir } from "../paths/index.js";
import {
  attachFile,
  AttachmentCaseCollisionError,
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

    // @verifies REL-18
    it("stores an image byte-for-byte — no recompression (K95 keeps REL-18)", async () => {
      // K95 renders images inline via <img> against the raw bytes, so
      // the stored file MUST remain byte-identical to the source: no
      // sharp re-encode, no thumbnail pipeline. Bytes chosen to include
      // a NUL and high bytes so a text round-trip would corrupt them.
      const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]);
      const src = join(sourceDir, "raw.png");
      await writeFile(src, original);

      const result = await attachFile({ locttDir, taskId, sourcePath: src });
      expect(result.size).toBe(original.length);

      const dst = getAttachmentPath(locttDir, taskId, "raw.png");
      const stored = await readFile(dst);
      expect(stored.equals(original)).toBe(true);
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

    // Attachment name case-alias: uploading README.md over readme.md
    // threw on APFS and coexisted on ext4. Refuse the case-only collision
    // deterministically on every filesystem instead.
    it("refuses a name colliding only by case with an existing attachment", async () => {
      const first = await makeSource("readme.md", "lower");
      await attachFile({ locttDir, taskId, sourcePath: first });

      const second = await makeSource("README.md", "UPPER");
      await expect(
        attachFile({ locttDir, taskId, sourcePath: second }),
      ).rejects.toBeInstanceOf(AttachmentCaseCollisionError);
    });

    it("case-only collision is refused even with force: true", async () => {
      const first = await makeSource("readme.md", "lower");
      await attachFile({ locttDir, taskId, sourcePath: first });

      const second = await makeSource("README.md", "UPPER");
      await expect(
        attachFile({ locttDir, taskId, sourcePath: second, force: true }),
      ).rejects.toBeInstanceOf(AttachmentCaseCollisionError);

      // The refusal names the existing casing so the caller can act.
      const err = await attachFile({
        locttDir, taskId, sourcePath: second, force: true,
      }).catch((e: unknown) => e) as AttachmentCaseCollisionError;
      expect(err).toBeInstanceOf(AttachmentCaseCollisionError);
      expect(err.existingName).toBe("readme.md");
      expect(err.requestedName).toBe("README.md");
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

    describe("source confinement (F1, confineToRoot)", () => {
      // The tracker root is `root`; sources under sourceDir (root/sources)
      // are INSIDE it, so an ordinary attach still works. An absolute path
      // elsewhere on disk, a `../` escape, or a symlink whose real target
      // is outside must be refused before any read.

      it("accepts a source inside the tracker root", async () => {
        const src = await makeSource("inside.txt", "ok");
        const result = await attachFile({
          locttDir,
          taskId,
          sourcePath: src,
          confineToRoot: root,
        });
        expect(result.name).toBe("inside.txt");
      });

      it("refuses an absolute source outside the tracker root", async () => {
        // A concrete outside path: a file in a sibling temp dir.
        const outsideDir = await mkdtemp(join(tmpdir(), "loctt-outside-"));
        const outside = join(outsideDir, "secret.txt");
        await writeFile(outside, "sensitive", "utf-8");
        try {
          const err = await attachFile({
            locttDir,
            taskId,
            sourcePath: outside,
            confineToRoot: root,
          }).catch((e: unknown) => e) as Error;
          expect(err).toBeInstanceOf(AttachmentSourceError);
          expect(err.message).toMatch(/outside the tracker/);
          // Actionable: names the tracker root to stage into.
          expect(err.message).toContain(root);
          // Nothing landed.
          const listed = await readdir(getAttachmentsDir(locttDir, taskId)).catch(() => []);
          expect(listed).toEqual([]);
        } finally {
          await rm(outsideDir, { recursive: true, force: true });
        }
      });

      it("refuses a ../ escape even when confineToRoot is set", async () => {
        // sourceDir is root/sources; climbing two levels leaves root.
        const outsideDir = await mkdtemp(join(tmpdir(), "loctt-escape-"));
        const outside = join(outsideDir, "leak.txt");
        await writeFile(outside, "x", "utf-8");
        // A path that lexically escapes: root/sources/../../<basename>.
        const escaping = join(sourceDir, "..", "..", "leak.txt");
        try {
          const err = await attachFile({
            locttDir,
            taskId,
            sourcePath: escaping,
            confineToRoot: root,
          }).catch((e: unknown) => e) as Error;
          expect(err).toBeInstanceOf(AttachmentSourceError);
          expect(err.message).toMatch(/outside the tracker/);
        } finally {
          await rm(outsideDir, { recursive: true, force: true });
        }
      });

      it("refuses a source reached through an intermediate symlink pointing outside", async () => {
        // root/sources/link -> /outside-dir. A file "through" that link is
        // lexically inside root but its real path is outside; the realpath
        // layer must catch it.
        const outsideDir = await mkdtemp(join(tmpdir(), "loctt-symdir-"));
        await writeFile(join(outsideDir, "target.txt"), "leak", "utf-8");
        const link = join(sourceDir, "linkdir");
        await symlink(outsideDir, link);
        const through = join(link, "target.txt");
        try {
          const err = await attachFile({
            locttDir,
            taskId,
            sourcePath: through,
            confineToRoot: root,
          }).catch((e: unknown) => e) as Error;
          expect(err).toBeInstanceOf(AttachmentSourceError);
          expect(err.message).toMatch(/outside the tracker/);
        } finally {
          await rm(outsideDir, { recursive: true, force: true });
        }
      });

      it("still stores an arbitrary absolute path when confineToRoot is NOT set (CLI/human path unchanged)", async () => {
        const outsideDir = await mkdtemp(join(tmpdir(), "loctt-cli-"));
        const outside = join(outsideDir, "downloaded.txt");
        await writeFile(outside, "from downloads", "utf-8");
        try {
          const result = await attachFile({ locttDir, taskId, sourcePath: outside });
          expect(result.name).toBe("downloaded.txt");
        } finally {
          await rm(outsideDir, { recursive: true, force: true });
        }
      });

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

    // Attachment name case-alias: DELETE .../DROP.TXT when drop.txt is on
    // disk. Act on the real dirent and record its real name in history —
    // never a casing that was never written. The attachment is created
    // directly on disk (lower-case) so the test does not depend on the
    // host filesystem's case sensitivity.
    it("detaches by a differently-cased name, acting on and recording the real name", async () => {
      const dir = getAttachmentsDir(locttDir, taskId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "drop.txt"), "bytes", "utf-8");

      await detachFile({ locttDir, taskId, name: "DROP.TXT" });

      // The file really on disk is gone.
      await expect(stat(join(dir, "drop.txt"))).rejects.toThrow();

      // History names what actually existed, not the requested casing.
      const history = await readHistory(locttDir, taskId);
      expect(history.at(-1)).toMatchObject({
        kind: "attachment_removed",
        meta: { name: "drop.txt" },
      });
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
      // C23 (K129 pass): the "Most filesystems cap a single name at 255
      // characters..." mechanism explanation was trimmed as internal
      // detail the user cannot act on differently (messaging.md §1).
      // What remains is the name, its length, and the one action.
      expect(err.message).toMatch(new RegExp(`\\(${String(name.length)} characters\\)`));
      expect(err.message).toMatch(/rename the file/i);
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
