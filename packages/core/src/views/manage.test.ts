import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Filter } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadQueriesConfig } from "../config/queries.js";
import { initLoctt } from "../init/init.js";
import { getQueriesConfigPath, resolveLocttDir } from "../paths/index.js";
import {
  archiveView,
  createView,
  deleteView,
  editView,
  findView,
  unarchiveView,
  ViewError,
} from "./manage.js";

let root: string;
let locttDir: string;

const statusNotDone: Filter = { kind: "simple", field: "status", op: "!=", values: ["done"] };
const statusDone: Filter = { kind: "simple", field: "status", op: "=", values: ["done"] };
const priorityHigh: Filter = { kind: "simple", field: "priority", op: "=", values: ["high"] };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-views-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createView", () => {
  it("generates a stable id", async () => {
    const view = await createView(locttDir, {
      name: "open",
      filters: [statusNotDone],
    });
    expect(view.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(view.name).toBe("open");
  });

  it("stores the filter list as authored, in order", async () => {
    // K102: storage and execution are separate. What is stored is the
    // ordered filter list itself — no derived query string, no
    // conditions tree.
    const view = await createView(locttDir, {
      name: "multi",
      filters: [statusNotDone, priorityHigh],
    });
    expect(view.filters).toEqual([statusNotDone, priorityHigh]);
    const cfg = await loadQueriesConfig(locttDir);
    expect(findView(cfg, view.id).filters).toEqual([statusNotDone, priorityHigh]);
  });

  it("accepts an empty filter list (matches everything in scope)", async () => {
    const view = await createView(locttDir, { name: "everything", filters: [] });
    expect(view.filters).toEqual([]);
  });

  it("normalizes an advanced filter's spacing only, leaving a simple filter untouched", async () => {
    // Ken, K102: "you may normalise spacing, dont edit anything else."
    const view = await createView(locttDir, {
      name: "spacing",
      filters: [{ kind: "advanced", query: "status=done" }, statusNotDone],
    });
    expect(view.filters[0]).toEqual({ kind: "advanced", query: "status = done" });
    expect(view.filters[1]).toEqual(statusNotDone);
  });

  it("rejects an advanced filter with unparseable DSL rather than storing it", async () => {
    await expect(
      createView(locttDir, { name: "bad", filters: [{ kind: "advanced", query: "status ==" }] }),
    ).rejects.toThrow(ViewError);
  });

  it("rejects a filter set that fails semantic validation", async () => {
    await expect(
      createView(locttDir, {
        name: "bad-field",
        filters: [{ kind: "simple", field: "not_a_real_field", op: "=", values: ["x"] }],
      }),
    ).rejects.toThrow(ViewError);
  });

  it("stores optional sort, archivedScope, and icon", async () => {
    const view = await createView(locttDir, {
      name: "styled",
      filters: [statusNotDone],
      sort: [{ field: "updated_at", direction: "desc" }],
      archivedScope: "all",
      icon: "star",
    });
    expect(view.sort).toEqual([{ field: "updated_at", direction: "desc" }]);
    expect(view.archivedScope).toBe("all");
    expect(view.icon).toBe("star");
  });
});

describe("findView", () => {
  it("resolves by id", async () => {
    const created = await createView(locttDir, { name: "open", filters: [statusNotDone] });
    const cfg = await loadQueriesConfig(locttDir);
    expect(findView(cfg, created.id).name).toBe("open");
  });

  it("resolves by unique name", async () => {
    await createView(locttDir, { name: "open", filters: [statusNotDone] });
    const cfg = await loadQueriesConfig(locttDir);
    expect(findView(cfg, "open").name).toBe("open");
  });

  it("throws on ambiguous name", async () => {
    const a = await createView(locttDir, { name: "dup", filters: [statusNotDone] });
    await createView(locttDir, { name: "dup", filters: [statusDone] });
    const cfg = await loadQueriesConfig(locttDir);
    expect(() => findView(cfg, "dup")).toThrow(ViewError);
    // ID still resolves cleanly.
    expect(findView(cfg, a.id).name).toBe("dup");
  });
});

describe("editView", () => {
  it("updates name and filters", async () => {
    const created = await createView(locttDir, { name: "open", filters: [statusNotDone] });
    const updated = await editView(locttDir, created.id, {
      name: "still-open",
      filters: [{ kind: "simple", field: "status", op: "=", values: ["in_progress"] }],
    });
    expect(updated.name).toBe("still-open");
    expect(updated.filters).toEqual([{ kind: "simple", field: "status", op: "=", values: ["in_progress"] }]);
  });

  it("leaves filters untouched when omitted", async () => {
    const created = await createView(locttDir, { name: "open", filters: [statusNotDone] });
    const updated = await editView(locttDir, created.id, { name: "renamed" });
    expect(updated.filters).toEqual([statusNotDone]);
  });

  it("replaces the WHOLE filter list rather than patching it", async () => {
    const created = await createView(locttDir, { name: "multi", filters: [statusNotDone, priorityHigh] });
    const updated = await editView(locttDir, created.id, { filters: [statusDone] });
    expect(updated.filters).toEqual([statusDone]);
  });

  it("clears sort with null, leaves it alone when omitted", async () => {
    const created = await createView(locttDir, {
      name: "sorted",
      filters: [statusNotDone],
      sort: [{ field: "updated_at", direction: "desc" }],
    });

    const untouched = await editView(locttDir, created.id, { name: "still-sorted" });
    expect(untouched.sort).toEqual([{ field: "updated_at", direction: "desc" }]);

    const cleared = await editView(locttDir, created.id, { sort: null });
    expect(cleared.sort).toBeUndefined();
  });

  it("clears icon with null, leaves it alone when omitted", async () => {
    const created = await createView(locttDir, {
      name: "iconed",
      filters: [statusNotDone],
      icon: "star",
    });

    const untouched = await editView(locttDir, created.id, { name: "still-iconed" });
    expect(untouched.icon).toBe("star");

    const cleared = await editView(locttDir, created.id, { icon: null });
    expect(cleared.icon).toBeUndefined();
  });

  it("rejects a replacement filter list that fails validation", async () => {
    const created = await createView(locttDir, { name: "open", filters: [statusNotDone] });
    await expect(
      editView(locttDir, created.id, { filters: [{ kind: "advanced", query: "status ==" }] }),
    ).rejects.toThrow(ViewError);
  });
});

describe("archiveView / unarchiveView", () => {
  it("flips archived: true and back", async () => {
    const created = await createView(locttDir, { name: "test-view", filters: [statusNotDone] });
    await archiveView(locttDir, created.id);
    let cfg = await loadQueriesConfig(locttDir);
    let target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBe(true);

    await unarchiveView(locttDir, created.id);
    cfg = await loadQueriesConfig(locttDir);
    target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBeUndefined();
  });

  it("throws on unknown view", async () => {
    await expect(archiveView(locttDir, "nope")).rejects.toThrow(ViewError);
  });
});

describe("deleteView (soft, default)", () => {
  it("sets archived: true and keeps the entry runnable by id", async () => {
    const created = await createView(locttDir, { name: "test-view", filters: [statusNotDone] });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await deleteView(locttDir, created.id);

    const cfg = await loadQueriesConfig(locttDir);
    // Soft-delete: count unchanged; entry is just marked archived.
    expect(cfg.queries).toHaveLength(before);
    const target = cfg.queries.find(q => q.id === created.id);
    expect(target?.archived).toBe(true);
  });
});

describe("deleteView (hard)", () => {
  it("removes the entry from queries.yaml", async () => {
    const created = await createView(locttDir, { name: "test-view", filters: [statusNotDone] });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await deleteView(locttDir, created.id, { hard: true });

    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries).toHaveLength(before - 1);
    expect(cfg.queries.find(q => q.id === created.id)).toBeUndefined();
  });

  it("can delete an already-archived view", async () => {
    const created = await createView(locttDir, { name: "test-view", filters: [statusNotDone] });
    const before = (await loadQueriesConfig(locttDir)).queries.length;

    await archiveView(locttDir, created.id);
    await deleteView(locttDir, created.id, { hard: true });

    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries).toHaveLength(before - 1);
    expect(cfg.queries.find(q => q.id === created.id)).toBeUndefined();
  });
});

/**
 * Regression: a view write must NOT drop a concurrently-present *broken*
 * view (K28 / the VUE-22-area data-loss). Before the fix, every manage.ts
 * writer derived its payload from `config.queries` only and
 * `serializeQueriesConfig` never emitted `broken`, so a UI save silently
 * dropped a hand-broken entry. Each writer now carries `config.broken`
 * through.
 *
 * Under K102 a "broken" entry is one whose `filters` array itself fails
 * validation (an unrecognized filter shape) — there is no more
 * `conditions`/`query` pair to hand-corrupt, so the fixture below seeds a
 * `filters` block with an invalid entry to produce it.
 */
describe("view writes preserve a concurrent broken view (K28)", () => {
  /** Write a queries.yaml holding one valid and one unparseable entry. */
  async function seedWithBroken(): Promise<void> {
    await writeFile(
      getQueriesConfigPath(locttDir),
      "queries:\n"
      + "  - id: 01KEEP000000000000000000AA\n"
      + "    name: keep\n"
      + "    filters:\n"
      + "      - kind: simple\n"
      + "        field: status\n"
      + "        op: \"!=\"\n"
      + "        values: [\"done\"]\n"
      + "  - id: 01BROKEN00000000000000000B\n"
      + "    name: broken-one\n"
      + "    filters:\n"
      + "      - kind: not-a-real-kind\n",
      "utf-8",
    );
  }

  it("createView keeps the broken entry", async () => {
    await seedWithBroken();
    // Precondition: the broken entry is parsed into `broken`, not `queries`.
    const before = await loadQueriesConfig(locttDir);
    expect(before.broken).toHaveLength(1);

    await createView(locttDir, { name: "fresh", filters: [priorityHigh] });

    const after = await loadQueriesConfig(locttDir);
    // The broken entry survived the write (the data-loss this guards).
    expect(after.broken).toHaveLength(1);
    expect(after.broken?.[0]?.name).toBe("broken-one");
    // And the new valid view is there too.
    expect(after.queries.find(q => q.name === "fresh")).toBeDefined();
  });

  it("editView keeps the broken entry", async () => {
    await seedWithBroken();
    const cfg = await loadQueriesConfig(locttDir);
    const keep = cfg.queries.find(q => q.name === "keep");
    if (keep === undefined) throw new Error("seed missing 'keep'");

    await editView(locttDir, keep.id, { name: "renamed" });

    const after = await loadQueriesConfig(locttDir);
    expect(after.broken).toHaveLength(1);
    expect(after.queries.find(q => q.name === "renamed")).toBeDefined();
  });

  // The three writers below also carry `config.broken` (manage.ts), but
  // the coverage above stopped at create/edit. Per the repo rule — code
  // that grew past its tests — each writer gets its own assertion so a
  // future edit that forgets the spread on any one of them goes red.
  it("archiveView keeps the broken entry", async () => {
    await seedWithBroken();
    const cfg = await loadQueriesConfig(locttDir);
    const keep = cfg.queries.find(q => q.name === "keep");
    if (keep === undefined) throw new Error("seed missing 'keep'");

    await archiveView(locttDir, keep.id);

    const after = await loadQueriesConfig(locttDir);
    expect(after.broken).toHaveLength(1);
    expect(after.broken?.[0]?.name).toBe("broken-one");
    expect(after.queries.find(q => q.name === "keep")?.archived).toBe(true);
  });

  it("unarchiveView keeps the broken entry", async () => {
    await seedWithBroken();
    const cfg = await loadQueriesConfig(locttDir);
    const keep = cfg.queries.find(q => q.name === "keep");
    if (keep === undefined) throw new Error("seed missing 'keep'");
    await archiveView(locttDir, keep.id);

    await unarchiveView(locttDir, keep.id);

    const after = await loadQueriesConfig(locttDir);
    expect(after.broken).toHaveLength(1);
    expect(after.broken?.[0]?.name).toBe("broken-one");
    expect(after.queries.find(q => q.name === "keep")?.archived).toBeUndefined();
  });

  it("hard deleteView keeps the broken entry", async () => {
    await seedWithBroken();
    const cfg = await loadQueriesConfig(locttDir);
    const keep = cfg.queries.find(q => q.name === "keep");
    if (keep === undefined) throw new Error("seed missing 'keep'");

    await deleteView(locttDir, keep.id, { hard: true });

    const after = await loadQueriesConfig(locttDir);
    // The valid view is gone, but the broken sibling — which the delete
    // never touched — must not be collateral damage.
    expect(after.queries.find(q => q.name === "keep")).toBeUndefined();
    expect(after.broken).toHaveLength(1);
    expect(after.broken?.[0]?.name).toBe("broken-one");
  });
});
