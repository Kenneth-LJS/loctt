import type { ErrorResponse } from "@loctt/contracts";

import { ApiError } from "../api/client.ts";

/**
 * A rejected field write, reduced to what the panel has to render.
 *
 * M2.2a held only `{ field, message }`, which is enough for a bad enum
 * value and wrong for every other failure this module exists for. The
 * three the cases name each need something the message cannot carry:
 *
 *  - **ERR-3** needs the *data-state claim* — "not saved" said in
 *    those words, distinct from "an error occurred". `data_state` is
 *    on the envelope; the message never says it.
 *  - **ERR-4** needs "unknown" to be *not* "not saved". The two are
 *    different claims and conflating them is either a false alarm or a
 *    false reassurance. `apiRequest` already produces
 *    `data_state: "unknown"` for a write that timed out.
 *  - **XS-57** needs `not_found` to be distinguishable from a
 *    transport failure, and needs retry *demoted* — retrying a write
 *    to a task that no longer exists cannot succeed.
 *
 * So the panel branches on the envelope, not on message text (P4, and
 * the reason the envelope carries structure at all).
 */
export interface FieldFailure {
  /** The control the message renders under. */
  readonly field: string;
  /** The headline, already resolved to configured labels (ERR-43). */
  readonly message: string;
  readonly code: ErrorResponse["code"] | undefined;
  readonly dataState: ErrorResponse["data_state"] | undefined;
  readonly recovery: ErrorResponse["recovery"] | undefined;
  /** The vars of the write that failed, so Retry can re-send *it*. */
  readonly retry: { readonly field: string; readonly value?: unknown } | undefined;
}

/**
 * Names for the ids and keys a server message may contain.
 *
 * Deliberately a flat map rather than five typed lookups: the message
 * is a string, and what the resolver needs is "given this token, what
 * does the user call it". A status key and a user ULID are the same
 * problem at that point.
 */
export type LabelIndex = ReadonlyMap<string, string>;

/**
 * Rewrites the raw keys and ULIDs in a server message as the labels
 * the user configured (ERR-43).
 *
 * The server cannot do this. Core's messages are shared by the CLI and
 * MCP, and its validator holds `workflow.yaml`'s *keys* — a set built
 * from `config.statuses.map(s => s.key)` — because keys are what it
 * compares against. The web client is the layer that has both halves:
 * the message and the `workflow`/`users`/`milestones` queries the
 * panel already renders from. So the translation happens here.
 *
 * ## What it does not do
 *
 * It **never invents a label**. A token with no entry in the index is
 * left exactly as it stands — that is ERR-43's stated exception, the
 * unknown-value case "where the raw key is all that exists". The
 * caller marks those; see {@link markUnknownValues}.
 *
 * And it does not paraphrase. The sentence stays the server's; only
 * the identifiers inside the quotes move. Rewriting the prose would
 * put a status name in this file, which is exactly what ERR-43's third
 * bullet forbids ("no message hardcodes a status name LocTT does not
 * know is configured").
 *
 * ## Why quoted tokens only
 *
 * Every identifier core emits is quoted or appears in a
 * comma-separated `valid:` list. Matching unquoted words would rewrite
 * the word "done" in "the write was done", and a resolver that edits
 * prose is worse than one that leaves a key showing.
 */
export function resolveLabels(message: string, index: LabelIndex): string {
  if (index.size === 0) return message;

  // `valid: a, b, c` — core's own suffix, listing every legal key.
  // Rewritten as a whole so the separators survive; each token is
  // resolved on its own, so a list that is half-recognised comes back
  // half-resolved rather than all-or-nothing.
  const withList = message.replace(
    /\bvalid:\s*([^;\n]+)/g,
    (whole, list: string) => {
      const parts = list.split(/,\s*/);
      const resolved = parts.map(p => index.get(p.trim()) ?? p.trim());
      // Unchanged means nothing was recognised; returning `whole`
      // keeps the original spacing rather than normalising it.
      return resolved.join(", ") === parts.map(p => p.trim()).join(", ")
        ? whole
        : `valid: ${resolved.join(", ")}`;
    },
  );

  // Quoted identifiers: `"in_progress"`, `"01M15Z…"`.
  return withList.replace(/"([^"]+)"/g, (whole, token: string) => {
    const label = index.get(token);
    return label === undefined ? whole : `"${label}"`;
  });
}

/**
 * Marks a quoted token the config does not declare as unrecognized.
 *
 * ERR-43's second bullet: the raw key may stand where no label exists,
 * but it must be "explicitly marked as an unrecognized value rather
 * than presented as a label". Without this the user reads
 * `unknown status "in_progress"` and cannot tell whether
 * `in_progress` is a label they should recognise or a key the config
 * lost — the two render identically.
 *
 * Applied only to the token core is complaining about, which is the
 * one that follows `unknown <field>`. The `valid:` list is by
 * construction all-declared, and marking those would be false.
 */
export function markUnknownValues(message: string, index: LabelIndex): string {
  return message.replace(
    /\bunknown ([a-z_]+(?:\.[A-Za-z0-9_-]+)?) "([^"]+)"/g,
    (whole, field: string, token: string) =>
      index.has(token)
        ? whole
        : `unknown ${field} "${token}" (an unrecognized value, not a label)`,
  );
}

/**
 * Builds the index from whatever the panel's queries have loaded.
 *
 * Every collection the panel renders a picker for, because every one
 * of them can appear in a rejection: `assertNotArchivedReferences`
 * names milestones, sprints, users and labels by id, and
 * `validateTaskAgainstWorkflow` names statuses, priorities, types and
 * custom-field enum values by key.
 *
 * Collisions are impossible in practice — ULIDs and workflow keys do
 * not overlap — and a later entry winning is harmless if they ever did.
 */
export function buildLabelIndex(sources: {
  readonly statuses?: readonly { key: string; label: string }[] | undefined;
  readonly priorities?: readonly { key: string; label: string }[] | undefined;
  readonly taskTypes?: readonly { key: string; label: string }[] | undefined;
  readonly customFields?: readonly {
    key: string;
    label: string;
    values?: readonly { key: string; label: string }[] | undefined;
  }[] | undefined;
  readonly users?: readonly { id: string; name: string }[] | undefined;
  readonly labels?: readonly { id: string; name: string }[] | undefined;
  readonly milestones?: readonly { id: string; name: string }[] | undefined;
  readonly sprints?: readonly { id: string; name: string }[] | undefined;
  readonly projects?: readonly { id: string; name: string }[] | undefined;
}): LabelIndex {
  const index = new Map<string, string>();
  for (const s of sources.statuses ?? []) index.set(s.key, s.label);
  for (const p of sources.priorities ?? []) index.set(p.key, p.label);
  for (const t of sources.taskTypes ?? []) index.set(t.key, t.label);
  for (const f of sources.customFields ?? []) {
    index.set(f.key, f.label);
    for (const v of f.values ?? []) index.set(v.key, v.label);
  }
  for (const u of sources.users ?? []) index.set(u.id, u.name);
  for (const l of sources.labels ?? []) index.set(l.id, l.name);
  for (const m of sources.milestones ?? []) index.set(m.id, m.name);
  for (const s of sources.sprints ?? []) index.set(s.id, s.name);
  for (const p of sources.projects ?? []) index.set(p.id, p.name);
  return index;
}

/**
 * Turns a rejected write into what the panel renders.
 *
 * `taskKey` rather than the ref the user navigated by: XS-57 requires
 * the message name `T-12`, "not by ULID", and a user who arrived
 * through a retired key or a ULID would otherwise be told about a
 * string that is not the task's name. The *current* key is the one
 * thing that is always right to show.
 */
export function toFieldFailure(
  err: Error,
  vars: { readonly field: string; readonly value?: unknown },
  index: LabelIndex,
  taskKey: string,
): FieldFailure {
  const envelope = err instanceof ApiError ? err.envelope : undefined;
  const field = envelope?.field ?? vars.field;

  // A failure that never reached the API has no envelope — a stopped
  // server, an HTML page from something upstream. Nothing was written,
  // and re-sending is exactly right once it is back (ERR-3).
  if (envelope === undefined) {
    return {
      field,
      message:
        "The LocTT server is not responding. It may have been stopped in the "
        + "terminal where you ran `loctt ui`.",
      code: undefined,
      dataState: "not_saved",
      recovery: { kind: "retry" },
      retry: vars,
    };
  }

  const message = markUnknownValues(resolveLabels(envelope.message, index), index);

  if (envelope.code === "not_found") {
    // XS-57. Core says `task not found: "T-1"`, which is true and is
    // not what the user needs: it reads like a bad link on a page that
    // was showing the task a second ago. The sentence has to say the
    // task was removed *while they were looking at it*, and it must
    // not be the sentence a stopped server produces.
    return {
      field,
      message:
        `${taskKey} no longer exists. It was deleted by another process `
        + `(the CLI, the MCP server, or another tab) while this page was open.`,
      code: envelope.code,
      dataState: envelope.data_state ?? "not_saved",
      // Not retry, and not because the server said so: retrying a
      // write to a deleted task re-sends a request that cannot
      // succeed, so offering it as the action is a dead end dressed as
      // a recovery (XS-57's third bullet).
      recovery: { kind: "none" },
      retry: undefined,
    };
  }

  return {
    field,
    message,
    code: envelope.code,
    dataState: envelope.data_state,
    recovery: envelope.recovery,
    // A write whose outcome is unknown must not be re-sent on the
    // user's behalf, and must not offer re-sending as the obvious
    // action either — it could double-apply (ERR-4's third bullet).
    retry: envelope.data_state === "unknown" ? undefined : vars,
  };
}
