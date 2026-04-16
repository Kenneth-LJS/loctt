import { mkdir,readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ReconcileState } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getReconcileStatePath } from "../paths/index.js";
import { assertObject as _assertObject, assertString as _assertString } from "../utils/assert.js";

export class ReconcileStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconcileStateError";
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, ReconcileStateError);
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, ReconcileStateError);
}

const VALID_MODES = new Set(["publish", "sync"]);

/** Parses and validates raw YAML content into a ReconcileState. */
export function parseReconcileState(yamlContent: string): ReconcileState {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "reconcile state");

  assertString(raw["mode"], "mode");
  if (!VALID_MODES.has(raw["mode"])) {
    throw new ReconcileStateError(`mode must be one of: ${[...VALID_MODES].join(", ")}`);
  }
  assertString(raw["base_commit"], "base_commit");
  assertString(raw["remote_commit"], "remote_commit");
  assertString(raw["started_at"], "started_at");

  return {
    mode: raw["mode"] as ReconcileState["mode"],
    base_commit: raw["base_commit"],
    remote_commit: raw["remote_commit"],
    started_at: raw["started_at"],
  };
}

/** Serializes a ReconcileState to YAML string. */
export function serializeReconcileState(state: ReconcileState): string {
  return stringifyYaml(state);
}

/** Loads reconcile.yaml from .loctt/local/. */
export async function loadReconcileState(locttDir: string): Promise<ReconcileState> {
  const filePath = getReconcileStatePath(locttDir);
  const content = await readFile(filePath, "utf-8");
  return parseReconcileState(content);
}

/** Writes reconcile.yaml to .loctt/local/. Creates directories if needed. */
export async function saveReconcileState(locttDir: string, state: ReconcileState): Promise<void> {
  const filePath = getReconcileStatePath(locttDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeReconcileState(state), "utf-8");
}

/** Removes reconcile.yaml (called after reconciliation completes or is aborted). */
export async function clearReconcileState(locttDir: string): Promise<void> {
  const filePath = getReconcileStatePath(locttDir);
  await rm(filePath, { force: true });
}
