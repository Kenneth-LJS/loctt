import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  ViewNameTakenError,
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
    // B21 (K129): core no longer writes a duplicate, so the pair is
    // seeded on disk, the way a pre-K129 tracker or a hand edit has it.
    // This test used to create both through `createView`, which asserted
    // the superseded keep-both behaviour.
    await seedDuplicateNames(locttDir);
    const cfg = await loadQueriesConfig(locttDir);
    expect(() => findView(cfg, "dup")).toThrow(ViewError);
    // ID still resolves cleanly.
    expect(findView(cfg, DUP_A).name).toBe("dup");
  });
});

const DUP_A = "01DUPA0000000000000000000A";
const DUP_B = "01DUPB0000000000000000000B";

/** Two views sharing the name `dup`, as a pre-K129 tracker holds them. */
async function seedDuplicateNames(dir: string): Promise<void> {
  const entry = (id: string): string =>
    `  - id: ${id}\n    name: dup\n    filters:\n      - kind: simple\n        field: status\n        op: "!="\n        values: ["done"]\n`;
  await writeFile(getQueriesConfigPath(dir), `queries:\n${entry(DUP_A)}${entry(DUP_B)}`, "utf-8");
}

describe("B21 · saved-view names are unique (K129)", () => {
  // @verifies VUE-20
  it("createView refuses a name another view has, and writes nothing", async () => {
    await createView(locttDir, { name: "overdue", filters: [statusNotDone] });
    const before = await readFile(getQueriesConfigPath(locttDir), "utf-8");
    await expect(createView(locttDir, { name: "overdue", filters: [statusDone] }))
      .rejects.toThrow("Another view with that name already exists.");
    await expect(createView(locttDir, { name: "overdue", filters: [statusDone] }))
      .rejects.toBeInstanceOf(ViewNameTakenError);
    expect(await readFile(getQueriesConfigPath(locttDir), "utf-8")).toBe(before);
  });

  // @verifies VUE-20
  it("compares trimmed and case-insensitively", async () => {
    await createView(locttDir, { name: "Overdue", filters: [] });
    await expect(createView(locttDir, { name: "  overdue ", filters: [] }))
      .rejects.toBeInstanceOf(ViewNameTakenError);
  });

  it("an archived view still holds its name", async () => {
    const v = await createView(locttDir, { name: "old", filters: [] });
    await archiveView(locttDir, v.id);
    await expect(createView(locttDir, { name: "old", filters: [] }))
      .rejects.toBeInstanceOf(ViewNameTakenError);
  });

  // @verifies VUE-20
  it("editView refuses a rename to another view's name, and writes nothing", async () => {
    await createView(locttDir, { name: "first", filters: [] });
    const second = await createView(locttDir, { name: "second", filters: [] });
    const before = await readFile(getQueriesConfigPath(locttDir), "utf-8");
    await expect(editView(locttDir, second.id, { name: "First" }))
      .rejects.toThrow("Another view with that name already exists.");
    expect(await readFile(getQueriesConfigPath(locttDir), "utf-8")).toBe(before);
  });

  it("editView allows keeping the view's own name, or changing only its case", async () => {
    const v = await createView(locttDir, { name: "mine", filters: [] });
    await createView(locttDir, { name: "other", filters: [] });
    await editView(locttDir, v.id, { name: "mine", filters: [statusDone] });
    const renamed = await editView(locttDir, v.id, { name: "Mine" });
    expect(renamed.name).toBe("Mine");
  });

  // @verifies VUE-20
  it("views already sharing a name load, run by id, and take edits that keep the name", async () => {
    await seedDuplicateNames(locttDir);
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.map(q => q.id)).toEqual([DUP_A, DUP_B]);
    // The web dialog always sends the name; an unchanged one is not a clash.
    const edited = await editView(locttDir, DUP_B, { name: "dup", filters: [statusDone] });
    expect(edited.filters).toEqual([statusDone]);
    // Renaming one away resolves the clash.
    await editView(locttDir, DUP_B, { name: "dup two" });
    expect(findView(await loadQueriesConfig(locttDir), "dup").id).toBe(DUP_A);
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

/**
 * K102-broken-repair · a broken entry is addressable by the two write
 * paths that can legitimately target it, and only behind an explicit
 * opt-in.
 *
 * Before this, `findView` resolved only against `config.queries`, so
 * every write aimed at a broken entry died on `unknown view: <ref>` —
 * on web, CLI and MCP alike. The UI's "Edit… / Replace… / Delete…"
 * controls on broken rows were dead.
 *
 * The outcome asserted throughout is the FILE, not a return value or a
 * disabled button: VUE-42 shipped "BUILT" on tests that only checked
 * Save was disabled before confirming, which is exactly how a write that
 * the server would reject went unnoticed.
 */
describe("K102-broken-repair · repairing and deleting a broken view", () => {
  const BROKEN_ID = "01BROKEN00000000000000000B";

  /** queries.yaml holding one healthy entry and one unreadable one. */
  async function seed(): Promise<void> {
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
      + `  - id: ${BROKEN_ID}\n`
      + "    name: broken-one\n"
      + "    filters: \"not a list\"\n",
      "utf-8",
    );
  }

  const readFileBytes = async (): Promise<string> =>
    readFile(getQueriesConfigPath(locttDir), "utf-8");

  it("editView without replaceBroken is rejected and the file is byte-identical", async () => {
    await seed();
    const before = await readFileBytes();

    await expect(editView(locttDir, BROKEN_ID, { filters: [statusDone] }))
      .rejects.toThrow(ViewError);

    // The outcome that matters: the preserved original text survived.
    expect(await readFileBytes()).toBe(before);
  });

  it("the rejection names the view and says how to proceed, not 'unknown view'", async () => {
    await seed();
    // The whole point of the gate is an ACTIONABLE message. A bare
    // `unknown view: <ulid>` is what shipped, and it told the user
    // nothing they could act on.
    const err = await editView(locttDir, BROKEN_ID, { filters: [statusDone] })
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err?.message).toContain("broken-one");
    expect(err?.message).toContain(BROKEN_ID);
    expect(err?.message).toContain("--force");
    expect(err?.message).toContain("replaceBroken: true");
    expect(err?.message).not.toContain("unknown view");
  });

  it("editView with replaceBroken replaces the entry and KEEPS its id", async () => {
    await seed();

    const repaired = await editView(locttDir, BROKEN_ID, {
      filters: [statusDone],
      replaceBroken: true,
    });

    // Same id: pins and every other by-id reference survive the repair.
    expect(repaired.id).toBe(BROKEN_ID);
    const after = await loadQueriesConfig(locttDir);
    // It moved out of `broken` and into the healthy catalog...
    expect(after.broken).toBeUndefined();
    const now = after.queries.find(q => q.id === BROKEN_ID);
    expect(now?.filters).toEqual([statusDone]);
    // ...and the unreadable text is gone from disk, which is what the
    // opt-in consented to.
    expect(await readFileBytes()).not.toContain("not a list");
    // The healthy sibling is untouched.
    expect(after.queries.find(q => q.name === "keep")).toBeDefined();
  });

  it("a repaired view keeps its old name when the caller supplies none", async () => {
    await seed();
    const repaired = await editView(locttDir, BROKEN_ID, {
      filters: [statusDone],
      replaceBroken: true,
    });
    expect(repaired.name).toBe("broken-one");
  });

  it("a broken entry is addressable by unique name, not only by id", async () => {
    await seed();
    const repaired = await editView(locttDir, "broken-one", {
      name: "fixed",
      filters: [statusDone],
      replaceBroken: true,
    });
    expect(repaired.id).toBe(BROKEN_ID);
    expect(repaired.name).toBe("fixed");
  });

  it("hard deleteView without replaceBroken is rejected and the file is byte-identical", async () => {
    await seed();
    const before = await readFileBytes();

    await expect(deleteView(locttDir, BROKEN_ID, { hard: true }))
      .rejects.toThrow(ViewError);

    expect(await readFileBytes()).toBe(before);
  });

  it("hard deleteView with replaceBroken removes the entry and keeps the healthy one", async () => {
    await seed();

    await deleteView(locttDir, BROKEN_ID, { hard: true, replaceBroken: true });

    const after = await loadQueriesConfig(locttDir);
    expect(after.broken).toBeUndefined();
    expect(after.queries.find(q => q.id === BROKEN_ID)).toBeUndefined();
    expect(await readFileBytes()).not.toContain("not a list");
    expect(after.queries.find(q => q.name === "keep")).toBeDefined();
  });

  it("archiveView on a broken entry is rejected — the flag does not unlock it", async () => {
    await seed();
    const before = await readFileBytes();

    const err = await archiveView(locttDir, BROKEN_ID)
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ViewError);
    expect(err?.message).toContain("cannot be archived");
    expect(err?.message).toContain("broken-one");
    expect(await readFileBytes()).toBe(before);
  });

  it("unarchiveView on a broken entry is rejected", async () => {
    await seed();
    const before = await readFileBytes();

    const err = await unarchiveView(locttDir, BROKEN_ID)
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ViewError);
    expect(err?.message).toContain("cannot be unarchived");
    expect(await readFileBytes()).toBe(before);
  });

  it("a SOFT delete of a broken entry is refused (it is an archive)", async () => {
    await seed();
    const before = await readFileBytes();
    // `deleteView` without `hard` delegates to `archiveView`, so the
    // archive refusal is what the user must get — `replaceBroken` is
    // deliberately not an escape hatch here.
    await expect(deleteView(locttDir, BROKEN_ID, { replaceBroken: true }))
      .rejects.toThrow(/cannot be archived/);
    expect(await readFileBytes()).toBe(before);
  });

  /**
   * Constraint 4 of the ruling, and the most important one: a HEALTHY
   * view's write paths are unchanged. These are the regression guards —
   * if widening resolution ever leaks into the normal path, they go red.
   */
  describe("a healthy view is completely unaffected", () => {
    it("edits without any flag, with a broken sibling present", async () => {
      await seed();
      const cfg = await loadQueriesConfig(locttDir);
      const keep = cfg.queries.find(q => q.name === "keep");
      if (keep === undefined) throw new Error("seed missing 'keep'");

      const updated = await editView(locttDir, keep.id, { filters: [priorityHigh] });

      expect(updated.filters).toEqual([priorityHigh]);
      const after = await loadQueriesConfig(locttDir);
      // The broken sibling is still preserved, untouched.
      expect(after.broken).toHaveLength(1);
      expect(await readFileBytes()).toContain("not a list");
    });

    it("archives, unarchives and hard-deletes without any flag", async () => {
      await seed();
      const cfg = await loadQueriesConfig(locttDir);
      const keep = cfg.queries.find(q => q.name === "keep");
      if (keep === undefined) throw new Error("seed missing 'keep'");

      await archiveView(locttDir, keep.id);
      expect((await loadQueriesConfig(locttDir)).queries.find(q => q.id === keep.id)?.archived)
        .toBe(true);

      await unarchiveView(locttDir, keep.id);
      expect((await loadQueriesConfig(locttDir)).queries.find(q => q.id === keep.id)?.archived)
        .toBeUndefined();

      await deleteView(locttDir, keep.id, { hard: true });
      const after = await loadQueriesConfig(locttDir);
      expect(after.queries.find(q => q.id === keep.id)).toBeUndefined();
      expect(after.broken).toHaveLength(1);
    });

    it("passing replaceBroken at a healthy view changes nothing about the edit", async () => {
      await seed();
      const cfg = await loadQueriesConfig(locttDir);
      const keep = cfg.queries.find(q => q.name === "keep");
      if (keep === undefined) throw new Error("seed missing 'keep'");

      // The gate is on the RESOLVED ENTRY, never on the flag, so a
      // stray flag cannot alter a healthy write.
      const updated = await editView(locttDir, keep.id, {
        filters: [priorityHigh],
        replaceBroken: true,
      });
      expect(updated.id).toBe(keep.id);
      expect(updated.filters).toEqual([priorityHigh]);
      expect((await loadQueriesConfig(locttDir)).broken).toHaveLength(1);
    });
  });
});

/**
 * K103 colour on a saved view, through the write paths.
 *
 * What these catch: the corruption guide's rule 2 — "a writer preserves
 * what it did not touch". `unarchiveView` rebuilds the view field by
 * field rather than spreading it, so a new field omitted there is a
 * field SILENTLY DELETED by unarchiving. That is invisible in every
 * create/edit test, and it is exactly the class of bug K28 is about.
 */
describe("saved view colour — the write paths preserve it", () => {
  it("createView stores all three colour shapes", async () => {
    const hex = await createView(locttDir, { name: "a", filters: [], color: "#1e6fcb" });
    expect(hex.color).toBe("#1e6fcb");
    const pair = await createView(locttDir, {
      name: "b", filters: [], color: { light: "#0F766E", dark: "#39A88F" },
    });
    expect(pair.color).toEqual({ light: "#0F766E", dark: "#39A88F" });
    const pal = await createView(locttDir, {
      name: "c", filters: [], color: { palette: "teal" },
    });
    expect(pal.color).toEqual({ palette: "teal" });

    // And they survive the round-trip to disk and back.
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.id === pal.id)?.color).toEqual({ palette: "teal" });
  });

  it("editView KEEPS a colour it was not asked to change", async () => {
    const created = await createView(locttDir, {
      name: "keeps", filters: [statusNotDone], color: { palette: "blue" },
    });
    // An edit that only renames must not drop the colour — this is what
    // stops a web edit (whose dialog omits what it does not offer) from
    // silently wiping a colour set through the CLI or MCP.
    await editView(locttDir, created.id, { name: "renamed" });
    const cfg = await loadQueriesConfig(locttDir);
    const found = cfg.queries.find(q => q.id === created.id);
    expect(found?.name).toBe("renamed");
    expect(found?.color).toEqual({ palette: "blue" });
  });

  it("editView clears the colour on an explicit null", async () => {
    const created = await createView(locttDir, {
      name: "clears", filters: [], color: "#1e6fcb",
    });
    await editView(locttDir, created.id, { color: null });
    const cfg = await loadQueriesConfig(locttDir);
    expect(cfg.queries.find(q => q.id === created.id)?.color).toBeUndefined();
  });

  it("unarchiveView does NOT drop the colour", async () => {
    const created = await createView(locttDir, {
      name: "round-trip", filters: [statusNotDone], color: { palette: "teal" },
    });
    await archiveView(locttDir, created.id);
    await unarchiveView(locttDir, created.id);
    const cfg = await loadQueriesConfig(locttDir);
    const found = cfg.queries.find(q => q.id === created.id);
    expect(found?.archived).toBeUndefined();
    // The field-by-field rebuild inside `unarchiveView` must carry this
    // forward, or archiving-then-unarchiving is a silent data loss.
    expect(found?.color).toEqual({ palette: "teal" });
  });
});
