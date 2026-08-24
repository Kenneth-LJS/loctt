import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UnreadableFileError } from "../utils/read-state.js";
import { loadCalendarConfig } from "./calendar.js";
import { loadLabelsConfig } from "./labels.js";
import { loadListViewConfig } from "./list-view.js";
import { loadMilestonesConfig } from "./milestones.js";
import { loadSprintsConfig } from "./sprints.js";

/**
 * V9: config is not a log, so P-11 lands differently here.
 *
 * A comment or a history entry records something that happened, and
 * dropping one destroys a fact — so a malformed entry is kept and
 * merged. A config value is a *definition* other data references. A
 * malformed status kept in place means tasks pointing at a status that
 * cannot render, and the damage spreads to every task that used it.
 *
 * So config refuses and reports. The file is still never written over,
 * which is the half of P-11 that matters most: whatever the user wrote
 * is still on disk to repair.
 *
 * These loaders previously did `fileExists` then `readFile` — two
 * syscalls where the second can still fail, surfacing as a bare errno
 * with no indication of which file.
 */

let dir: string;

const LOADERS = [
  { name: "labels.yaml", file: "labels.yaml", load: loadLabelsConfig, empty: { labels: [] } },
  { name: "milestones.yaml", file: "milestones.yaml", load: loadMilestonesConfig, empty: { milestones: [] } },
  { name: "sprints.yaml", file: "sprints.yaml", load: loadSprintsConfig, empty: { sprints: [] } },
  { name: "list-view.yaml", file: "list-view.yaml", load: loadListViewConfig, empty: {} },
] as const;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "loctt-config-v9-"));
  await mkdir(join(dir, "config"), { recursive: true });
});

afterEach(async () => {
  for (const l of LOADERS) {
    await chmod(join(dir, "config", l.file), 0o644).catch(() => {});
  }
  await chmod(join(dir, "config", "calendar.yaml"), 0o644).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

describe.each(LOADERS)("$name", ({ file, load, empty }) => {
  it("returns the empty default when the file is absent", async () => {
    // Absent is a real state — a fresh tracker has not written it yet —
    // and must stay distinguishable from a failure.
    expect(await load(dir)).toEqual(empty);
  });

  it("refuses rather than returning the default when it cannot be read", async () => {
    await writeFile(join(dir, "config", file), "{}\n", "utf-8");
    await chmod(join(dir, "config", file), 0o000);

    await expect(load(dir)).rejects.toThrow(UnreadableFileError);
  });

  it("names the file, so the user knows what to repair", async () => {
    await writeFile(join(dir, "config", file), "{}\n", "utf-8");
    await chmod(join(dir, "config", file), 0o000);

    await expect(load(dir)).rejects.toThrow(new RegExp(file.replace(".", "\\.")));
  });

  it("leaves the file on disk untouched", async () => {
    const path = join(dir, "config", file);
    await writeFile(path, "the user's own content\n", "utf-8");
    await chmod(path, 0o000);

    await load(dir).catch(() => undefined);

    await chmod(path, 0o644);
    // The half of P-11 that still applies: refusing must not destroy.
    expect(await readFile(path, "utf-8")).toBe("the user's own content\n");
  });
});

describe("calendar.yaml", () => {
  it("falls back to UTC when absent", async () => {
    expect((await loadCalendarConfig(dir)).timezone).toBe("UTC");
  });

  it("refuses rather than falling back when it cannot be read", async () => {
    const path = join(dir, "config", "calendar.yaml");
    await writeFile(path, "timezone: Asia/Singapore\n", "utf-8");
    await chmod(path, 0o000);

    // Falling back to UTC here would silently stamp every completed_date
    // in the wrong zone, from a file that says otherwise.
    await expect(loadCalendarConfig(dir)).rejects.toThrow(UnreadableFileError);
  });
});
