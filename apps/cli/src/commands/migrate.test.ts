/**
 * `loctt migrate` on an older tracker (K154): upgrading is a deliberate
 * step, so the command previews, then asks. Driven through `main()` with
 * the frozen 0.1.0 seed, and the prompt mocked (ESM will not let a test
 * spy on `createInterface` after the fact).
 *
 * @verifies ONB-C13
 * @verifies ONB-C20
 * @verifies ONB-C21
 */
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../index.js";

let promptQuestion = "";
let promptAnswer = "n";
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: (q: string) => {
      promptQuestion = q;
      return Promise.resolve(promptAnswer);
    },
    close: () => {},
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));
const FROZEN = resolve(here, "../../../../tests/fixtures/trackers/seed-0.1.0/.loctt");

const UPGRADE_REFUSAL =
  "This tracker needs upgrading from 0.1.0 to 0.3.0. Run `loctt migrate` (a backup is made first).";

let root: string;
let originalArgv: string[];
let logSpy: MockInstance;
let errSpy: MockInstance;
const originalTTY = process.stdin.isTTY;

/** Every file under the tracker's parent, path → content: "nothing changed". */
async function fingerprint(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.set(p.slice(root.length), await readFile(p, "utf-8"));
    }
  };
  await walk(root);
  return out;
}

const out = (): string => logSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");
const err = (): string => errSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");
const backups = async (): Promise<string[]> =>
  (await readdir(root)).filter(n => n.startsWith(".loctt.backup-v0.1.0-"));
const version = async (): Promise<string> =>
  (await readFile(join(root, ".loctt", ".schema-version"), "utf-8")).trim();

async function run(...args: string[]): Promise<void> {
  process.argv = ["node", "loctt", ...args];
  await main();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-migrate-"));
  await cp(FROZEN, join(root, ".loctt"), { recursive: true });
  originalArgv = process.argv;
  vi.spyOn(process, "cwd").mockImplementation(() => root);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
  promptQuestion = "";
  promptAnswer = "n";
});

afterEach(async () => {
  process.argv = originalArgv;
  Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("every other command on a 0.1.0 tracker", () => {
  it("refuses with the upgrade message, exit 1, and writes nothing", async () => {
    const before = await fingerprint();
    await run("list");
    expect(process.exitCode).toBe(1);
    expect(err()).toContain(`Error: ${UPGRADE_REFUSAL}`);
    expect(await fingerprint()).toEqual(before);
  });
});

describe("loctt migrate on a 0.1.0 tracker", () => {
  it("previews from, to, each step in plain words and the backup, then asks; no changes nothing", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const before = await fingerprint();
    await run("migrate");
    const text = out();
    expect(text).toContain("This tracker needs upgrading from 0.1.0 to 0.3.0.");
    expect(text).toContain("1. 0.1.0 → 0.3.0  Save the order of every task's links");
    expect(text).toContain("Each task's links keep the order they are shown in today");
    expect(text).toContain(`${join(root, ".loctt")}.backup-v0.1.0-<date and time>`);
    expect(promptQuestion).toBe("Upgrade this tracker now? [y/N] ");
    expect(text).toContain("Not upgraded. Nothing was changed.");
    expect(process.exitCode).toBe(0);
    expect(await fingerprint()).toEqual(before);
  });

  it("upgrades when the user confirms, backing up first", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    promptAnswer = "y";
    await run("migrate");
    expect(await version()).toBe("0.3.0");
    expect(await backups()).toHaveLength(1);
    expect(out()).toContain("Upgraded this tracker from 0.1.0 to 0.3.0.");
    expect(process.exitCode).toBeUndefined();
    // And the refused command now runs.
    await run("list", "--limit", "1");
    expect(process.exitCode).toBeUndefined();
  });

  it("--dry-run shows the preview only: no prompt, nothing changed", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const before = await fingerprint();
    await run("migrate", "--dry-run");
    expect(out()).toContain("This tracker needs upgrading from 0.1.0 to 0.3.0.");
    expect(out()).toContain("Dry run. Nothing was changed.");
    expect(promptQuestion).toBe("");
    expect(await fingerprint()).toEqual(before);
  });

  it("not at a terminal and no --yes: refused naming the flag, exit 2, nothing changed", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const before = await fingerprint();
    await run("migrate");
    expect(process.exitCode).toBe(2);
    expect(err()).toContain("Pass --yes");
    expect(promptQuestion).toBe("");
    expect(await fingerprint()).toEqual(before);
  });

  it("--yes skips the prompt and upgrades", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await run("migrate", "--yes");
    expect(promptQuestion).toBe("");
    expect(await version()).toBe("0.3.0");
    expect(await backups()).toHaveLength(1);
    expect(out()).toMatch(/Backup written to .+\.loctt\.backup-v0\.1\.0-/);
  });
});

describe("doctor and info on a 0.1.0 tracker", () => {
  it("report the upgrade and write nothing, repairs included", async () => {
    const before = await fingerprint();
    await run("info");
    expect(out()).toContain(
      "Schema: needs upgrading from 0.1.0 to 0.3.0. Run `loctt migrate` (a backup is made first)",
    );
    await run("doctor", "--fix", "--rebuild-index");
    expect(out()).toContain(
      "✗ schema version: needs upgrading from 0.1.0 to 0.3.0. Run loctt migrate (a backup is made first)",
    );
    expect(out()).toContain(
      "✗ repairs: skipped. This tracker needs upgrading first. Run loctt migrate, then run the repair again",
    );
    expect(await fingerprint()).toEqual(before);
  });
});
