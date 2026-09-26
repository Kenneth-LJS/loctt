/**
 * RR-B1 (K136, A352): the published manifests tell the truth.
 *
 * A static check over the three packages this repo publishes, read from
 * the built output and from what `npm pack` would actually ship:
 * - one license (MIT, with the LICENSE file in the tarball) and one
 *   version across all of them and the root;
 * - every `bin` and `main` target is in the tarball, and each bin is an
 *   executable Node script;
 * - every bare package a shipped bundle loads is a declared runtime
 *   dependency, and every declared runtime dependency is loaded by
 *   something shipped (no install weight for nothing);
 * - `prepublishOnly` rebuilds, so a stale `dist` cannot be published.
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
  PUBLISHED,
  type PublishedDir,
  readManifest,
  repoRoot,
} from "./lib.ts";

const manifests = new Map<PublishedDir, Manifest>();
const shipped = new Map<PublishedDir, string[]>();

beforeAll(async () => {
  for (const dir of PUBLISHED) {
    manifests.set(dir, await readManifest(dir));
    shipped.set(dir, await packedFiles(dir));
  }
}, 120_000);

function m(dir: PublishedDir): Manifest {
  const found = manifests.get(dir);
  if (found === undefined) throw new Error(`no manifest for ${dir}`);
  return found;
}

function files(dir: PublishedDir): string[] {
  return shipped.get(dir) ?? [];
}

/** `./dist/x.js` and `dist/x.js` name the same packed file. */
function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

describe("published package manifests (RR-B1)", () => {
  // @verifies ONB-C9
  it("each published package is public, MIT, and ships its LICENSE", () => {
    for (const dir of PUBLISHED) {
      expect(m(dir).private, dir).not.toBe(true);
      expect(m(dir).license, dir).toBe("MIT");
      expect(files(dir), dir).toContain("LICENSE");
    }
  });

  // @verifies ONB-C9
  it("every published package and the root carry one version and one Node floor", async () => {
    const root = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as Manifest;
    expect(root.license).toBe("MIT");
    for (const dir of PUBLISHED) {
      expect(m(dir).version, dir).toBe(root.version);
      expect(m(dir).engines?.["node"], dir).toBe(root.engines?.["node"]);
    }
  });

  // @verifies ONB-C9
  it("every bin and main target is in the tarball, and each bin is a Node script", async () => {
    for (const dir of PUBLISHED) {
      const man = m(dir);
      const targets = [...Object.values(man.bin ?? {}), ...(man.main !== undefined ? [man.main] : [])];
      expect(targets.length, dir).toBeGreaterThan(0);
      for (const t of targets) expect(files(dir), `${dir}: ${t}`).toContain(norm(t));
      for (const bin of Object.values(man.bin ?? {})) {
        const head = (await readFile(path.join(repoRoot, dir, bin), "utf8")).slice(0, 64);
        expect(head.startsWith("#!/usr/bin/env node"), `${dir}: ${bin} shebang`).toBe(true);
      }
    }
  });

  // @verifies ONB-C9
  it("the three launchers exist: loctt, loctt-mcp, loctt-ui", () => {
    expect(Object.keys(m("apps/cli").bin ?? {})).toContain("loctt");
    expect(Object.keys(m("apps/mcp").bin ?? {})).toContain("loctt-mcp");
    expect(Object.keys(m("apps/web").bin ?? {})).toContain("loctt-ui");
  });

  // @verifies ONB-C9
  it("declared runtime dependencies are exactly what the shipped bundles load", async () => {
    for (const dir of PUBLISHED) {
      const loaded = new Set<string>();
      for (const f of files(dir).filter(p => p.endsWith(".js"))) {
        const src = await readFile(path.join(repoRoot, dir, f), "utf8");
        for (const pkg of bareImports(src, f)) loaded.add(pkg);
      }
      const declared = new Set(Object.keys(m(dir).dependencies ?? {}));
      const undeclared = [...loaded].filter(p => !declared.has(p)).sort();
      const unused = [...declared].filter(p => !loaded.has(p)).sort();
      expect(undeclared, `${dir} loads packages it does not declare`).toEqual([]);
      expect(unused, `${dir} declares packages nothing it ships loads`).toEqual([]);
    }
  }, 120_000);

  // @verifies ONB-C9
  it("publishing rebuilds first (prepublishOnly)", () => {
    for (const dir of PUBLISHED) {
      expect(m(dir).scripts?.["prepublishOnly"], dir).toMatch(/npm run build/);
    }
  });

  // @verifies ONB-C9
  it("the CLI ships the web client that `loctt ui` serves", () => {
    expect(files("apps/cli")).toContain("dist/client/index.html");
    expect(files("apps/web")).toContain("dist/client/index.html");
  });
});
