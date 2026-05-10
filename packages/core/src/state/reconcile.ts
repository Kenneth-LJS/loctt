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

export async function saveReconcileState(locttDir: string, state: ReconcileState): Promise<void> {
  await writeFileAtomically(getReconcileStatePath(locttDir), serializeReconcileState(state));
}

export async function clearReconcileState(locttDir: string): Promise<void> {
  const filePath = getReconcileStatePath(locttDir);
  await rm(filePath, { force: true });
}
