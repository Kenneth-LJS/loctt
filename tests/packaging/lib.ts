/**
 * Shared machinery for the packaging suite (`npm run test:packaging`).
 *
 * RR-B1 and RR-B4 (K136, A352) are claims about what a stranger gets from
 * npm, and the monorepo is the one place those claims cannot be checked:
 * hoisting puts every workspace's dependencies in the root
 * `node_modules`, so a bundle that imports a package its own manifest
 * forgot still resolves here (that is how `@loctt/web` shipped without
 * `yaml`). So this suite works from `npm pack` tarballs, installed
 * outside the repository with nothing but the package's own declared
 * dependencies beside it.
 *
 * "Installed" here means: the tarball unpacked into
 * `<tmp>/node_modules/<name>`, and each declared runtime dependency
 * symlinked into `<tmp>/node_modules` from the monorepo's own copy. That
 * is deliberate: it is offline and deterministic, and it is exactly the
 * resolution boundary that matters (the bundle can reach its declared
 * dependencies and nothing else). What it does not check is that the
 * declared version ranges resolve on the public registry; see A352.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import ts from "typescript";

const exec = promisify(execFile);

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The packages this repo publishes: every non-private workspace. */
export const PUBLISHED = ["apps/cli", "apps/mcp", "apps/web"] as const;
export type PublishedDir = (typeof PUBLISHED)[number];

export interface Manifest {
  readonly name: string;
  readonly version?: string;
  readonly license?: string;
  readonly private?: boolean;
  readonly main?: string;
  readonly bin?: Record<string, string>;
  readonly files?: readonly string[];
  readonly scripts?: Record<string, string>;
  readonly engines?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly exports?: unknown;
}

export async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(repoRoot, dir, "package.json"), "utf8")) as Manifest;
}

export async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

/** The files `npm pack` would put in the tarball, relative to the package. */
export async function packedFiles(dir: string): Promise<string[]> {
  const { stdout } = await exec("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: path.join(repoRoot, dir),
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map(f => f.path);
}

const BUILTINS = new Set(builtinModules);

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * Every bare package a built JS file loads: static `import`/`export from`,
 * dynamic `import("x")`, and `require("x")` (esbuild's `__require`).
 * Read from the syntax tree, not grepped, so a string in a message that
 * happens to look like a module name is not mistaken for an import.
 * Node built-ins and relative paths are dropped.
 */
export function bareImports(source: string, fileName: string): Set<string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = new Set<string>();
  const add = (spec: string): void => {
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return;
    if (BUILTINS.has(spec) || BUILTINS.has(spec.split("/")[0] ?? "")) return;
    found.add(packageOf(spec));
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const arg = node.arguments[0];
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && (callee.text === "require" || callee.text === "__require");
      if ((isImport || isRequire) && arg !== undefined && ts.isStringLiteralLike(arg)) add(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** A fresh directory under the OS temp dir, outside the repository. */
export async function outsideTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  if (dir.startsWith(repoRoot)) throw new Error(`temp dir ${dir} is inside the repo`);
  return dir;
}

/**
 * `version` satisfies a caret range (`^1.2.3`), the only form the
 * published manifests use. Anything else is refused rather than guessed,
 * so a new range style fails loudly here instead of linking a copy npm
 * would never have chosen.
 */
export function satisfiesCaret(version: string, range: string): boolean {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (m === null) throw new Error(`unsupported version range "${range}" (expected ^x.y.z)`);
  const want = m.slice(1).map(Number) as [number, number, number];
  const have = version.split(/[.+-]/).slice(0, 3).map(Number);
  const [ma, mi, pa] = [have[0] ?? -1, have[1] ?? -1, have[2] ?? -1];
  if (ma !== want[0]) return false;
  if (want[0] === 0 && mi !== want[1]) return false;
  if (mi !== want[1]) return mi > want[1];
  return pa >= want[2];
}

/**
 * A copy of `dep` in the monorepo that satisfies `range`, the way npm
 * would pick one. The workspace's own `node_modules` first, then the
 * root. Version-checked because the root copy is often a different major
 * (the root `ajv` is eslint's v6; `@loctt/cli` and `@loctt/mcp` need v8),
 * and linking the wrong one tests an install npm would never produce.
 */
async function monorepoCopy(dir: string, dep: string, range: string): Promise<string> {
  const seen: string[] = [];
  for (const base of [path.join(repoRoot, dir), repoRoot]) {
    const candidate = path.join(base, "node_modules", dep);
    const manifest = path.join(candidate, "package.json");
    if (!(await exists(manifest))) continue;
    const { version } = JSON.parse(await readFile(manifest, "utf8")) as { version: string };
    if (satisfiesCaret(version, range)) return candidate;
    seen.push(`${candidate}@${version}`);
  }
  throw new Error(
    `no copy of ${dep}@${range} (declared by ${dir}) in the monorepo` +
    (seen.length > 0 ? `; found ${seen.join(", ")}. Run npm install.` : ""),
  );
}

/**
 * Packs the workspace at `dir` and installs the tarball into a fresh
 * project outside the repo, with only its declared `dependencies`.
 * Returns the installed package's directory and the project root.
 */
export async function packAndInstall(dir: PublishedDir): Promise<{ pkgDir: string; project: string }> {
  const project = await outsideTmp("loctt-pack-");
  const { stdout } = await exec(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", project],
    { cwd: path.join(repoRoot, dir), maxBuffer: 64 * 1024 * 1024 },
  );
  const tarball = path.join(project, (JSON.parse(stdout) as Array<{ filename: string }>)[0]?.filename ?? "");
  const manifest = await readManifest(dir);
  const pkgDir = path.join(project, "node_modules", manifest.name);
  await mkdir(pkgDir, { recursive: true });
  await exec("tar", ["-xzf", tarball, "-C", pkgDir, "--strip-components=1"]);
  // Install from the PACKED manifest: that is what npm would read.
  const packed = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8")) as Manifest;
  for (const [dep, range] of Object.entries(packed.dependencies ?? {})) {
    const link = path.join(project, "node_modules", dep);
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(await monorepoCopy(dir, dep, range), link, "dir");
  }
  return { pkgDir, project };
}

/**
 * The environment an installed package runs with: the parent's, minus
 * anything that would let Node resolve modules from outside the install.
 */
export function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "NODE_PATH" && k !== "NODE_OPTIONS") env[k] = v;
  }
  return { ...env, ...extra };
}
