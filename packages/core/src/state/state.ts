import type { LocttState } from "@loctt/contracts";
import { LocttStateSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { safeParseYaml } from "../config/yaml-coerce.js";
import { formatZodIssues } from "../config/zod-error.js";
import { LocttError } from "../errors.js";
import { getStateFilePath } from "../paths/index.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";

/**
 * Thrown when state.yaml is present but does not validate.
 *
 * `config_invalid`, not a bare `Error`. state.yaml is identity-bearing —
 * it holds the per-project key-allocation counters (`keys.<id>.next_number`)
 * and the retired-project counters (`retired_keys`) — so a hand-broken one
 * is a data problem the user must fix, not an unexplained server fault. As
 * a plain `Error` every surface fell through to the `unknown`/500 path
 * `errorEnvelope` reserves for un-attributed causes; the web server's
 * top-level catch turned a broken counter into "Something failed and LocTT
 * could not determine the cause", burying which counter and what was
 * expected. Matching the sibling config loaders (`WorkflowConfigError`,
 * `MilestonesConfigError`), core now states its own cause and names the
 * file.
 *
 * Still extends the error hierarchy via `LocttError extends Error`, so the
 * existing `instanceof StateError` export and the generic
 * `(err as Error).message` catch in `doctor` keep working unchanged.
 */
export class StateError extends LocttError {
  constructor(message: string) {
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
    this.name = "StateError";
  }
}

/**
 * Parses and validates state.yaml.
 *
 * **state.yaml is object-fatal by nature — deliberately NOT degraded.**
 * Every value in it is a key-allocation counter that `allocateKey`
 * (`state/keys.ts`) reads to mint the next user-facing key
 * (`${prefix}${next_number}`). There is no field-local or per-entry
 * corruption to degrade around the way a task or a config list has:
 *
 *  - Dropping or defaulting a wrong-typed `next_number` re-issues a key a
 *    live task already holds — a key collision, which the key-allocation
 *    invariants (`docs/dev/reference/invariants.md`, P-5/P-7) forbid because it is
 *    unrecoverable: two tasks then answer to one key and every link,
 *    bookmark and commit message referencing it is ambiguous.
 *  - Setting aside one bad `keys.<project>` entry as a `BrokenEntry` and
 *    loading the rest would let the next `createTask` in that project mint
 *    a key against a *missing* counter — the same collision by omission.
 *  - `prefix` and the project-id keys are identity; there is nothing to
 *    substitute.
 *
 * So a corrupt state.yaml throws, exactly as before. What changed is
 * attribution: the throw now carries a `config_invalid` code (via
 * `StateError`) and a message that names the file, the exact counter path
 * and what was expected (e.g. `keys.task.next_number must be >= 1`) rather
 * than surfacing as an unattributed failure. Malformed YAML is likewise
 * attributed through `safeParseYaml` instead of leaking a raw parser error.
 */
export function parseState(yamlContent: string): LocttState {
  const raw: unknown = safeParseYaml(yamlContent, "state.yaml");
  try {
    return LocttStateSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new StateError(`state.yaml is not valid: ${formatZodIssues("state", err)}`);
    }
    throw err;
  }
}

export function serializeState(state: LocttState): string {
  const out: Record<string, unknown> = { keys: state.keys };
  if (state.retired_keys !== undefined && Object.keys(state.retired_keys).length > 0) {
    out["retired_keys"] = state.retired_keys;
  }
  return stringifyYaml(out);
}

export async function loadState(locttDir: string): Promise<LocttState> {
  const filePath = getStateFilePath(locttDir);
  // state.yaml is a required core file — `allocateKey` cannot mint a key
  // without its counters, and `doctor` flags its absence as an error. So
  // absent still throws, but now distinctly from unreadable: an ENOENT the
  // caller can recognise vs. a permissions/IO failure that must not be
  // mistaken for "no state" and written over (P-11). Both used to surface
  // as whatever bare errno `readFile` produced.
  const file = await readFileState(filePath);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT", path: filePath });
  }
  return parseState(file.content);
}

/**
 * Writes state.yaml atomically. Coordination across writers
 * requires the caller to hold `withStateLock` around the
 * read-modify-write pair.
 */
export async function saveState(locttDir: string, state: LocttState): Promise<void> {
  await writeFileAtomically(getStateFilePath(locttDir), serializeState(state));
}
