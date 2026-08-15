import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { writeTask } from "../task/io.js";
import { rebuildKeyIndex } from "./key-index.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-keyindex-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("rebuildKeyIndex — live keys beat historical ones", () => {
  it("resolves a key held live by one task and historically by another", async () => {
    // Reachable after a two-tracker merge: one task keeps `T-1`, the
    // other is re-prefixed to `T2-1` and keeps `T-1` in key_history.
    // Built in one pass, the historical entry overwrites the live one
    // and `loctt show T-1` answers with the wrong task.
    await writeTask(locttDir, "01ALICE0000000000000000000", {
      frontmatter: {
        id: "01ALICE0000000000000000000",
        key: "T-1",
        title: "Alice",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        status: "backlog",
      },
      body: "",
    });
    await writeTask(locttDir, "01BOB00000000000000000000B", {
      frontmatter: {
        id: "01BOB00000000000000000000B",
        key: "T2-1",
        title: "Bob",
        key_history: ["T-1"],
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        status: "backlog",
      },
      body: "",
    });

    const index = await rebuildKeyIndex(locttDir);

    expect(index.entries["T-1"]).toBe("01ALICE0000000000000000000");
    expect(index.entries["T2-1"]).toBe("01BOB00000000000000000000B");
  });

  it("still resolves a historical key nobody holds live", async () => {
    await writeTask(locttDir, "01BOB00000000000000000000B", {
      frontmatter: {
        id: "01BOB00000000000000000000B",
        key: "WEB-1",
        title: "Renamed",
        key_history: ["T-1"],
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        status: "backlog",
      },
      body: "",
    });

    // The whole point of key_history: an old reference keeps working.
    const index = await rebuildKeyIndex(locttDir);
    expect(index.entries["T-1"]).toBe("01BOB00000000000000000000B");
  });
});
