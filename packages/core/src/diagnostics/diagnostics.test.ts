import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Counts real `node:fs/promises` `access` calls without changing their
 * behaviour — used only by the streaming-order tests below. Native ESM
 * exports are non-configurable, so `vi.spyOn` on the module namespace
 * throws ("Cannot redefine property"); `vi.mock` with `importOriginal`
 * is vitest's supported way to wrap a real implementation instead of
 * replacing it, which is what a pure counter needs (the original
 * function's behaviour, including real filesystem timing, must be
 * unchanged — only observed).
 */
let accessCallCount = 0;
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: (...args: Parameters<typeof actual.access>) => {
      accessCallCount++;
      return actual.access(...args);
    },
  };
});

import { initLoctt } from "../init/init.js";
import { getSchemaVersionPath } from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION, writeSchemaVersion } from "../schema/index.js";
import { saveReconcileState } from "../state/reconcile.js";
import { runDoctor, runDoctorStream } from "./doctor.js";
import { getTrackerInfo } from "./info.js";

describe("getTrackerInfo", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-info-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports non-existent tracker", async () => {
    const info = await getTrackerInfo(root);
    expect(info.exists).toBe(false);
    expect(info.taskCount).toBe(0);
    expect(info.schemaStatus.kind).toBe("missing");
  });

  it("reports initialized tracker info", async () => {
    await initLoctt(root);
    const info = await getTrackerInfo(root);
    expect(info.exists).toBe(true);
    expect(info.workflowConfig).not.toBeNull();
    expect(info.workflowConfig?.key.prefix).toBe("T");
    expect(info.queriesConfig).not.toBeNull();
    expect(info.state).not.toBeNull();
    expect(info.taskCount).toBe(0);
  });

  it("reports schema status: current on a fresh init", async () => {
    await initLoctt(root);
    const info = await getTrackerInfo(root);
    expect(info.schemaStatus.kind).toBe("current");
    if (info.schemaStatus.kind === "current") {
      expect(info.schemaStatus.version).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it("reports schema status: outdated when on-disk < current", async () => {
    await initLoctt(root);
    // Force an older on-disk version (only meaningful when CURRENT > 1).
    if (CURRENT_SCHEMA_VERSION > 1) {
      const locttDir = `${root}/.loctt`;
      await writeSchemaVersion(locttDir, CURRENT_SCHEMA_VERSION - 1);
      const info = await getTrackerInfo(root);
      expect(info.schemaStatus.kind).toBe("outdated");
      if (info.schemaStatus.kind === "outdated") {
        expect(info.schemaStatus.on_disk).toBe(CURRENT_SCHEMA_VERSION - 1);
        expect(info.schemaStatus.current).toBe(CURRENT_SCHEMA_VERSION);
      }
    }
  });

  it("reports schema status: future when on-disk > current", async () => {
    await initLoctt(root);
    const locttDir = `${root}/.loctt`;
    await writeSchemaVersion(locttDir, CURRENT_SCHEMA_VERSION + 1);
    const info = await getTrackerInfo(root);
    expect(info.schemaStatus.kind).toBe("future");
    if (info.schemaStatus.kind === "future") {
      expect(info.schemaStatus.on_disk).toBe(CURRENT_SCHEMA_VERSION + 1);
    }
  });
});

describe("runDoctor", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-doctor-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports error for missing .loctt directory", async () => {
    const checks = await runDoctor(root);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("error");
    expect(checks[0]?.message).toContain("not found");
  });

  it("reports all ok for fresh init", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    const errors = checks.filter(c => c.status === "error");
    expect(errors).toHaveLength(0);
    const okChecks = checks.filter(c => c.status === "ok");
    expect(okChecks.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * @verifies GIT-C3
   *
   * Sync refuses to run while an interrupted reconciliation is on disk,
   * so doctor has to be the surface that explains why — otherwise the
   * user meets a refusal with no way to see what is outstanding.
   */
  it("reports an interrupted reconciliation as an error", async () => {
    await initLoctt(root);
    const locttDir = join(root, ".loctt");
    await saveReconcileState(locttDir, {
      mode: "sync",
      base_commit: "a".repeat(40),
      remote_commit: "b".repeat(40),
      started_at: "2026-01-01T00:00:00.000Z",
    });

    const checks = await runDoctor(root);
    const check = checks.find(c => c.name === "reconciliation");
    // An error, not a warn: unlike a prefix rename, nothing finishes
    // this automatically and sync stays blocked until it is resolved.
    expect(check?.status).toBe("error");
    expect(check?.message).toContain("2026-01-01T00:00:00.000Z");
    expect(check?.message).toContain("reconcile.yaml");
    // A348: every sentence starts with a capital.
    expect(check?.message).toContain("). Your workspace may hold a partly-applied sync.");
  });

  // A348: the reader's sentence already ends with a period, so doctor
  // must not add a second one before "Expected".
  it("reports an empty schema_version file without a doubled period", async () => {
    await initLoctt(root);
    const locttDir = join(root, ".loctt");
    await writeFile(getSchemaVersionPath(locttDir), "", "utf-8");

    const checks = await runDoctor(root);
    const check = checks.find(c => c.message.includes("is empty"));
    expect(check?.status).toBe("error");
    expect(check?.message).toBe(
      `.schema-version is empty. Expected ${String(CURRENT_SCHEMA_VERSION)}`,
    );
  });

  it("says nothing about reconciliation when none is outstanding", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    // A check that always fires would train the user to ignore it.
    expect(checks.find(c => c.name === "reconciliation")).toBeUndefined();
  });

  it("includes task and relationship checks", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    const taskCheck = checks.find(c => c.name === "tasks");
    expect(taskCheck?.status).toBe("ok");
    expect(taskCheck?.message).toContain("0 task(s)");
  });

  it("warns when list-view.yaml references an unknown field", async () => {
    await initLoctt(root);
    const { resolveLocttDir } = await import("../paths/index.js");
    const { saveListViewConfig } = await import("../config/list-view.js");
    const locttDir = resolveLocttDir(root);
    // Built-in `status` is fine; `severity` does not match any
    // declared custom field, so doctor should flag it.
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "severity"] },
    });
    const checks = await runDoctor(root);
    const warn = checks.find(c => c.name === "list-view.yaml references");
    expect(warn?.status).toBe("warn");
    expect(warn?.message).toContain("severity");
  });

  it("does not warn when list-view.yaml references only built-in fields", async () => {
    await initLoctt(root);
    const { resolveLocttDir } = await import("../paths/index.js");
    const { saveListViewConfig } = await import("../config/list-view.js");
    const locttDir = resolveLocttDir(root);
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "priority", "type"] },
    });
    const checks = await runDoctor(root);
    expect(checks.find(c => c.name === "list-view.yaml references")).toBeUndefined();
  });

  // K102 removed the `query`/`conditions` derivation path along with the
  // `migrated` signal that reported it. There is no migration anymore: a
  // legacy `query`-only entry (no `filters`) is an unrecognized-key
  // failure at the object-fatal loader schema (`.strict()`), not a
  // per-view degradation — so it now surfaces as a queries.yaml PARSE
  // ERROR, not a warn. Confirmed directly against
  // `parseQueriesConfig`: it throws `queries[0] has unrecognized key(s):
  // "query"` for exactly this fixture. Recording this here instead of
  // deleting the case outright, since "a legacy file now hard-fails
  // instead of warning" is a real behaviour change future readers of this
  // file should not have to rediscover.
  it("reports a parse error for a legacy query-only entry (no filters) — no migration path anymore", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { getQueriesConfigPath, resolveLocttDir } = await import("../paths/index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    // A pre-K102 (legacy) entry: `query`, no `filters` array. `filters` is
    // the only stored form now, so this key is simply unrecognized.
    await writeFile(
      getQueriesConfigPath(locttDir),
      `queries:\n  - id: 01HQ00000000000000000LEGACY\n    name: legacy\n    query: status = backlog\n`,
      "utf-8",
    );
    const checks = await runDoctor(root);
    const q = checks.find(c => c.name === "queries.yaml");
    expect(q?.status).toBe("error");
    expect(q?.message).toContain("parse error");
  });

  it("warns when a saved view's filters are unreadable (per-view degradation)", async () => {
    // Per north-star principle 5: one entry whose `filters` do not
    // validate must not blank the whole catalog. Unlike the legacy
    // `query`-only case above, an unrecognized *value* inside a
    // present-but-broken `filters` array degrades that one entry to
    // `broken` while the file still loads.
    const { writeFile } = await import("node:fs/promises");
    const { getQueriesConfigPath, resolveLocttDir } = await import("../paths/index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    await writeFile(
      getQueriesConfigPath(locttDir),
      `queries:\n  - id: 01HQ000000000000000DBLBAD\n    name: double-broken\n    filters:\n      - kind: not-a-real-kind\n`,
      "utf-8",
    );
    const checks = await runDoctor(root);
    const q = checks.find(c => c.name === "queries.yaml" && c.status === "warn");
    expect(q?.message).toContain("could not be loaded");
    expect(q?.message).toContain("double-broken");
    // Per-view degradation: the file loads, so this is not a parse error.
    expect(checks.find(c => c.name === "queries.yaml" && c.status === "error")).toBeUndefined();
  });

  it("warns on key-index drift after an out-of-band frontmatter edit", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { writeTask } = await import("../task/io.js");
    const { rebuildKeyIndex } = await import("../state/key-index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    await writeTask(locttDir, "01XYZ", {
      frontmatter: {
        id: "01XYZ",
        key: "T-1",
        title: "first",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    });
    await rebuildKeyIndex(locttDir);

    // Hand-edit the task's key — the kind of change LocTT cannot
    // auto-detect because the indexed task id still resolves.
    const taskMd = join(locttDir, "tasks", "01XYZ", "task.md");
    const original = await readFile(taskMd, "utf-8");
    const rewritten = original.replace("key: T-1", "key: T-RENAMED");
    await writeFile(taskMd, rewritten, "utf-8");

    const checks = await runDoctor(root);
    const idx = checks.find(c => c.name === "key index");
    expect(idx?.status).toBe("warn");
    expect(idx?.message).toContain("--rebuild-index");
    // K-diagnostics-repair: the finding carries the machine-readable repair
    // so surfaces gate a "Rebuild key index" button on data, not the prose.
    expect(idx?.fix).toBe("rebuild-index");
  });

  it("rebuild-index option rebuilds the index in place", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { resolveLocttDir } = await import("../paths/index.js");
    const { writeTask } = await import("../task/io.js");
    const { rebuildKeyIndex, loadKeyIndex } = await import("../state/key-index.js");
    await initLoctt(root);
    const locttDir = resolveLocttDir(root);
    await writeTask(locttDir, "01XYZ", {
      frontmatter: {
        id: "01XYZ",
        key: "T-1",
        title: "first",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      body: "",
    });
    await rebuildKeyIndex(locttDir);

    const taskMd = join(locttDir, "tasks", "01XYZ", "task.md");
    const original = await readFile(taskMd, "utf-8");
    const rewritten = original.replace("key: T-1", "key: T-RENAMED");
    await writeFile(taskMd, rewritten, "utf-8");

    const checks = await runDoctor(root, { rebuildIndex: true });
    const rebuild = checks.find(c => c.name === "key index rebuild");
    expect(rebuild?.status).toBe("ok");

    const idx = await loadKeyIndex(locttDir);
    expect(idx?.entries["T-RENAMED"]).toBe("01XYZ");
    expect(idx?.entries["T-1"]).toBeUndefined();
  });

  // @verifies PRU-C12
  // The doctor half of C12 — the recovery half lives in
  // projects/prefix.test.ts.
  it("reports a pending prefix rename", async () => {
    await initLoctt(root);
    const { resolveLocttDir, getPrefixRenameStatePath } =
      await import("../paths/index.js");
    const { writeYamlAtomically } = await import("../utils/atomic-yaml.js");
    const locttDir = resolveLocttDir(root);
    await writeYamlAtomically(getPrefixRenameStatePath(locttDir), {
      project_id: "some-project",
      from: "T",
      to: "WEB",
      started_at: "2026-08-15T00:00:00.000Z",
    });

    const checks = await runDoctor(root);

    // Every surface finishes this at boot, so doctor seeing one means
    // recovery is stuck — the user needs to be told, not left with an
    // unexplained half-renamed tracker.
    const check = checks.find(c => c.name === "prefix rename");
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("T");
    expect(check?.message).toContain("WEB");
  });

  it("says nothing about prefix rename when none is pending", async () => {
    await initLoctt(root);
    const checks = await runDoctor(root);
    // A permanent entry would train users to ignore the row that
    // matters.
    expect(checks.find(c => c.name === "prefix rename")).toBeUndefined();
  });
});

/**
 * @verifies SET-29
 *
 * `runDoctorStream` is the primitive `runDoctor` drains, so the two
 * must never disagree on which checks run or in what order — that
 * equivalence is what lets the web surface stream each check as it
 * lands while the CLI/MCP still get the whole set (P10).
 */
describe("runDoctorStream", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-doctor-stream-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("yields the same checks, in the same order, as batched runDoctor", async () => {
    await initLoctt(root);

    const streamed: { name: string; status: string; message: string }[] = [];
    for await (const check of runDoctorStream(root)) {
      streamed.push({ name: check.name, status: check.status, message: check.message });
    }
    const batched = (await runDoctor(root)).map(c => ({
      name: c.name,
      status: c.status,
      message: c.message,
    }));

    // Identical content and order. If the generator dropped, reordered,
    // or duplicated a check relative to the array form, the surfaces
    // would drift — the exact failure P10 forbids.
    expect(streamed).toEqual(batched);
    // Guard against both being empty (a broken producer that yields
    // nothing would still satisfy `toEqual` above).
    expect(streamed.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves its first check before the whole run's I/O has finished", async () => {
    await initLoctt(root);

    // The streaming guarantee, made deterministic with a counter/gate on
    // the producer's own I/O instead of a wall-clock race. The previous
    // version raced a real `setTimeout(0)` against real filesystem I/O:
    // under load, the timer and the I/O can resolve in either order even
    // though the producer streams correctly — that load-sensitivity is
    // what this replaces.
    //
    // `access` (`node:fs/promises`) is the leaf syscall every check in
    // `runDoctorStream` bottoms out in (via `fileExists`, config loaders,
    // `readSchemaVersion`, …) — counting it counts real I/O calls without
    // touching what any of them return (see the module-level `vi.mock`
    // above). A streaming producer yields its first check (".loctt
    // directory") after exactly the ONE `access` call that check needs; a
    // producer that buffered the whole run first would have already
    // issued many more `access` calls (one per remaining check) by the
    // time that first value came back.
    accessCallCount = 0;

    const it = runDoctorStream(root);
    const first = await it.next();
    expect(first.value?.name).toBe(".loctt directory");

    // Exactly the call(s) for THIS check happened — not the whole run's.
    // `resolveLocttDir`/`fileExists` issue exactly one `access` for the
    // `.loctt` directory check; asserting the exact count (rather than
    // "at least one") is what catches a producer that raced ahead and
    // pre-fetched later checks' I/O before its first yield.
    const callsAtFirstYield = accessCallCount;
    expect(callsAtFirstYield).toBe(1);

    // Drain the remainder so nothing is left suspended, and confirm the
    // call count kept growing as each further check ran its own I/O —
    // i.e. the run really does more `access` calls than just the first.
    const rest: string[] = [];
    for (let n = await it.next(); !n.done; n = await it.next()) {
      rest.push(n.value.name);
    }
    expect(rest.length).toBeGreaterThanOrEqual(4);
    expect(accessCallCount).toBeGreaterThan(callsAtFirstYield);
  });

  it("(red-proof only, see comment) a producer that buffers the whole run before yielding fails the access-count assertion above", async () => {
    await initLoctt(root);

    // The batched shape the test above's comment describes: collect
    // every check into an array via the real generator, then yield from
    // that array. It reuses `runDoctorStream`'s real output (so this is a
    // faithful red-proof of the real producer's contract, not a
    // synthetic stand-in) but changes *when* the first yield happens,
    // which is exactly the defect the assertion above exists to catch.
    async function* bufferedDoctorStream(): AsyncGenerator<{ name: string }> {
      const all: { name: string }[] = [];
      for await (const check of runDoctorStream(root)) {
        all.push(check);
      }
      yield* all;
    }

    accessCallCount = 0;

    const it = bufferedDoctorStream();
    const first = await it.next();
    expect(first.value?.name).toBe(".loctt directory");

    // A buffering producer's first (and only) yield only resolves after
    // its internal loop has drained the ENTIRE real stream — so by the
    // time it hands back ".loctt directory", every other check's
    // `access` calls have already happened too. This is strictly greater
    // than the streaming producer's exactly-1, which is the failure this
    // red-proof exists to catch.
    expect(accessCallCount).toBeGreaterThan(1);
  });
});
