import { readFile, rm } from "node:fs/promises";

import type { ReconcileState } from "@loctt/contracts";
import { ReconcileStateSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";
import { getReconcileStatePath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";

export class ReconcileStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconcileStateError";
  }
}

export function parseReconcileState(yamlContent: string): ReconcileState {
  const raw: unknown = parseYaml(yamlContent);
  try {
    return ReconcileStateSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ReconcileStateError(formatZodIssues("reconcile state", err));
    }
    throw err;
  }
}

export function serializeReconcileState(state: ReconcileState): string {
  return stringifyYaml(state);
}

export async function loadReconcileState(locttDir: string): Promise<ReconcileState> {
  const filePath = getReconcileStatePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseReconcileState(content);
}

/**
 * Reads the sentinel if one is present, returning `undefined` when it is
 * not.
 *
 * Absence is the normal case — the file exists only between the moment a
 * reconciliation starts writing and the moment it finishes — so callers
 * that check on every sync need "no file" to be an answer rather than an
 * exception. A file that exists but will not parse still throws: that is
 * a real problem, and treating it as "nothing in progress" would let a
 * half-applied sync be silently overwritten by the next one.
 */
export async function readReconcileState(
  locttDir: string,
): Promise<ReconcileState | undefined> {
  try {
    return await loadReconcileState(locttDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function saveReconcileState(locttDir: string, state: ReconcileState): Promise<void> {
  await writeFileAtomically(getReconcileStatePath(locttDir), serializeReconcileState(state));
}

export async function clearReconcileState(locttDir: string): Promise<void> {
  const filePath = getReconcileStatePath(locttDir);
  await rm(filePath, { force: true });
}
