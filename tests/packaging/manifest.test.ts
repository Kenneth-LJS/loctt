/**
 * RR-B1 (K136, K139, A352, A355): the published manifest tells the truth,
 * and it is the only one.
 *
 * A static check over `loctt` (`apps/cli`), the one package this repo
 * publishes, read from the built output and from what `npm pack` would
 * actually ship:
 * - every other workspace, and the root, is `private` (nothing else can
 *   be published by accident);
 * - `loctt` is public, MIT, ships its LICENSE, and carries the root's
 *   version and Node floor, as does every app workspace;
 * - its one launcher is `loctt`, the `bin`/`main` targets are in the
 *   tarball, and the bin is an executable Node script;
 * - every bare package the shipped bundle loads is a declared runtime
 *   dependency, and every declared runtime dependency is loaded by
 *   something shipped (no install weight for nothing);
 * - `prepublishOnly` rebuilds, so a stale `dist` cannot be published;
 * - the tarball carries the web client `loctt ui` serves.
 *
 * Needs a build; `npm run test:packaging` runs one first.
 *
 * @verifies ONB-C9
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  bareImports,
  type Manifest,
  packedFiles,
  PUBLISHED_DIR,
  PUBLISHED_NAME,
  readManifest,
  repoRoot,
  workspaceDirs,
} from "./lib.ts";

let man: Manifest;
let root: Manifest;
let shipped: string[];
let workspaces: string[];

beforeAll(async () => {
  man = await readManifest(PUBLISHED_DIR);
  root = await readManifest(".");
  shipped = await packedFiles(PUBLISHED_DIR);
  workspaces = await workspaceDirs();
}, 120_000);

/** `./dist/x.js` and `dist/x.js` name the same packed file. */
function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

describe("the published package manifest (RR-B1)", () => {
  // @verifies ONB-C9
  it("loctt is the only publishable package: every other workspace and the root are private", async () => {
    expect(workspaces).toContain(PUBLISHED_DIR);
    expect(workspaces.length).toBeGreaterThan(1);
    const publishable: string[] = [];
    for (const dir of workspaces) {
      if ((await readManifest(dir)).private !== true) publishable.push(dir);
    }
    expect(publishable).toEqual([PUBLISHED_DIR]);
    expect(root.private).toBe(true);
  });

  // @verifies ONB-C9
  it("loctt is public, MIT, and ships its LICENSE", () => {
    expect(man.name).toBe(PUBLISHED_NAME);
    expect(man.private).not.toBe(true);
    expect(man.license).toBe("MIT");
    expect(shipped).toContain("LICENSE");
  });

  // @verifies ONB-C9
  it("loctt, every app workspace and the root carry one version and one Node floor", async () => {
    expect(root.license).toBe("MIT");
    for (const dir of workspaces.filter(d => d.startsWith("apps/"))) {
      const m = await readManifest(dir);
      expect(m.version, dir).toBe(root.version);
      expect(m.engines?.["node"], dir).toBe(root.engines?.["node"]);
    }
  });

  // @verifies ONB-C9
  it("its one launcher is `loctt`, and every bin and main target is in the tarball", async () => {
    expect(man.bin).toEqual({ loctt: "dist/index.js" });
    const targets = [...Object.values(man.bin ?? {}), ...(man.main !== undefined ? [man.main] : [])];
    for (const t of targets) expect(shipped, t).toContain(norm(t));
    for (const bin of Object.values(man.bin ?? {})) {
      const head = (await readFile(path.join(repoRoot, PUBLISHED_DIR, bin), "utf8")).slice(0, 64);
      expect(head.startsWith("#!/usr/bin/env node"), `${bin} shebang`).toBe(true);
    }
  });

  // @verifies ONB-C9
  it("declared runtime dependencies are exactly what the shipped bundle loads", async () => {
    const loaded = new Set<string>();
    for (const f of shipped.filter(p => p.endsWith(".js"))) {
      const src = await readFile(path.join(repoRoot, PUBLISHED_DIR, f), "utf8");
      for (const pkg of bareImports(src, f)) loaded.add(pkg);
    }
    const declared = new Set(Object.keys(man.dependencies ?? {}));
    const undeclared = [...loaded].filter(p => !declared.has(p)).sort();
    const unused = [...declared].filter(p => !loaded.has(p)).sort();
    expect(undeclared, "loctt loads packages it does not declare").toEqual([]);
    expect(unused, "loctt declares packages nothing it ships loads").toEqual([]);
    // Nothing internal may be needed at runtime: the workspaces are
    // bundled in, and none of them is published.
    expect([...loaded].filter(p => p.startsWith("@loctt/")), "loads an internal workspace").toEqual([]);
  }, 120_000);

  // @verifies ONB-C9
  it("publishing rebuilds first (prepublishOnly)", () => {
    expect(man.scripts?.["prepublishOnly"]).toMatch(/npm run build/);
  });

  // @verifies ONB-C9
  it("the tarball carries the web client that `loctt ui` serves", () => {
    expect(shipped).toContain("dist/client/index.html");
  });
});
