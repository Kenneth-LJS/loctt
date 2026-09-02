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

export interface MergeOutcome<T> {
  readonly merged: T;
  /**
   * Set when a value was displaced by last-write-wins and the loser is
   * worth keeping (M4). The caller writes it beside the file.
   */
  readonly displaced?: { readonly label: string; readonly content: string };
  /**
   * `merge_resolved` entries for fields the merge could not resolve from
   * history and had to settle by whole-record recency. The caller
   * appends them to `_history.yaml`, so a fallback is auditable rather
   * than a silent choice between two values.
   */
  readonly historyAdditions?: readonly HistoryEntry[];
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
  /**
   * The union of both sides' history entries (M2). Frontmatter carries
   * no per-field timestamps — `updated_at` is stamped per write — but
   * history does: every `field_change` names its field and when it
   * happened, and `created` carries the whole initial frontmatter (M3).
   * So the winning value for a field is the latest entry naming it, and
   * a field only one side touched keeps that side's value rather than
   * being dropped because a *different* field was contested.
   *
   * History is the merge's only evidence. A hand-edit writes none, so a
   * field it cannot explain falls back to whole-record recency for that
   * field alone — see decisions.md, "M2 scope".
   */
  mergedHistory: readonly HistoryEntry[] = [],
): MergeOutcome<Task> {
  const lf = local.frontmatter;
  const inf = incoming.frontmatter;

  // Whole-record recency. Still the rule for the body, and the fallback
  // for any field history cannot explain.
  const winner = laterWins(local, incoming, lf.updated_at, inf.updated_at);
  const loser = winner === local ? incoming : local;

  const resolved = resolveFieldsFromHistory(local, incoming, winner, mergedHistory);

  const frontmatter: Task["frontmatter"] = {
    ...winner.frontmatter,
    ...resolved.fields,
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
  const additions = resolved.fallbacks.length > 0
    ? { historyAdditions: resolved.fallbacks }
    : {};

  // Only worth preserving when the loser's body is actually different
  // and non-empty — writing a sibling file for an identical body is
  // noise the user has to dismiss.
  if (loser.body.trim().length > 0 && loser.body !== winner.body) {
    return {
      merged,
      ...additions,
      displaced: {
        label: winner === local ? "incoming" : "local",
        content: loser.body,
      },
    };
  }
  return { merged, ...additions };
}

/**
 * Fields the two sides disagree on, resolved one at a time from history.
 *
 * Only scalar frontmatter: `relationships` and `key_history` are sets
 * with their own union rules, and the identity fields never differ
 * between two versions of one task.
 */
const NON_SCALAR_FIELDS: ReadonlySet<string> = new Set([
  "relationships", "key_history", "id", "created_at", "updated_at",
]);

function resolveFieldsFromHistory(
  local: Task,
  incoming: Task,
  winner: Task,
  history: readonly HistoryEntry[],
): { fields: Record<string, unknown>; fallbacks: HistoryEntry[] } {
  const lf = local.frontmatter as unknown as Record<string, unknown>;
  const inf = incoming.frontmatter as unknown as Record<string, unknown>;
  const wf = winner.frontmatter as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const fallbacks: HistoryEntry[] = [];

  const contested = [...new Set([...Object.keys(lf), ...Object.keys(inf)])].filter(
    k => !NON_SCALAR_FIELDS.has(k) && !Object.is(lf[k], inf[k]),
  );
  if (contested.length === 0) return { fields, fallbacks };

  // `created` carries the whole initial frontmatter (M3), so it is the
  // earliest evidence for every field the task was born with. Without
  // it, a field never edited since creation looks unexplained.
  const born = history.find(e => e.kind === "created");
  const initial = ((born?.after as { frontmatter?: Record<string, unknown> } | undefined)
    ?.frontmatter) ?? {};

  for (const field of contested) {
    let latest: { timestamp: string; value: unknown } | undefined;
    if (born !== undefined && field in initial) {
      latest = { timestamp: born.timestamp, value: initial[field] };
    }
    for (const e of history) {
      if (e.field !== field) continue;
      if (e.kind !== "field_change" && e.kind !== "custom_field_change") continue;
      // Strictly later: a tie keeps the earlier-scanned entry, so two
      // clones scanning the same union agree.
      if (latest === undefined || e.timestamp > latest.timestamp) {
        latest = { timestamp: e.timestamp, value: e.after };
      }
    }

    if (latest !== undefined) {
      fields[field] = latest.value;
      continue;
    }

    // Unexplained: a hand-edit, or a task predating M3. Resolve by
    // whole-record recency for this field alone and say so in history,
    // or the losing value is only recoverable by reading both clones.
    const won = wf[field];
    const lost = winner === local ? inf[field] : lf[field];
    fields[field] = won;
    fallbacks.push({
      timestamp: winner.frontmatter.updated_at,
      kind: "merge_resolved",
      field,
      before: lost ?? null,
      after: won ?? null,
      meta: { took: winner === local ? "local" : "incoming", reason: "no history for field" },
    });
  }

  return { fields, fallbacks };
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
  const unkeyed: HistoryEntry[] = [];
  for (const e of [...local, ...incoming]) {
    // An entry with no timestamp cannot be de-duplicated: its key would
    // be "\0\0\0", so every such entry across both sides collapses into
    // one and the rest are dropped. That is real data loss, and it
    // happens before any ordering question — so a timestamp-less entry
    // is treated as never equal to anything and always kept (V2/P-11).
    if (typeof e.timestamp !== "string" || e.timestamp.length === 0) {
      unkeyed.push(e);
      continue;
    }
    const key = [e.timestamp, e.kind, e.actor ?? "", e.field ?? ""].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  // Appended rather than sorted in: there is no key to sort them by,
  // and inventing a position would be a claim about when they happened.
  out.push(...unkeyed);
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
    // `?? ""` produced an empty prefix when neither side recorded one,
    // and the derived state is written to state.yaml without a schema
    // pass — so a tracker could end up unable to boot, from a sync that
    // reported success. Both sides missing a prefix for a project that
    // exists in the key map is a state we cannot repair by guessing, so
    // it is refused rather than papered over.
    const prefix = i?.prefix ?? l?.prefix;
    if (prefix === undefined || prefix === "") {
      throw new Error(
        `cannot derive key state for project '${project}': neither side `
        + `records a key prefix. Fix the prefix in state.yaml on one side `
        + `and sync again.`,
      );
    }
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
 * The project with the smaller id keeps the prefix; the others get
 * `<PREFIX>2-`, `<PREFIX>3-`… — deliberately ugly, because they are
 * meant to be replaced by `loctt project set-prefix` rather than lived
 * with.
 *
 * Ordering by id *is* ordering by creation: a ULID sorts
 * lexicographically by mint time. An earlier version sorted on
 * `created_at`, which `ProjectDef` does not have — `ProjectDefSchema` is
 * `.strict()` with id/name/prefix/archived — so the comparison was
 * always between two empty strings and only the id tiebreak ever ran.
 * Adding the field to make that sort work would violate P-1; the id is
 * the timestamp.
 */
export function assignProvisionalPrefixes(
  projects: readonly { id: string; prefix: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();

  // Deterministic across clones: two of them merging the same set must
  // reach the same assignment, or they diverge permanently.
  const ordered = [...projects].sort((a, b) => a.id.localeCompare(b.id));

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
 * The slug half of {@link assignProvisionalPrefixes} (K3, A60).
 *
 * Two clones that each ran `loctt init` mint the same slug — both
 * projects are called "Tasks", so both derive `tasks` — with different
 * ULIDs. The union of the two lists then holds one slug twice, which
 * `ProjectsConfigSchema` rejects, and the merged file cannot be loaded
 * at all. Same failure as the prefix collision above, same fix.
 *
 * The project with the smaller id keeps the slug; the others get
 * `<slug>-2`, `<slug>-3`… A project with no slug (pre-K3) is left
 * alone — it has nothing to collide with.
 *
 * Ordering by id is ordering by mint time, and it is what makes two
 * clones merging the same set reach the same answer instead of
 * diverging permanently.
 */
export function assignProvisionalSlugs(
  projects: readonly { id: string; slug?: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const ordered = [...projects].sort((a, b) => a.id.localeCompare(b.id));

  for (const p of ordered) {
    if (p.slug === undefined) continue;
    if (!taken.has(p.slug)) {
      taken.add(p.slug);
      out.set(p.id, p.slug);
      continue;
    }
    let n = 2;
    let candidate = `${p.slug}-${String(n)}`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${p.slug}-${String(n)}`;
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
 * An entry present on both with different content keeps the **local**
 * version.
 *
 * This used to take the incoming one, on the reasoning that these are
 * small hand-edited records where the last write is the intended one.
 * That left `projects.yaml` merging its two halves in opposite
 * directions: the list was incoming-wins here while the surrounding
 * scalars (`default`) were local-wins in `resolveConflicts`. One file
 * cannot coherently follow two policies — a sync could repoint your
 * default project *and* rewrite the project it now points at, each by a
 * different rule.
 *
 * Local-wins is the rule the user settled on (2026-08-16), and it is the
 * safer default for the same reason it applies to the scalars: a sync is
 * something you run to bring work in, not something that should silently
 * replace what is in front of you.
 */
export function mergeById<T extends { id: string }>(
  local: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  // Incoming first, so a local entry with the same id overwrites it.
  for (const e of incoming) byId.set(e.id, e);
  for (const e of local) byId.set(e.id, e);
  return [...byId.values()];
}
