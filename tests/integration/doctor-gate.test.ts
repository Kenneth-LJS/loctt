/**
 * K145 / B43: the doctor gate itself. A write through a surface that
 * leaves doctor a finding the tracker did not have fails the test; a
 * clean write, a finding the test set up out of band, and an allowed
 * finding do not.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./adapters/cli-spawn.js";
import { gated } from "./fixtures/doctor-gate.js";
import { removeTaskOutOfBand, withTmpLoctt } from "./fixtures/tmp-loctt.js";

/** Makes T-1 → T-2 `blocks` one-sided: drops T-2's inverse edge. */
async function dropInverse(root: string): Promise<void> {
  const tasks = path.join(root, ".loctt/tasks");
  for (const id of await readdir(tasks)) {
    const file = path.join(tasks, id, "task.md");
    const text = await readFile(file, "utf-8");
    if (!text.includes("\nkey: T-2\n")) continue;
    await writeFile(file, text.replace(/relationships:\n(?:[ \t]+.*\n)+/, ""), "utf-8");
  }
}

async function taskFileOf(root: string, key: string): Promise<string> {
  const tasks = path.join(root, ".loctt/tasks");
  for (const id of await readdir(tasks)) {
    const file = path.join(tasks, id, "task.md");
    if ((await readFile(file, "utf-8")).includes(`\nkey: ${key}\n`)) return file;
  }
  throw new Error(`no task ${key}`);
}

async function idOf(root: string, key: string): Promise<string> {
  return path.basename(path.dirname(await taskFileOf(root, key)));
}

/** Drops `onKey`'s `is_blocked_by` edge to `toKey`, leaving `toKey`'s link one-sided. */
async function dropInverseOf(root: string, onKey: string, toKey: string): Promise<void> {
  const file = await taskFileOf(root, onKey);
  const target = await idOf(root, toKey);
  const text = await readFile(file, "utf-8");
  const next = text.replace(new RegExp(`  - type: is_blocked_by\\n    target: ${target}\\n(?:    rank: .*\\n)?`), "");
  if (next === text) throw new Error(`no edge from ${onKey} to ${toKey}`);
  await writeFile(file, next, "utf-8");
}

/** Puts back `onKey`'s `is_blocked_by` edge to `toKey`. */
async function restoreInverse(root: string, onKey: string, toKey: string): Promise<void> {
  const file = await taskFileOf(root, onKey);
  const target = await idOf(root, toKey);
  const text = await readFile(file, "utf-8");
  await writeFile(file, text.replace("relationships:\n", `relationships:\n  - type: is_blocked_by\n    target: ${target}\n    rank: a\n`), "utf-8");
}

async function linkedPair(root: string): Promise<void> {
  await runCli(["create", "a"], { cwd: root });
  await runCli(["create", "b"], { cwd: root });
  await runCli(["link", "T-1", "blocks", "T-2"], { cwd: root });
}

describe("doctor gate (K145)", () => {
  it("passes a test whose writes leave doctor clean", async () => {
    await expect(withTmpLoctt(async ({ root }) => { await linkedPair(root); })).resolves.toBeUndefined();
  });

  it("fails a test whose surface write leaves a new finding", async () => {
    // `gated` marks the corruption as a surface action, standing in for
    // a CLI command that drops the inverse.
    await expect(withTmpLoctt(async ({ root }) => {
      await linkedPair(root);
      await gated(path.resolve(root), () => dropInverse(root));
    })).rejects.toThrow(/doctor gate \(K145\).*relationship/s);
  });

  // A366: the gate compares findings one by one. Doctor's relationships
  // check is one count line ("1 issue(s) found"), the same before and
  // after a write that fixes one link and breaks another, so comparing
  // whole lines let that write through. The per-link findings must differ.
  it("fails a write that fixes one relationship finding and introduces another", async () => {
    await expect(withTmpLoctt(async ({ root }) => {
      await linkedPair(root);
      await runCli(["create", "c"], { cwd: root });
      await runCli(["link", "T-3", "blocks", "T-2"], { cwd: root });
      await dropInverseOf(root, "T-2", "T-1"); // out of band: the starting finding
      await gated(path.resolve(root), async () => {
        await restoreInverse(root, "T-2", "T-1");
        await dropInverseOf(root, "T-2", "T-3");
      });
    })).rejects.toThrow(/doctor gate \(K145\)/);
  });

  it("does not blame the surface for a state the test made out of band", async () => {
    await expect(withTmpLoctt(async ({ root }) => {
      await linkedPair(root);
      await removeTaskOutOfBand(root, "T-2"); // T-1's edge now dangles
      await runCli(["set", "T-1", "priority", "high"], { cwd: root });
    })).resolves.toBeUndefined();
  });

  it("accepts a finding the test allows", async () => {
    await expect(withTmpLoctt(async ({ root }) => {
      await linkedPair(root);
      await gated(path.resolve(root), () => dropInverse(root));
    }, { allowDoctorFindings: [/relationship/i] })).resolves.toBeUndefined();
  });

  it("covers a test that runs init itself", async () => {
    await expect(withTmpLoctt(async ({ root }) => {
      await runCli(["init", "--no-docs"], { cwd: root });
      await runCli(["create", "a"], { cwd: root });
    }, { init: false })).resolves.toBeUndefined();
  });
});
