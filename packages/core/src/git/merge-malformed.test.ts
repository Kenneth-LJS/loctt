import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConflicts } from "./resolve-conflicts.js";
import type { PathPlan } from "./three-way.js";

/**
 * Audit group B: `mergeHistory` / `mergeComments` cast unvalidated YAML
 * straight to their types.
 *
 * The incoming side of a merge comes off a branch another machine
 * published — it is not data this process wrote. A hand-edited or
 * truncated `_history.yaml` parsed to whatever it happened to be (a map,
 * a scalar, `null`) and the `as HistoryEntry[]` cast handed it to
 * `mergeHistory`, which iterates it.
 *
 * The right outcome is `unresolved`: a file we cannot read is a file we
 * cannot merge, and refusing leaves both versions intact.
 */
describe("merging malformed YAML from the branch", () => {
  let dir: string;
  let localDir: string;
  let incomingDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loctt-merge-bad-"));
    localDir = join(dir, "local");
    incomingDir = join(dir, "incoming");
    await mkdir(localDir, { recursive: true });
    await mkdir(incomingDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(base: string, path: string, body: string): Promise<void> {
    const file = join(base, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  }

  function conflict(path: string): PathPlan {
    return { path, disposition: "conflict", reason: "both sides changed" };
  }

  const HISTORY = "tasks/01JBQZ4X8N0000000000000001/_history.yaml";
  const COMMENTS = "tasks/01JBQZ4X8N0000000000000001/_comments.yaml";

  const VALID_HISTORY = `- timestamp: "2026-01-01T00:00:00.000Z"\n  kind: created\n`;

  it("merges two well-formed history files", async () => {
    await write(localDir, HISTORY, VALID_HISTORY);
    await write(
      incomingDir,
      HISTORY,
      `- timestamp: "2026-01-02T00:00:00.000Z"\n  kind: body_edited\n`,
    );

    const result = await resolveConflicts([conflict(HISTORY)], incomingDir, localDir);
    // Guard against the whole suite passing because nothing ever merges.
    expect(result.unresolved).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
  });

  it("refuses a history file that is a map rather than a list", async () => {
    await write(localDir, HISTORY, VALID_HISTORY);
    // What a truncated or hand-edited file plausibly parses to.
    await write(incomingDir, HISTORY, `kind: created\ntimestamp: "2026-01-01"\n`);

    const result = await resolveConflicts([conflict(HISTORY)], incomingDir, localDir);
    expect(result.merged).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toMatch(/not a list of history/);
  });

  it("refuses a history file that is a bare scalar", async () => {
    await write(localDir, HISTORY, VALID_HISTORY);
    await write(incomingDir, HISTORY, `just a string\n`);

    const result = await resolveConflicts([conflict(HISTORY)], incomingDir, localDir);
    expect(result.unresolved).toHaveLength(1);
  });

  it("refuses a malformed comments file", async () => {
    await write(localDir, COMMENTS, `- id: c1\n  body: hello\n`);
    await write(incomingDir, COMMENTS, `id: c1\nbody: not a list\n`);

    const result = await resolveConflicts([conflict(COMMENTS)], incomingDir, localDir);
    expect(result.merged).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toMatch(/not a list of comment/);
  });

  it("treats an empty file as an empty list, not a failure", async () => {
    // A file of only comments parses to null. That is a legitimately
    // empty history, not corruption — refusing it would block merges
    // that have nothing wrong with them.
    await write(localDir, HISTORY, VALID_HISTORY);
    await write(incomingDir, HISTORY, `# nothing here yet\n`);

    const result = await resolveConflicts([conflict(HISTORY)], incomingDir, localDir);
    expect(result.unresolved).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
  });
});
