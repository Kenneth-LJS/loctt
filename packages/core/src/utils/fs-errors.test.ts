import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileAtomically, writeYamlAtomically } from "./atomic-yaml.js";
import { FsAccessError, rethrowFsError, withFsErrors } from "./fs-errors.js";

/**
 * These map errnos a user can act on into errors that say so. The
 * regression each guards against is the same one: a knowable cause
 * reaching a surface as an unattributable failure, which every
 * front-end then reports as "something went wrong".
 */

function errnoError(code: string, p: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: fake, open '${p}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.path = p;
  return err;
}

describe("rethrowFsError", () => {
  it("names a permission failure and keeps the path the user must fix", () => {
    try {
      rethrowFsError(errnoError("EACCES", "/w/.loctt/state.yaml"), "/fallback");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FsAccessError);
      const fs = err as FsAccessError;
      expect(fs.kind).toBe("permission_denied");
      expect(fs.path).toBe("/w/.loctt/state.yaml");
      expect(fs.message).toContain("permission");
      // The path is the user's own file and the thing they go and fix,
      // so it belongs in the message (the ERR-16 carve-out).
      expect(fs.message).toContain("/w/.loctt/state.yaml");
    }
  });

  it("tells a full disk apart from a permission problem", () => {
    try {
      rethrowFsError(errnoError("ENOSPC", "/w/.loctt/state.yaml"), "/fallback");
      expect.unreachable("should have thrown");
    } catch (err) {
      const fs = err as FsAccessError;
      expect(fs.kind).toBe("disk_full");
      expect(fs.message).toContain("space");
      // The two remedies are different; conflating them sends the user
      // to change permissions on a disk that is simply full.
      expect(fs.message).not.toContain("permission");
    }
  });

  it("falls back to the caller's path when the errno carries none", () => {
    const bare = new Error("EACCES: no path") as NodeJS.ErrnoException;
    bare.code = "EACCES";
    try {
      rethrowFsError(bare, "/w/.loctt/tasks/T-1/task.md");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as FsAccessError).path).toBe("/w/.loctt/tasks/T-1/task.md");
    }
  });

  it("passes an unrecognised error through untouched", () => {
    // Wrapping everything would turn a genuinely unknown fault into a
    // confidently-worded wrong explanation. ERR-30 allows an unknown
    // cause; ERR-31 forbids a misattributed one.
    const other = errnoError("EIO", "/w/x");
    expect(() => rethrowFsError(other, "/f")).toThrow(other);
    expect(() => rethrowFsError(other, "/f")).not.toThrow(FsAccessError);
  });

  it("passes a non-errno error through untouched", () => {
    const plain = new Error("not a filesystem problem");
    expect(() => rethrowFsError(plain, "/f")).toThrow(plain);
  });

  it("keeps the original error as `cause` for a details affordance", () => {
    const original = errnoError("EACCES", "/w/x");
    try {
      rethrowFsError(original, "/f");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as FsAccessError).cause).toBe(original);
      expect((err as FsAccessError).code).toBe("EACCES");
    }
  });
});

describe("withFsErrors", () => {
  it("returns the value when nothing fails", async () => {
    await expect(withFsErrors("/p", () => Promise.resolve(42))).resolves.toBe(42);
  });

  it("maps an errno raised inside the operation", async () => {
    await expect(
      withFsErrors("/p", () => Promise.reject(errnoError("EROFS", "/p"))),
    ).rejects.toBeInstanceOf(FsAccessError);
  });
});

describe("the atomic writers surface actionable filesystem errors", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "loctt-fs-err-"));
  });

  afterEach(async () => {
    // Restore write permission first, or the cleanup itself fails.
    await chmod(dir, 0o755).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("reports an unwritable directory rather than letting a raw EACCES escape", async () => {
    const target = path.join(dir, "state.yaml");
    await chmod(dir, 0o500); // r-x: the directory cannot be written into

    // Skip where the permission bit does not bite — CI running as root,
    // or a filesystem that ignores mode. Asserting nothing would be
    // worse than saying why.
    let enforced = true;
    try {
      await writeFileAtomically(target, "probe");
      enforced = false;
    } catch {
      // expected
    }
    if (!enforced) return;

    await expect(writeFileAtomically(target, "x")).rejects.toBeInstanceOf(FsAccessError);
    await expect(writeYamlAtomically(target, { a: 1 })).rejects.toBeInstanceOf(FsAccessError);
  });

  it("does not dress a serialization bug up as a filesystem problem", async () => {
    // Serialization runs before the write, so its failures must not be
    // reported as filesystem trouble — that sends the user to check
    // permissions on a file where there is nothing to find. A getter
    // that throws is the reliable way to fail inside `stringify`;
    // circular values do not, since YAML emits them as anchors.
    const exploding = {
      get boom(): string {
        throw new Error("serialization exploded");
      },
    };

    const target = path.join(dir, "out.yaml");
    await expect(writeYamlAtomically(target, exploding)).rejects.toThrow(
      /serialization exploded/,
    );
    await expect(writeYamlAtomically(target, exploding)).rejects.not.toBeInstanceOf(
      FsAccessError,
    );
  });
});
