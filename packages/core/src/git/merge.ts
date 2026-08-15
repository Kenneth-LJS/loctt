import type { HistoryEntry, LocttState, Task } from "@loctt/contracts";

import { mergeKeyHistory, mergeRelationships } from "./reconcile.js";

/**
 * Field-level merging for git sync — the layer `three-way.ts` classifies
 * files for, and `publish-sync.ts` calls before deciding to abort.
 *
 * The rules here implement decisions M1–M4 in docs/dev/decisions.md.
 * Each file type merges differently because each has a different notion
 * of what "the same thing changed twice" means:
 *
 * - **task.md** — per-field last-write-wins on `updated_at` (M2), with
 *   `relationships` and `key_history` unioned instead, because those are
 *   sets whose members were each added deliberately. The body is
 *   last-write-wins with the loser preserved (M4).
 * - **_history.yaml** — union. Load-bearing: M2's "you can recover the
 *   value you lost" guarantee is false if the history recording it was
 *   itself dropped by the merge.
 * - **_comments.yaml** — union by id, deletion beating a concurrent
 *   edit. Editing what someone else deleted should not resurrect it.
 * - **projects.yaml / queries.yaml** — union by entry id.
 *
 * Everything here is pure: it takes two parsed values and returns a
 * merged one. Reading, writing and staging belong to the caller, so the
 * rules can be tested without a git repository.
 */

/** A merge that could not be resolved, for the caller to abort on. */
export interface MergeConflict {
  readonly path: string;
  readonly reason: string;
}

export interface MergeOutcome<T> {
  readonly merged: T;
  /**
   * Set when a value was displaced by last-write-wins and the loser is
   * worth keeping (M4). The caller writes it beside the file.
   */
  readonly displaced?: { readonly label: string; readonly content: string };
}

/**
 * Later `updated_at` wins a contested field (M2).
 *
 * Equal timestamps resolve to `local` deterministically rather than
 * arbitrarily: sync must produce the same result whichever clone runs
 * it, and a coin flip on a tie makes two clones disagree permanently.
 * A tie means the same second, not the same edit, so either choice
 * loses something — the tie-break is about convergence, not about being
 * right.
 */
export function laterWins<T>(
  local: T,
  incoming: T,
  localUpdatedAt: string,
  incomingUpdatedAt: string,
): T {
  return incomingUpdatedAt > localUpdatedAt ? incoming : local;
}

/**
 * Merges one task's frontmatter and body.
 *
 * Returns the losing body when the two differ and it was displaced, so
 * the caller can preserve it (M4). A silently replaced body is the
 * failure mode that costs most — people do not re-read their own
 * paragraphs to check they survived.
 */
export function mergeTask(
  local: Task,
  incoming: Task,
): MergeOutcome<Task> {
  const lf = local.frontmatter;
  const inf = incoming.frontmatter;

  // Whole-record recency, used for every scalar field. Per-field
  // timestamps do not exist — `updated_at` is stamped per write, so the
  // finest available granularity is "this version is newer".
  const winner = laterWins(local, incoming, lf.updated_at, inf.updated_at);
  const loser = winner === local ? incoming : local;

  const frontmatter: Task["frontmatter"] = {
    ...winner.frontmatter,
    // Sets, not scalars: each member was added by someone who meant it,
    // so a union loses nothing and last-write-wins would drop the other
    // side's edges entirely.
    ...(mergeRelationships(
      lf.relationships ?? [],
      inf.relationships ?? [],
    ).length > 0
      ? {
        relationships: mergeRelationships(
          lf.relationships ?? [],
          inf.relationships ?? [],
        ),
      }
      : {}),
    ...(mergeKeyHistory(lf.key_history, inf.key_history) !== undefined
      ? { key_history: mergeKeyHistory(lf.key_history, inf.key_history) }
      : {}),
  };

  const merged: Task = { frontmatter, body: winner.body };

  // Only worth preserving when the loser's body is actually different
  // and non-empty — writing a sibling file for an identical body is
  // noise the user has to dismiss.
  if (loser.body.trim().length > 0 && loser.body !== winner.body) {
    return {
      merged,
      displaced: {
        label: winner === local ? "incoming" : "local",
        content: loser.body,
      },
    };
  }
  return { merged };
}

/**
 * Unions history entries.
 *
 * Identity is `(timestamp, kind, actor, field)`. Two entries agreeing on
 * all four are the same event seen by both clones — the same write,
 * mirrored — rather than two events that happened to coincide. Content
 * is deliberately not part of the key: M3 makes entries carry
 * `before`/`after`, and including them would make a re-serialized value
 * (key order, number formatting) look like a distinct event.
 *
 * Sorted by timestamp so the merged file reads as one timeline.
 */
export function mergeHistory(
  local: readonly HistoryEntry[],
  incoming: readonly HistoryEntry[],
): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const e of [...local, ...incoming]) {
    const key = [e.timestamp, e.kind, e.actor ?? "", e.field ?? ""].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return out;
}

/** The subset of a comment this merge needs to reason about. */
export interface MergeableComment {
  readonly id: string;
  readonly body?: string;
  readonly deleted?: boolean;
  readonly updated_at?: string;
  readonly created_at?: string;
}

/**
 * Unions comments by id.
 *
 * A deletion beats a concurrent edit: someone removed it on purpose,
 * usually because it should not be there, and resurrecting it because
 * another clone fixed a typo in the meantime is the wrong way to lose
 * that argument. The edit is still in history (M3), so the text is
 * recoverable if the deletion was the mistake.
 *
 * Two edits to the same comment fall back to the later `updated_at`,
 * matching M2.
 */
export function mergeComments<T extends MergeableComment>(
  local: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();

  for (const c of [...local, ...incoming]) {
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, c);
      continue;
    }
    // Deletion wins regardless of timestamps.
    if (existing.deleted === true) continue;
    if (c.deleted === true) {
      byId.set(c.id, c);
      continue;
    }
    const a = existing.updated_at ?? existing.created_at ?? "";
    const b = c.updated_at ?? c.created_at ?? "";
    if (b > a) byId.set(c.id, c);
  }

  // Chronological by creation, so a merged thread reads in order.
  return [...byId.values()].sort((x, y) =>
    (x.created_at ?? "") < (y.created_at ?? "") ? -1 : 1,
  );
}

/**
 * Derives key counters from the tasks that actually exist (M1).
 *
 * Counters are deliberately **not** merged arithmetically. Taking the
 * max under-reserves: base 5, one clone creates 3 and the other 8, and
 * `max` gives 13 for 11 new tasks — so the rekey pass then reissues keys
 * that already exist. Summing over-reserves and still needs a base
 * commit to know the deltas.
 *
 * Deriving from the merged task set cannot disagree with what is on
 * disk, needs no base, and gives both clones the same answer from the
 * same inputs — which is what makes sync converge.
 *
 * `prefix` comes from the incoming state where present, since a prefix
 * change is a deliberate operation (`set-prefix`) rather than an
 * incidental edit. Projects present in either state are kept, so a
 * project created on one side does not vanish.
 */
export function deriveKeyState(
  local: LocttState,
  incoming: LocttState,
  tasks: readonly Task[],
): LocttState {
  const highest = new Map<string, number>();
  for (const t of tasks) {
    const project = t.frontmatter.project;
    if (project === undefined) continue;
    // The number is whatever follows the prefix; a key that does not
    // parse contributes nothing rather than poisoning the counter.
    const match = /(\d+)$/.exec(t.frontmatter.key);
    if (!match?.[1]) continue;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) continue;
    highest.set(project, Math.max(highest.get(project) ?? 0, n));
  }

  const keys: LocttState["keys"] = {};
  for (const project of new Set([
    ...Object.keys(local.keys),
    ...Object.keys(incoming.keys),
  ])) {
    const l = local.keys[project];
    const i = incoming.keys[project];
    const prefix = i?.prefix ?? l?.prefix ?? "";
    // One past the highest key in use. Never below either side's
    // recorded counter: a task created and then deleted still consumed
    // its number, and reissuing it would collide with a key someone may
    // still be holding in `key_history`.
    const derived = (highest.get(project) ?? 0) + 1;
    const floor = Math.max(l?.next_number ?? 1, i?.next_number ?? 1);
    keys[project] = { prefix, next_number: Math.max(derived, floor) };
  }

  return {
    keys,
    ...(local.retired_keys !== undefined || incoming.retired_keys !== undefined
      ? { retired_keys: { ...local.retired_keys, ...incoming.retired_keys } }
      : {}),
  };
}

/**
 * Gives every project a distinct prefix, inventing provisional ones
 * where two collide.
 *
 * Two independently-`init`ed trackers both mint `T-`, so merging them
 * produces two projects claiming the same key space — a state the rest
 * of the codebase believes impossible, since `createProject` enforces
 * uniqueness. Rekeying alone cannot fix it: allocating the next number
 * from a shared prefix just produces another collision.
 *
 * The project with the earlier `created_at` keeps the prefix (ties
 * broken by id, so both clones agree). The others get `<PREFIX>2-`,
 * `<PREFIX>3-`… — deliberately ugly, because it is meant to be replaced
 * by `loctt project set-prefix` rather than lived with.
 */
export function assignProvisionalPrefixes(
  projects: readonly { id: string; prefix: string; created_at?: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();

  const ordered = [...projects].sort((a, b) => {
    const cmp = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });

  for (const p of ordered) {
    if (!taken.has(p.prefix)) {
      taken.add(p.prefix);
      out.set(p.id, p.prefix);
      continue;
    }
    // Find the first free variant. The trailing separator of the
    // original prefix is preserved, so `T-` becomes `T2-`, not `T-2`,
    // which would look like a key.
    const base = p.prefix.replace(/[^A-Za-z0-9]+$/, "");
    const sep = p.prefix.slice(base.length);
    let n = 2;
    let candidate = `${base}${String(n)}${sep}`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base}${String(n)}${sep}`;
    }
    taken.add(candidate);
    out.set(p.id, candidate);
  }

  return out;
}

/**
 * Unions a config list keyed by entry id (projects, queries).
 *
 * Both sides may have added entries; neither addition should be lost.
 * An entry present on both with different content takes the incoming
 * one — these are small, hand-edited config records where the last
 * write is the intended one, and unlike a task body there is no prose
 * to preserve.
 */
export function mergeById<T extends { id: string }>(
  local: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const e of local) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()];
}
