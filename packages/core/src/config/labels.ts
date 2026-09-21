import { join } from "node:path";

import type { LabelDef, LabelsConfig } from "@loctt/contracts";
import { EntityColorSchema, LabelDefSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { brokenEntriesToPlain, collectValidEntries } from "./health.js";
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

/**
 * The object-fatal outer shape. `labels` must be an array, and no unknown
 * top-level keys are allowed — but the entries stay `unknown` so a single
 * structurally-corrupt label does not fail the whole `.parse()` and blank
 * the surface. The per-ENTRY validation happens afterwards through
 * `collectValidEntries`, which degrades a bad entry to a `BrokenEntry`.
 */
const RawLabelsConfigSchema = z.object({
  labels: z.array(z.unknown()),
}).strict();

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
function dropInvalidColor(l: unknown): unknown {
  if (typeof l !== "object" || l === null) return l;
  const entry = l as Record<string, unknown>;
  if (!("color" in entry)) return l;
  // K103: `color` is no longer only a hex string — an explicit
  // `{light, dark}` pair and a `{palette: id}` reference are equally
  // valid. Let the contract schema be the judge of every shape rather
  // than re-implementing it here; this function's job is only to drop
  // a colour the schema REJECTS, and a shape it accepts must survive.
  // (Before K103 this tested the hex regex directly, which would now
  // silently delete every palette and per-mode colour on load.)
  if (EntityColorSchema.safeParse(entry["color"]).success) return l;
  const { color: _dropped, ...rest } = entry;
  return rest;
}

export function parseLabelsConfig(yamlContent: string): LabelsConfig {
  const raw: unknown = safeParseYaml(yamlContent, "labels.yaml");

  // Object-fatal: the file must be `{ labels: [...] }` with no stray
  // top-level keys. A file that is not even a list has no coherent
  // collection to degrade around, so it still throws (ground rule 1).
  let outer: z.infer<typeof RawLabelsConfigSchema>;
  try {
    outer = RawLabelsConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new LabelsConfigError(`labels.yaml is not valid: ${formatZodIssues("labels config", err)}`);
    }
    throw err;
  }

  // Per-ENTRY degrade (north-star principle 5). A wrong-typed field on
  // one label — an unknown key, a bad `name`, a non-boolean `archived` —
  // no longer blanks every label in the file: that entry becomes a
  // `BrokenEntry` and the rest load. A bad `color` is a narrower salvage
  // the schema already tolerates (MSL-22): the color is dropped per-field
  // *before* per-entry parse, so a label with a typo'd colour and no
  // other fault loads as a valid label, not a broken entry.
  const salvaged = outer.labels.map(dropInvalidColor);
  const { valid: labels, broken } = collectValidEntries<LabelDef>(
    salvaged,
    LabelDefSchema,
    "label",
  );

  // Duplicate ids are object-fatal: two labels sharing an id makes a
  // reference ambiguous, so we cannot silently pick one. Checked only
  // across the entries that actually validated — a `BrokenEntry` has no
  // trustworthy id to collide on.
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.id)) {
      throw new LabelsConfigError(`labels.yaml is not valid: duplicate label id: ${l.id}`);
    }
    seen.add(l.id);
  }

  return {
    labels,
    // Omitted, not `[]`, when everything parsed — so a consumer reading
    // only `labels` is unaffected and "none broken" stays distinct from
    // "not inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

/** Build a plain serializable object for one valid label. */
function serializeLabel(l: LabelDef): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    ...(l.color !== undefined ? { color: l.color } : {}),
    ...(l.archived === true ? { archived: true } : {}),
  };
}

/**
 * The written shape: valid labels AND any preserved broken entries, in a
 * single `labels` array. K28: a `broken` label another process left must
 * survive an unrelated write — re-emitting only the valid entries silently
 * drops it (P1 data loss). A broken entry is a label whose fields do not
 * validate; it belongs in the same list and re-loads back into `broken`.
 */
function buildLabelsPlainObject(config: LabelsConfig): { labels: Record<string, unknown>[] } {
  return {
    labels: [
      ...config.labels.map(serializeLabel),
      ...brokenEntriesToPlain(config.broken, new Set(config.labels.map(l => l.id))),
    ],
  };
}

/** Serializes a LabelsConfig to YAML with stable key order. */
export function serializeLabelsConfig(config: LabelsConfig): string {
  return stringifyYaml(buildLabelsPlainObject(config));
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
  // Round-trip through parse to enforce uniqueness/key validation — over
  // the VALID entries only (the broken ones are, by definition, not valid;
  // they are carried verbatim, not re-validated).
  parseLabelsConfig(stringifyYaml({ labels: config.labels.map(serializeLabel) }));
  // Write valid + preserved broken (K28) so a corrupt sibling survives.
  await writeYamlAtomically(getLabelsConfigPath(locttDir), buildLabelsPlainObject(config));
}

export async function labelsConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getLabelsConfigPath(locttDir));
}
