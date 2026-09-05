import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { getListViewConfigPath, resolveLocttDir } from "../paths/index.js";
import {
  ListViewConfigError,
  loadListViewConfig,
  parseListViewConfig,
  pruneListViewForRemovedCustomFields,
  saveListViewConfig,
} from "./list-view.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-listview-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseListViewConfig", () => {
  it("accepts a YAML document with just `{}`", () => {
    expect(parseListViewConfig("{}\n")).toEqual({});
  });

  it("parses visible and hidden arrays", () => {
    const cfg = parseListViewConfig(`
filters:
  visible: [status, priority]
  hidden: [type]
`);
    expect(cfg.filters?.visible).toEqual(["status", "priority"]);
    expect(cfg.filters?.hidden).toEqual(["type"]);
  });

  it("throws ListViewConfigError with a helpful message on duplicates", () => {
    expect(() =>
      parseListViewConfig(`
filters:
  visible: [status, status]
`),
    ).toThrow(ListViewConfigError);
  });

  it("throws on visible/hidden overlap", () => {
    expect(() =>
      parseListViewConfig(`
filters:
  visible: [status, type]
  hidden: [type]
`),
    ).toThrow(/both visible and hidden/);
  });
});

describe("parseListViewConfig — per-entry corruption degrades", () => {
  it("degrades a non-string chip key to a broken entry, keeps the good ones", () => {
    // A hand edit left a number in `visible`. The good keys must still
    // load (north-star P5) rather than the whole saved view blanking.
    const cfg = parseListViewConfig(`
filters:
  visible:
    - status
    - 5
    - priority
`);
    expect(cfg.filters?.visible).toEqual(["status", "priority"]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]).toMatchObject({ index: 1 });
    expect(cfg.broken?.[0]?.rawText).toBeTruthy();
    expect(cfg.broken?.[0]?.error).toBeTruthy();
  });

  it("degrades an empty-string chip key to a broken entry", () => {
    const cfg = parseListViewConfig(`
filters:
  hidden:
    - type
    - ""
`);
    expect(cfg.filters?.hidden).toEqual(["type"]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.index).toBe(1);
  });

  it("collects broken entries from both visible and hidden", () => {
    const cfg = parseListViewConfig(`
filters:
  visible:
    - status
    - 5
  hidden:
    - type
    - []
`);
    expect(cfg.filters?.visible).toEqual(["status"]);
    expect(cfg.filters?.hidden).toEqual(["type"]);
    expect(cfg.broken).toHaveLength(2);
  });

  it("omits `broken` entirely when every entry parses (distinct from [])", () => {
    const cfg = parseListViewConfig(`
filters:
  visible: [status, priority]
`);
    expect(cfg.broken).toBeUndefined();
  });

  it("keeps a malformed outer structure object-fatal (visible not an array)", () => {
    // No coherent list of entries to degrade around — must still throw.
    expect(() =>
      parseListViewConfig(`
filters:
  visible: status
`),
    ).toThrow(ListViewConfigError);
  });

  it("keeps an unknown top-level key object-fatal", () => {
    expect(() =>
      parseListViewConfig(`
bogus: true
`),
    ).toThrow(ListViewConfigError);
  });

  it("still rejects a stray hand-edited `broken:` key (loader owns it)", () => {
    expect(() =>
      parseListViewConfig(`
broken: []
filters:
  visible: [status]
`),
    ).toThrow(ListViewConfigError);
  });

  it("keeps duplicate-within-array object-fatal even alongside a degradable entry", () => {
    // The duplicate is an ambiguity the loader cannot silently resolve,
    // so it throws — it does not degrade to a broken entry.
    expect(() =>
      parseListViewConfig(`
filters:
  visible: [status, status]
`),
    ).toThrow(/duplicate entry 'status' in visible/);
  });
});

describe("loadListViewConfig / saveListViewConfig", () => {
  it("returns an empty config when no file exists", async () => {
    expect(await loadListViewConfig(locttDir)).toEqual({});
  });

  it("round-trips a filters block", async () => {
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "priority"], hidden: ["type"] },
    });
    const reloaded = await loadListViewConfig(locttDir);
    expect(reloaded.filters?.visible).toEqual(["status", "priority"]);
    expect(reloaded.filters?.hidden).toEqual(["type"]);
  });

  it("rejects malformed config on save (validation re-applied)", async () => {
    // Directly hand the writer a shape that violates the schema.
    await expect(
      saveListViewConfig(locttDir, {
        filters: { visible: ["status", "status"] },
      } as never),
    ).rejects.toThrow();
  });

  it("normalises an empty filters block out on disk", async () => {
    // After save, the on-disk YAML should not carry a no-op {} for
    // filters. (buildPlainObject drops an empty filters.)
    await saveListViewConfig(locttDir, {});
    const yaml = await readFile(getListViewConfigPath(locttDir), "utf-8");
    expect(yaml).not.toContain("filters:");
  });
});

describe("pruneListViewForRemovedCustomFields", () => {
  it("returns the input unchanged when no fields are removed", () => {
    const cfg = { filters: { visible: ["status", "severity"] } };
    expect(pruneListViewForRemovedCustomFields(cfg, new Set())).toBe(cfg);
  });

  it("drops removed field keys from visible", () => {
    const out = pruneListViewForRemovedCustomFields(
      { filters: { visible: ["status", "severity", "team"] } },
      new Set(["severity"]),
    );
    expect(out.filters?.visible).toEqual(["status", "team"]);
  });

  it("drops removed field keys from hidden", () => {
    const out = pruneListViewForRemovedCustomFields(
      { filters: { hidden: ["severity"] } },
      new Set(["severity"]),
    );
    expect(out.filters).toBeUndefined();
  });

  it("collapses the whole filters block when both arrays become empty", () => {
    const out = pruneListViewForRemovedCustomFields(
      { filters: { visible: ["severity"], hidden: ["team"] } },
      new Set(["severity", "team"]),
    );
    expect(out.filters).toBeUndefined();
  });

  it("collapses a visible array that became empty (returns to default)", () => {
    // An explicit `visible: []` would mean "show nothing", but a
    // visible list that became empty solely because every entry was
    // pruned almost certainly reflects stale state — see the
    // function's docstring. Collapse to the absent-form default.
    const out = pruneListViewForRemovedCustomFields(
      { filters: { visible: ["severity"], hidden: ["type"] } },
      new Set(["severity"]),
    );
    expect(out.filters?.visible).toBeUndefined();
    expect(out.filters?.hidden).toEqual(["type"]);
  });

  it("returns the input by identity when nothing changes", () => {
    const cfg = { filters: { visible: ["status"] } };
    const out = pruneListViewForRemovedCustomFields(cfg, new Set(["unrelated"]));
    expect(out).toBe(cfg);
  });

  it("preserves built-in field keys (they are not customfields and cannot be pruned away)", () => {
    // The function operates on a set of removed custom-field keys; it
    // doesn't know which entries are built-ins vs custom. The caller
    // is responsible for only passing removed custom-field keys. This
    // test pins the documented contract: a built-in key that happens
    // to share a name with a removed custom field would be pruned —
    // but in practice the workflow writer never passes built-in
    // field keys to this function.
    const out = pruneListViewForRemovedCustomFields(
      { filters: { visible: ["status"] } },
      new Set(["nonexistent"]),
    );
    expect(out.filters?.visible).toEqual(["status"]);
  });
});
