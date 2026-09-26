/**
 * RR-B4 (K139, A352, A355): the one published package, `loctt`, installs
 * on its own and runs all three surfaces.
 *
 * `loctt` is packed with `npm pack` and installed into a temp project
 * outside the repository, with only its declared dependencies (see
 * `lib.ts` for how, and what that does not cover). Then it is run the
 * way a user would run it:
 * - `loctt --version`, `init` + `create`;
 * - `loctt ui --no-open` serving the page, its assets and the API;
 * - `loctt mcp` answering initialize, listing every tool the MCP
 *   workspace registers, and reading the tracker the CLI made;
 * - the version-skew guard: a tracker from a newer LocTT is refused by
 *   the CLI and by `loctt mcp`.
 *
 * Before A352, `loctt ui` from an installed CLI answered `/` with a 404
 * because the CLI shipped no client. Inside the monorepo it passed.
 *
 * Slow (packs and spawns real processes). Run with
 * `npm run test:packaging`, which builds first.
 *
 * @verifies ONB-C8
 */

import { execFile, spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTools } from "../../apps/mcp/src/index.ts";
import { isolatedEnv, outsideTmp, packAndInstall, PUBLISHED_DIR, readManifest } from "./lib.ts";

const exec = promisify(execFile);

interface Installed { readonly pkgDir: string; readonly project: string }
let cli: Installed;
let tracker: string;
let version: string;
const cleanup: string[] = [];

const cliBin = (): string => path.join(cli.pkgDir, "dist/index.js");

beforeAll(async () => {
  version = (await readManifest(PUBLISHED_DIR)).version ?? "";
  cli = await packAndInstall(PUBLISHED_DIR);
  tracker = await outsideTmp("loctt-pack-tracker-");
  cleanup.push(cli.project, tracker);
}, 180_000);

afterAll(async () => {
  for (const dir of cleanup) await rm(dir, { recursive: true, force: true });
});

async function run(bin: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { cwd, env: isolatedEnv() });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: typeof e.code === "number" ? e.code : 1 };
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => { resolve(port); });
    });
  });
}

/**
 * Starts a server bin, waits for `/api/info`, runs `check`, and stops it.
 * Fails with the process's own output if it exits or never answers, so a
 * crash on start reads as the crash, not as a timeout.
 */
async function withServer(bin: string, args: string[], check: (base: string) => Promise<void>): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [bin, ...args, "--port", String(port), "--no-open"], {
    cwd: tracker,
    env: isolatedEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c: Buffer) => { output += c.toString(); });
  child.stderr.on("data", (c: Buffer) => { output += c.toString(); });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const base = `http://127.0.0.1:${String(port)}`;
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (exited) throw new Error(`${path.basename(bin)} exited before serving:\n${output}`);
      if (Date.now() > deadline) throw new Error(`${path.basename(bin)} never answered:\n${output}`);
      const ok = await fetch(`${base}/api/info`).then(r => r.ok, () => false);
      if (ok) break;
      await new Promise(r => setTimeout(r, 150));
    }
    await check(base);
  } finally {
    child.kill("SIGTERM");
    await new Promise(r => setTimeout(r, 100));
    if (!exited) child.kill("SIGKILL");
  }
}

/** The page, one of its assets, and the API, as a browser would load them. */
async function expectServesUi(base: string): Promise<void> {
  const page = await fetch(`${base}/`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type") ?? "").toMatch(/text\/html/);
  const html = await page.text();
  expect(html).toContain('<div id="root">');
  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(asset, "index.html references a script asset").toBeDefined();
  const js = await fetch(`${base}${asset ?? ""}`);
  expect(js.status).toBe(200);
  const info = await fetch(`${base}/api/info`);
  expect(info.status).toBe(200);
  expect(((await info.json()) as { exists?: boolean }).exists).toBe(true);
  const tasks = await fetch(`${base}/api/tasks`);
  expect(tasks.status).toBe(200);
  expect(JSON.stringify(await tasks.json())).toContain("Installed from a tarball");
}

async function withMcp<T>(command: string[], cwd: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: command,
    cwd,
    env: isolatedEnv(),
    stderr: "pipe",
  });
  const client = new Client({ name: "loctt-packaging-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map(c => c.text ?? "").join("\n");
}

describe("the published `loctt` package installs and runs on its own (RR-B4)", () => {
  // @verifies ONB-C8
  it("loctt: --version, init and create", async () => {
    const v = await run(cliBin(), ["--version"], tracker);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toBe(version);

    const init = await run(cliBin(), ["init"], tracker);
    expect(init.code, init.stderr).toBe(0);
    const create = await run(cliBin(), ["create", "Installed from a tarball"], tracker);
    expect(create.code, create.stderr).toBe(0);
    expect(create.stdout).toMatch(/[A-Z]+-1/);
  }, 60_000);

  // @verifies ONB-C8
  it("loctt ui: serves the web UI and the API", async () => {
    await withServer(cliBin(), ["ui"], expectServesUi);
  }, 60_000);

  // @verifies ONB-C8
  it("loctt mcp: initializes and lists every tool the MCP server registers", async () => {
    // The source registry is the reference: a tool lost in bundling, or a
    // server that starts with a partial registry, shows up as a diff.
    const expected = getTools().map(t => t.name).sort();
    expect(expected.length).toBeGreaterThanOrEqual(99);
    await withMcp([cliBin(), "mcp"], tracker, async client => {
      expect(client.getServerVersion()?.name).toBe("loctt");
      expect(client.getServerVersion()?.version).toBe(version);
      expect(client.getInstructions() ?? "").toContain("get_workflow_config");
      const listed = (await client.listTools()).tools.map(t => t.name).sort();
      expect(listed).toEqual(expected);
      // A read against the tracker the installed CLI created.
      const tasks = await client.callTool({ name: "list_tasks", arguments: {} });
      expect(tasks.isError ?? false).toBe(false);
      expect(text(tasks)).toContain("Installed from a tarball");
    });
  }, 60_000);

  // @verifies ONB-C8
  it("refuses a tracker written by a newer LocTT, from the CLI and from `loctt mcp`", async () => {
    const versionFile = path.join(tracker, ".loctt", ".schema-version");
    const original = await readFile(versionFile, "utf8");
    await writeFile(versionFile, "999\n", "utf8");
    try {
      const list = await run(cliBin(), ["list"], tracker);
      expect(list.code).not.toBe(0);
      expect(list.stderr).toMatch(/newer version of LocTT/);

      await withMcp([cliBin(), "mcp", "--root", tracker], cli.project, async client => {
        const res = await client.callTool({ name: "list_tasks", arguments: {} });
        expect(res.isError).toBe(true);
        expect(text(res)).toMatch(/newer version of LocTT/);
      });
    } finally {
      await writeFile(versionFile, original, "utf8");
    }
  }, 60_000);
});
