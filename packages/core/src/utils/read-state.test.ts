import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  contentOr,
  isMissingFile,
  readFileState,
  UnreadableFileError,
} from "./read-state.js";

/**
 * The regression these guard: a read failure reported as an absence.
 *
 * Six call sites collapsed "not there" and "could not read" into one
 * default value, so the tracker made factual claims about files nobody
 * had read. Every assertion below fails if the two states merge again.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-read-state-"));
});

afterEach(async () => {
  // Restore permissions first or the cleanup cannot descend.
  await chmod(dir, 0o755).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe("readFileState", () => {
  it("reports a file that is there", async () => {
    const path = join(dir, "present.yaml");
    await writeFile(path, "labels: []\n", "utf-8");

    const result = await readFileState(path);
    expect(result.state).toBe("loaded");
    if (result.state !== "loaded") throw new Error("unreachable");
    expect(result.content).toBe("labels: []\n");
  });

  it("reports a file that is not there as absent, not as unreadable", async () => {
    const result = await readFileState(join(dir, "nope.yaml"));
    expect(result.state).toBe("absent");
  });

  it("reports a file it cannot read as unreadable, not as absent", async () => {
    const path = join(dir, "locked.yaml");
    await writeFile(path, "labels: []\n", "utf-8");
    await chmod(path, 0o000);

    const result = await readFileState(path);
    // The whole point: this must not come back `absent`, or every
    // caller that treats absent as "carry on with nothing" carries on
    // over a file it never read.
    expect(result.state).toBe("unreadable");
    if (result.state !== "unreadable") throw new Error("unreachable");
    expect(result.code).toBe("EACCES");
  });

  it("names the file in the reason, so a surface need not invent one", async () => {
    const path = join(dir, "locked.yaml");
    await writeFile(path, "x: 1\n", "utf-8");
    await chmod(path, 0o000);

    const result = await readFileState(path);
    if (result.state !== "unreadable") throw new Error("expected unreadable");
    expect(result.reason).toContain(path);
    expect(result.reason).toMatch(/permission/i);
  });

  it("reports a directory where a file was expected as unreadable", async () => {
    const path = join(dir, "actually-a-dir");
    await mkdir(path);

    const result = await readFileState(path);
    expect(result.state).toBe("unreadable");
    if (result.state !== "unreadable") throw new Error("unreachable");
    expect(result.code).toBe("EISDIR");
  });

  it("keeps the original error on cause for a details affordance", async () => {
    const path = join(dir, "locked.yaml");
    await writeFile(path, "x: 1\n", "utf-8");
    await chmod(path, 0o000);

    const result = await readFileState(path);
    if (result.state !== "unreadable") throw new Error("expected unreadable");
    expect((result.cause as NodeJS.ErrnoException).code).toBe("EACCES");
  });
});

describe("contentOr", () => {
  it("returns the default for an absent file", async () => {
    const result = await readFileState(join(dir, "nope.yaml"));
    expect(contentOr(result, "labels: []\n")).toBe("labels: []\n");
  });

  it("returns the content for a present file", async () => {
    const path = join(dir, "present.yaml");
    await writeFile(path, "labels: [a]\n", "utf-8");
    const result = await readFileState(path);
    expect(contentOr(result, "labels: []\n")).toBe("labels: [a]\n");
  });

  it("throws rather than returning the default for an unreadable file", async () => {
    const path = join(dir, "locked.yaml");
    await writeFile(path, "labels: [a]\n", "utf-8");
    await chmod(path, 0o000);
    const result = await readFileState(path);

    // Returning the default here is the exact bug: the caller would
    // then write the default back over a file it could not read.
    expect(() => contentOr(result, "labels: []\n")).toThrow(UnreadableFileError);
  });

  it("puts the path and code on the thrown error", async () => {
    const path = join(dir, "locked.yaml");
    await writeFile(path, "x: 1\n", "utf-8");
    await chmod(path, 0o000);
    const result = await readFileState(path);

    try {
      contentOr(result, "");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadableFileError);
      expect((err as UnreadableFileError).path).toBe(path);
      // The raw errno lives on `fileErrno`; `code` is the envelope
      // ErrorCode now that this extends LocttError.
      expect((err as UnreadableFileError).fileErrno).toBe("EACCES");
      expect((err as UnreadableFileError).code).toBe("io_failed");
    }
  });
});

describe("isMissingFile", () => {
  it("is true only for ENOENT", () => {
    expect(isMissingFile({ code: "ENOENT" })).toBe(true);
    expect(isMissingFile({ code: "EACCES" })).toBe(false);
    expect(isMissingFile(new Error("plain"))).toBe(false);
    expect(isMissingFile(undefined)).toBe(false);
  });
});
