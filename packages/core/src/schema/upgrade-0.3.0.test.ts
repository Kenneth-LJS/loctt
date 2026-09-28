/**
 * The first real format upgrade, 0.1.0 → 0.3.0 (K142, K143), on the
 * frozen 0.1.0 seed (`tests/fixtures/trackers/seed-0.1.0`), and the
 * automatic-upgrade machinery around it (`upgradeIfSafe`).
 *
 * The expected order is computed here from the raw files with the 0.1.0
 * rule written out independently (A357's rule before K143: a kind set
 * `ranked: true` lists ranked links by rank, then unranked in stored
 * order; any other kind lists stored order), so the step cannot vouch
 * for itself.
 *
 * @verifies ONB-C12
 * @verifies ONB-C13
 * @verifies ONB-C14
 * @verifies ONB-C16
 * @verifies ONB-C18
 */
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

import { runDoctor } from "../diagnostics/doctor.js";
import { getSchemaMigrationInProgressPath } from "../paths/index.js";
import { requireSupportedSchema, upgradeIfSafe, upgradeNotice } from "./migrate.js";
import { rankEveryLink } from "./steps/rank-every-link.js";
import { SchemaUnmigratableError } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const FROZEN = resolve(here, "../../../../tests/fixtures/trackers/seed-0.1.0/.loctt");

interface Edge { type: string; target: string; rank?: string }

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-upgrade-"));
  locttDir = join(root, ".loctt");
  await cp(FROZEN, locttDir, { recursive: true });
});

afterEach(async () => {
  vi.doUnmock("../task/io.js");
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

/** Every task's `relationships`, read from the raw files. */
async function edgesByTask(dir: string): Promise<Map<string, Edge[]>> {
  const out = new Map<string, Edge[]>();
  for (const id of await readdir(join(dir, "tasks"))) {
    const raw = await readFile(join(dir, "tasks", id, "task.md"), "utf-8");
    const fm = parseYaml(raw.split("---")[1] ?? "") as { relationships?: Edge[] };
    out.set(id, fm.relationships ?? []);
  }
  return out;
}

/** 0.1.0's shown order: per task, per type, the targets in order. */
async function shownOrder010(dir: string): Promise<Map<string, string[]>> {
  const wf = parseYaml(await readFile(join(dir, "config", "workflow.yaml"), "utf-8")) as {
    relationships: { key: string; inverse?: string; kind?: string; ranked?: boolean }[];
  };
  const ranked = new Set<string>();
  for (const d of wf.relationships) {
    if (d.ranked !== true) continue;
    ranked.add(d.key);
    if (d.kind !== "symmetric" && d.inverse !== undefined) ranked.add(d.inverse);
  }
  const out = new Map<string, string[]>();
  for (const [id, edges] of await edgesByTask(dir)) {
    for (const type of new Set(edges.map(e => e.type))) {
      const group = edges.map((e, index) => ({ ...e, index })).filter(e => e.type === type);
      if (ranked.has(type)) {
        group.sort((a, b) => {
          if ((a.rank === undefined) !== (b.rank === undefined)) return a.rank === undefined ? 1 : -1;
          if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
          return a.index - b.index;
        });
      }
      out.set(`${id} ${type}`, group.map(e => e.target));
    }
  }
  return out;
}

/** 0.3.0's listed order: every group by rank, ties by stored position. */
async function listedOrder030(dir: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const [id, edges] of await edgesByTask(dir)) {
    for (const type of new Set(edges.map(e => e.type))) {
      const group = edges.map((e, index) => ({ ...e, index })).filter(e => e.type === type);
      group.sort((a, b) => ((a.rank ?? "") === (b.rank ?? "") ? a.index - b.index : (a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
      out.set(`${id} ${type}`, group.map(e => e.target));
    }
  }
  return out;
}

/** Every file under `dir`, path → content, for "nothing changed". */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(p.slice(dir.length), await readFile(p, "utf-8"));
    }
  };
  await walk(dir);
  return out;
}

async function backups(): Promise<string[]> {
  return (await readdir(root)).filter(n => n.startsWith(".loctt.backup-v0.1.0-"));
}

describe("0.1.0 → 0.3.0 on the frozen seed", () => {
  it("ranks every link in the order 0.1.0 showed it, backs up first, and leaves doctor clean", async () => {
    const before = await shownOrder010(locttDir);
    const original = await snapshot(locttDir);
    // The seed has at least one group whose stored order is not its
    // shown order (a reranked child), or the order check proves little.
    const stored = new Map<string, string[]>();
    for (const [id, edges] of await edgesByTask(locttDir)) {
      for (const t of new Set(edges.map(e => e.type))) stored.set(`${id} ${t}`, edges.filter(e => e.type === t).map(e => e.target));
    }
    expect([...before].some(([k, v]) => JSON.stringify(stored.get(k)) !== JSON.stringify(v))).toBe(true);

    const result = await upgradeIfSafe(locttDir);
    expect(result?.from).toBe("0.1.0");
    expect(result?.to).toBe("0.3.0");
    expect(upgradeNotice(result!)).toBe(
      `Upgraded this tracker from 0.1.0 to 0.3.0 (backup: ${result?.backupPath ?? ""}).`,
    );

    // The backup is the tracker as it was, byte for byte.
    expect(await backups()).toHaveLength(1);
    expect(await snapshot(result?.backupPath ?? "")).toEqual(original);

    // Every link has a rank, and each group lists as it was shown.
    for (const edges of (await edgesByTask(locttDir)).values()) {
      for (const e of edges) expect(e.rank, JSON.stringify(e)).toBeDefined();
    }
    expect(await listedOrder030(locttDir)).toEqual(before);

    expect((await readFile(join(locttDir, ".schema-version"), "utf-8")).trim()).toBe("0.3.0");
    expect(await readFile(join(locttDir, "config", "workflow.yaml"), "utf-8")).not.toMatch(/ranked:/);
    // The seed's baseline finding (the key index is not checked in) is
    // the only one left.
    const findings = (await runDoctor(root)).filter(c => c.status !== "ok");
    expect(findings.map(c => c.name)).toEqual(["key index"]);
  });

  it("changes nothing the second time, through the guard or the step itself", async () => {
    await upgradeIfSafe(locttDir);
    const after = await snapshot(locttDir);

    expect(await upgradeIfSafe(locttDir)).toBeNull();
    await rankEveryLink(locttDir);
    expect(await snapshot(locttDir)).toEqual(after);
    expect(await backups()).toHaveLength(1);
  });

  it("upgrades once when two opens race, and the other finds it current", async () => {
    const results = await Promise.all([upgradeIfSafe(locttDir), upgradeIfSafe(locttDir), upgradeIfSafe(locttDir)]);
    expect(results.filter(r => r !== null)).toHaveLength(1);
    expect(await backups()).toHaveLength(1);
    await expect(requireSupportedSchema(locttDir)).resolves.toBeUndefined();
  });
});

describe("an open while another process is mid-upgrade", () => {
  // The step outlasts the migration lock's own retries (about 2.5s), so
  // the second open has to wait for the first rather than fail on the
  // lock or read the first's live sentinel as a crash.
  it("waits for it, runs no step itself, and finds the tracker current", async () => {
    let runs = 0;
    vi.doMock("./migrations.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./migrations.js")>();
      return {
        ...actual,
        findMigrationPath: (from: string, to: string) => (from === to ? [] : [{
          from: "0.1.0", to: "0.3.0", description: "slow",
          apply: async () => { runs += 1; await new Promise(r => { setTimeout(r, 4000); }); },
        }]),
      };
    });
    vi.resetModules();
    const { upgradeIfSafe: open } = await import("./migrate.js");
    const first = open(locttDir);
    await new Promise(r => { setTimeout(r, 300); });
    const second = open(locttDir);
    const [a, b] = await Promise.all([first, second]);
    expect(runs).toBe(1);
    expect(a?.to).toBe("0.3.0");
    expect(b).toBeNull();
    expect(await backups()).toHaveLength(1);
    vi.doUnmock("./migrations.js");
  }, 20_000);
});

describe("a crash part-way through the upgrade", () => {
  it("leaves the sentinel, and the next start refuses with the recovery message", async () => {
    // The fifth task write throws, as a crash would leave it: some task
    // files rewritten, the version still 0.1.0.
    vi.doMock("../task/io.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../task/io.js")>();
      let writes = 0;
      return {
        ...actual,
        writeTask: async (...args: Parameters<typeof actual.writeTask>) => {
          writes += 1;
          if (writes === 5) throw new Error("disk went away");
          return actual.writeTask(...args);
        },
      };
    });
    vi.resetModules();
    const { upgradeIfSafe: upgradeWithCrash } = await import("./migrate.js");

    await expect(upgradeWithCrash(locttDir)).rejects.toThrow("disk went away");

    const sentinel = await readFile(getSchemaMigrationInProgressPath(locttDir), "utf-8");
    expect(sentinel).toContain("from: 0.1.0");
    expect(sentinel).toContain("to: 0.3.0");
    const backup = /backup: (.+)/.exec(sentinel)?.[1] ?? "";
    expect((await stat(backup)).isDirectory()).toBe(true);
    expect((await readFile(join(locttDir, ".schema-version"), "utf-8")).trim()).toBe("0.1.0");

    vi.doUnmock("../task/io.js");
    vi.resetModules();
    const fresh = await import("./migrate.js");
    const err = await fresh.upgradeIfSafe(locttDir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf((await import("./version.js")).SchemaUnmigratableError);
    expect((err as Error).message).toMatch(/interrupted mid-run/);
    expect((err as SchemaUnmigratableError).remedy).toMatch(/Restore from the backup named in/);
  });
});

describe("what upgradeIfSafe refuses", () => {
  const write = async (content: string): Promise<void> => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(locttDir, ".schema-version"), content, "utf-8");
  };

  it("a tracker newer than the code, naming the release to install", async () => {
    await write("9.9.9\n");
    await expect(upgradeIfSafe(locttDir)).rejects.toThrow("This tracker needs loctt 9.9.9 or newer.");
  });

  it.each([
    ["1\n", /must hold a format version such as 0\.3\.0 \(three whole numbers separated by dots\)\. Got: 1\./],
    ["garbage\n", /must hold a format version such as 0\.3\.0 .* Got: garbage\./],
    ["", /\.schema-version is empty\. It must hold a format version such as 0\.3\.0\./],
  ])("%j, saying what the file must hold", async (content, message) => {
    await write(content);
    const original = await snapshot(locttDir);
    await expect(upgradeIfSafe(locttDir)).rejects.toThrow(message);
    expect(await snapshot(locttDir)).toEqual(original);
    expect(await backups()).toEqual([]);
  });

  it("a path with a risky step, which waits for `loctt migrate`", async () => {
    vi.doMock("./migrations.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./migrations.js")>();
      return {
        ...actual,
        findMigrationPath: () => [{ from: "0.1.0", to: "0.3.0", description: "rewrite everything", risky: true, apply: () => Promise.resolve() }],
      };
    });
    vi.resetModules();
    const { upgradeIfSafe: guarded } = await import("./migrate.js");
    await expect(guarded(locttDir)).rejects.toThrow(/needs your go-ahead \(rewrite everything\)\. Run `loctt migrate`/);
    expect(await backups()).toEqual([]);
    vi.doUnmock("./migrations.js");
  });
});

// K142: "find the highest version that's lower/at the data version". A
// recorded version stands for the highest known format at or below it.
describe("a recorded version between known formats (M1)", () => {
  const write = async (content: string): Promise<void> => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(locttDir, ".schema-version"), content, "utf-8");
  };

  it.each(["0.2.1", "0.2.0"])("%s is format 0.1.0: upgraded like it, and the file rewritten to 0.3.0", async (recorded) => {
    await write(`${recorded}\n`);
    const before = await shownOrder010(locttDir);

    const result = await upgradeIfSafe(locttDir);
    expect(result?.from).toBe(recorded);
    expect(result?.to).toBe("0.3.0");
    expect(result?.steps.map(s => `${s.from}->${s.to}`)).toEqual(["0.1.0->0.3.0"]);
    expect((await readdir(root)).filter(n => n.startsWith(`.loctt.backup-v${recorded}-`))).toHaveLength(1);

    for (const edges of (await edgesByTask(locttDir)).values()) {
      for (const e of edges) expect(e.rank, JSON.stringify(e)).toBeDefined();
    }
    expect(await listedOrder030(locttDir)).toEqual(before);
    expect((await readFile(join(locttDir, ".schema-version"), "utf-8")).trim()).toBe("0.3.0");
    expect(await upgradeIfSafe(locttDir)).toBeNull();
  });

  it("planMigration and the strict guard read 0.2.1 as format 0.1.0", async () => {
    await write("0.2.1\n");
    const { planMigration } = await import("./migrate.js");
    const plan = await planMigration(locttDir);
    expect(plan.from).toBe("0.2.1");
    expect(plan.steps.map(s => `${s.from}->${s.to}`)).toEqual(["0.1.0->0.3.0"]);
    await expect(requireSupportedSchema(locttDir)).rejects.toThrow(
      "This tracker's format is 0.2.1. This build reads 0.3.0. Run `loctt migrate` to upgrade.",
    );
  });

  it("0.0.9 is below every format: refused, not offered `loctt migrate`, and nothing written", async () => {
    await write("0.0.9\n");
    const original = await snapshot(locttDir);
    const err = await upgradeIfSafe(locttDir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaUnmigratableError);
    expect((err as Error).message).toBe(".schema-version holds 0.0.9, which is not a LocTT format. The first format is 0.1.0.");
    expect((err as SchemaUnmigratableError).remedy).toMatch(/^Put the tracker's format version in \.schema-version: 0\.1\.0 /);
    expect((err as SchemaUnmigratableError).remedy).not.toMatch(/loctt (migrate|init)/);
    expect(await snapshot(locttDir)).toEqual(original);
    const { planMigration, migrateToCurrent } = await import("./migrate.js");
    await expect(planMigration(locttDir)).rejects.toMatchObject({ name: "SchemaUnmigratableError" });
    await expect(migrateToCurrent(locttDir)).rejects.toMatchObject({ name: "SchemaUnmigratableError" });
  });

  // A build writes the format it knows, never its own release, so a
  // version above 0.3.0 was written by a build with a newer format, even
  // 0.3.1 (A366 call 1).
  it("0.3.1 is above this build's format: refused, naming the release", async () => {
    await write("0.3.1\n");
    await expect(upgradeIfSafe(locttDir)).rejects.toThrow("This tracker needs loctt 0.3.1 or newer.");
  });
});

describe("formatForRecordedVersion", () => {
  it("maps to the highest known format at or below, and refuses outside them", async () => {
    const { formatForRecordedVersion, knownFormats } = await import("./migrations.js");
    const { SchemaTooNewError, SchemaUnmigratableError: Unmigratable } = await import("./version.js");
    expect(knownFormats()).toEqual(["0.1.0", "0.3.0"]);
    expect(formatForRecordedVersion("0.1.0")).toBe("0.1.0");
    expect(formatForRecordedVersion("0.2.99")).toBe("0.1.0");
    expect(formatForRecordedVersion("0.3.0")).toBe("0.3.0");
    // With a later format registered, a release between them maps down.
    const later = [{ from: "0.1.0", to: "0.2.5", description: "", apply: () => Promise.resolve() }];
    expect(formatForRecordedVersion("0.2.9", later)).toBe("0.2.5");
    expect(formatForRecordedVersion("0.2.4", later)).toBe("0.1.0");
    expect(() => formatForRecordedVersion("0.0.9")).toThrow(Unmigratable);
    expect(() => formatForRecordedVersion("0.3.1")).toThrow(SchemaTooNewError);
  });
});
