import { join } from "node:path";

import type { LabelsConfig } from "@loctt/contracts";
import { LabelsConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class LabelsConfigError extends LocttError {
  constructor(message: string) {
    // `config_invalid`, not the `unknown` an un-attributed Error
    // falls back to. The message already names the file, the field
    // path and what was expected (ERR-10); what was missing was a
    // code, so every surface reported a schema problem as an
    // unexplained server failure. V1: core states its own cause.
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
    this.name = "LabelsConfigError";
  }
}

const LABELS_FILE = "labels.yaml";

export function getLabelsConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), LABELS_FILE);
}

/** Parses raw YAML content into a LabelsConfig. */
/**
 * Drops a `color` that is not a hex value, keeping the label.
 *
 * MSL-22: an invalid colour must not produce an unstyled pill or a
 * render error — the label renders with the neutral default and the
 * bad value is surfaced as a fixable config problem.
 *
 * This is narrower than it looks against V9 ("config is not a log;
 * refuse rather than build on a definition you could not read"). V9's
 * reasoning is about a definition that **cannot render**: a status
 * with no key breaks every task pointing at it. A bad colour does not
 * break the definition — the label still has an id and a name, which
 * is everything a reference needs. So the *field* is dropped, not the
 * entry and not the file.
 *
 * Every write path validates through `HexColor`, so this state is
 * reachable only by hand-editing `labels.yaml`. Refusing to render
 * would punish every other label in the file for one typo in one
 * cosmetic field.
 */
function dropInvalidColors(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const labels = (raw as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) return raw;
  const cleaned: unknown[] = (labels as unknown[]).map((l): unknown => {
    if (typeof l !== "object" || l === null) return l;
    const entry = l as Record<string, unknown>;
    const color = entry["color"];
    if (typeof color !== "string") return l;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return l;
    const { color: _dropped, ...rest } = entry;
    return rest;
  });
  return { ...raw, labels: cleaned };
}

export function parseLabelsConfig(yamlContent: string): LabelsConfig {
  const raw: unknown = safeParseYaml(yamlContent, "labels.yaml");
  let parsed: LabelsConfig;
  try {
    parsed = LabelsConfigSchema.parse(dropInvalidColors(raw));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new LabelsConfigError(`labels.yaml is not valid: ${formatZodIssues("labels config", err)}`);
    }
    throw err;
  }
  // Schema already enforces uniqueness on id via superRefine.
  return parsed;
}

/** Serializes a LabelsConfig to YAML with stable key order. */
export function serializeLabelsConfig(config: LabelsConfig): string {
  return stringifyYaml({
    labels: config.labels.map(l => ({
      id: l.id,
      name: l.name,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function loadLabelsConfig(locttDir: string): Promise<LabelsConfig> {
  const path = getLabelsConfigPath(locttDir);
  // Absent is a supported state — a fresh tracker has not written this
  // file yet. Unreadable is not, and the two used to be one code path:
  // `fileExists` then `readFile` is two syscalls where the second can
  // still fail, and the failure surfaced as a bare errno.
  //
  // V9: config is not a log. A definition LocTT could not read is not
  // kept and merged like a comment — other data references it, so
  // LocTT refuses rather than building on top of it. The file itself is
  // never written over, which is what P-11 protects.
  const file = await readFileState(path);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") return { labels: [] };
  return parseLabelsConfig(file.content);
}

export async function saveLabelsConfig(
  locttDir: string,
  config: LabelsConfig,
): Promise<void> {
  // Round-trip through parse to enforce uniqueness/key validation.
  const validated = parseLabelsConfig(serializeLabelsConfig(config));
  await writeYamlAtomically(getLabelsConfigPath(locttDir), {
    labels: validated.labels.map(l => ({
      id: l.id,
      name: l.name,
      ...(l.color !== undefined ? { color: l.color } : {}),
      ...(l.archived === true ? { archived: true } : {}),
    })),
  });
}

export async function labelsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getLabelsConfigPath(locttDir));
}
