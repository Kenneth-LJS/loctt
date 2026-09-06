# Phase Z — Correctness findings: `packages/core/src/config/` + `packages/core/src/state/`

Read-only review. Scope: config loaders/writers + tolerant-collect machinery
(health.ts, collectValidEntries, brokenEntriesToPlain), workflow-write
(remap, journal recovery), validation.ts; and state/ (state.yaml, key-index,
key allocation, journal, reconcile, locks, staged-swap).

Bar applied: each finding names file:line, a concrete failing scenario, and
why existing tests miss it. Two are confirmed with a scratch repro that goes
red against the current code (repros were run in the scratchpad and removed;
they are reproduced inline below). Findings are ordered by severity.

---

## Finding 1 — [HIGH] Crash recovery of a `stagedSwap` that CREATED new files leaves the new files orphaned (rollback silently no-ops)

**File:** `packages/core/src/state/staged-swap.ts:236` (`recoverStagedSwap`)

**What the code does.** On the live path, `stagedSwap` writes a backup **only**
for destinations that already existed:

```ts
// staged-swap.ts:136-138
for (const s of staged) {
  if (hadOriginal.has(s.dest)) await copyFile(s.dest, s.backup);
}
```

A destination with `had_original: false` therefore has **no backup file on
disk** — by design (rollback of a created file means *delete it*, not restore).
The live `rollback` handles this correctly:

```ts
// staged-swap.ts:197-199
} else {
  // Nothing was there before this op, so "restored" means gone.
  await rm(s.dest, { force: true });
}
```

But the **boot recovery** path gates the delete on the backup existing:

```ts
// staged-swap.ts:236-238
} else if (await fileExists(f.backup)) {   // had_original === false
  await rm(f.dest, { force: true });
}
```

For a `had_original: false` file, `f.backup` **never exists**, so this branch
is dead: `recoverStagedSwap` never deletes a newly-created destination that was
swapped into place before the crash.

**Concrete failing scenario (test-writable).** Reproduce the real on-disk state
a crash leaves — a created destination and a backup dir with **no** backup file
for it (because the live code never writes one):

```ts
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverStagedSwap } from "./staged-swap.js";

const dir = await mkdtemp(join(tmpdir(), "swap-repro-"));
const base = join(dir, "local", "swap", "01REAL");
const backupDir = join(base, "backup");
await mkdir(backupDir, { recursive: true });          // NO backup/0 written — matches real stagedSwap
const dest = join(dir, "created.md");
await writeFile(dest, "orphan-content", "utf-8");     // swapped into place before crash

await recoverStagedSwap(dir, {
  id: "01REAL",
  swap: { base_dir: base, files: [{ dest, backup: join(backupDir, "0"), had_original: false }] },
});

// Intended: created.md is GONE (rolled back). Actual: it survives.
let stillThere = true;
try { await readFile(dest, "utf-8"); } catch { stillThere = false; }
// stillThere === true  → FAILS the "or none of them" contract
```

Run confirmed: the created file survives recovery. `readFile` succeeds after
`recoverStagedSwap`, i.e. the orphan is left behind.

**Blast radius.** `stagedSwap` is called by `backup/restore.ts:664`, where a
restore writes task files that **do not currently exist** (`had_original:
false`). A restore interrupted after some new task files are swapped in but
before completion will, at next boot, roll back the destinations that had
originals and **leave the newly-restored task files orphaned** — a partially
restored tracker, which is precisely the invisible half-applied state the
module's own header ("Applies every write, or none of them") exists to
prevent. `task/bulk.ts` is less exposed (bulk edits target existing files), but
any bulk op that creates a file hits the same gap.

**Why existing tests miss it.** `staged-swap.test.ts:214` ("removes a file the
interrupted op had created") passes only because its fixture **manufactures a
backup file the real code never writes**:

```ts
// staged-swap.test.ts:219-220
// A marker backup so recovery can tell the op got this far.
await writeFile(join(backupDir, "0"), "", "utf-8");
```

`stagedSwap` writes no such marker for a `had_original: false` file (line
136-138 skips it). The test asserts the correct outcome against an on-disk
state that cannot occur in production, so the guard on line 236 stays green
while being wrong. This is the CLAUDE.md "a test asserting the bug" pattern:
the fixture encodes an impossible precondition that makes the buggy branch
look reachable.

**Suggested fix direction (not applied):** in `recoverStagedSwap`, for
`had_original: false`, delete the destination unconditionally (mirroring the
live `rollback`), rather than gating on a backup that is never written. Update
the test to build the fixture from a real `stagedSwap` interruption (no marker
backup).

---

## Finding 2 — [MEDIUM-HIGH] A broken saved view loses its `sort` / `display` / `archived` on any unrelated `queries.yaml` write (K28 preservation is incomplete for queries)

**File:** `packages/core/src/config/queries.ts:135-137` (`serializeBrokenQuery`),
schema `packages/contracts/src/query.ts:89-96` (`BrokenSavedQuerySchema`)

**What the code does.** Unlike every other config type, the queries loader
degrades a broken entry into a **typed struct** (`BrokenSavedQuery`) that
carries only `{ id, name, query, error, position, index }` — it does **not**
carry `sort`, `display`, or `archived`. The preserve-on-write path re-emits a
broken sibling from that struct:

```ts
// queries.ts:135-137
function serializeBrokenQuery(b: BrokenSavedQuery): Record<string, unknown> {
  return { id: b.id, name: b.name, query: b.query };
}
```

A broken saved view is one whose **schema is valid** (id/name/query/sort/
display/archived all parsed) but whose **DSL string** does not parse
(`queries.ts:63-80`). So `sort`, `display`, and `archived` were present on disk
— and are silently dropped the next time anything rewrites `queries.yaml`.

Contrast the other six config types, which degrade via `BrokenEntry.rawText`
(the entry's full YAML) and re-emit with `brokenEntriesToPlain`
(`health.ts:77-94`) — those preserve **all** fields. Queries is the one that
reconstructs from a lossy typed struct.

**Concrete failing scenario (test-writable).** `queries.yaml` with a valid view
and a second view that has a broken DSL but a full `sort`/`display`/`archived`:

```yaml
queries:
  - id: good
    name: Good
    query: 'status = open'
  - id: bad
    name: Bad
    query: 'status = = ='      # broken DSL, schema still valid
    archived: true
    sort:
      - field: created_at
        direction: desc
    display:
      mode: board
```

```ts
const loaded = await loadQueriesConfig(dir);   // loaded.broken.length === 1
await saveQueriesConfig(dir, loaded);          // an unrelated write (edit/add/archive any view)
const after = await readFile(queriesYamlPath, "utf-8");
// after does NOT contain "archived: true", "mode: board", or "created_at"
```

Run confirmed: after the write, the `bad` entry on disk is exactly
`{id, name, query}` — its `archived`, `sort`, and `display` are gone.

**Reachability.** `saveQueriesConfig` runs on every saved-view create, edit,
archive, and delete — the whole file is rewritten each time. A user with one
hand-broken view (a typo in its DSL) loses that view's board/columns/sort
config and its archived flag the moment they touch any *other* view, so when
they later fix the typo the view comes back in default display mode. This is
the same data-loss class K28 set out to close ("a writer dropping a broken
sibling it didn't touch"); it is closed for the object-shaped configs and left
open here because the broken carrier is a narrower struct.

**Why existing tests miss it.** `queries.test.ts` exercises preservation of a
broken entry's `id/name/query` round-trip, but no test seeds a broken query
that *also* carries `sort`/`display`/`archived` and asserts those survive a
save. Because `BrokenSavedQuery` has no field for them, there is nothing for a
round-trip test to compare against — the loss is invisible unless a test starts
from raw YAML on disk (as the repro above does) rather than from a
`QueriesConfig` object.

**Suggested fix direction (not applied):** either widen `BrokenSavedQuery` to
carry the raw entry (or its extra fields) and re-emit them, or switch queries
to the `BrokenEntry.rawText` + `brokenEntriesToPlain` mechanism the other six
configs use.

---

## Finding 3 — [LOW-MEDIUM] `saveWorkflowConfig` can write a duplicate key when a preserved broken entry collides with a newly-valid entry, bypassing `validateWorkflowConfig`

**File:** `packages/core/src/config/workflow-write.ts:111-116` (`saveWorkflowConfig`)
+ `143-157` (`mergeBrokenIntoPlain`)

**What the code does.** `saveWorkflowConfig` validates the *valid-only* config
(`assertWorkflowConfigValid(config)` → `validateWorkflowConfig`, which forbids
duplicate keys) and only **after** validation merges the re-read on-disk broken
sub-entries into the write object:

```ts
// workflow-write.ts:111-115
const broken = await readOnDiskBroken(locttDir);
await writeYamlAtomically(
  getWorkflowConfigPath(locttDir),
  mergeBrokenIntoPlain(buildPlainObject(cleaned), broken),
);
```

`mergeBrokenIntoPlain` appends broken entries to each sub-list
**unconditionally** — it does not check whether the valid list already contains
that key:

```ts
// workflow-write.ts:150-154
const extra = brokenEntriesToPlain(broken[key]);
if (extra.length === 0) continue;
const existing = Array.isArray(plain[key]) ? plain[key] as unknown[] : [];
plain[key] = [...existing, ...extra];
```

**Concrete scenario.** `workflow.yaml` on disk has a status `done` that is
*broken* (e.g. `category: bogus`) — it is set aside in `broken.statuses` and is
invisible to the Settings form (per the K28-WF note: "the client cannot
resubmit broken entries it never rendered"). The user, through the Settings
form, adds a **valid** status also keyed `done`. `applyWorkflowEdit` →
`executeWorkflowRemap` → `saveWorkflowConfig(next)` where `next.statuses`
contains a valid `done`. Validation runs on the valid-only set (no duplicate,
passes), then the broken `done` is appended. The file now has **two** entries
keyed `done`. On the next tolerant read, `collectValidEntries` yields both — a
valid `done` and a broken `done` — and `validateWorkflowConfig` (only reached
via a *write* or `doctor`) is never consulted on the merged result, so nothing
in the load path flags the collision.

**Severity rationale.** Lower than Findings 1–2: no data is lost (both entries
are preserved), the config still loads, and `loctt doctor` will report the
duplicate. But it lets a write introduce a state that `validateWorkflowConfig`
is specifically supposed to prevent, and it does so **after** the validation
gate — the invariant "a write never persists a config `doctor` would flag"
(workflow.ts:113-114) is violated for exactly the broken-collision case. It is
recorded here as a real gap in the K28-WF merge, not a blocker.

**Why existing tests miss it.** `workflow-write.test.ts` covers preservation of
non-colliding broken entries; no test adds a *valid* entry whose key equals a
preserved *broken* entry's key and inspects the written file for a duplicate.

---

## Areas checked and found sound (no finding)

- **`state/keys.ts` allocateKey / counter integrity** — mutate-in-place then
  caller persists; CLI/MCP/web all wrap `loadState → createTask → saveState`
  in `withStateLock` (`apps/cli/src/commands/task-crud.ts:113-137`). Note: the
  task file is written (`task/create.ts:206`) before the caller's `saveState`,
  so a crash in that window would leave the counter behind and re-issue the key
  on the next create. This spans `task/create.ts` (outside the strict
  config/state scope) and has no journal; I did not develop it into a finding
  because the reissue requires a crash between two awaits inside one lock and
  the durability model here is documented as trust-the-filesystem (P-11/P-12,
  "V6 closes the crash half" refers to the multi-file swap, not single-task
  create). Flagging for awareness rather than as a confirmed defect.
- **`state/lock.ts`** — non-reentrancy guard via AsyncLocalStorage, TOCTOU
  re-check of migration lock after acquire, ELOCKED→retry mapping, release in
  `finally`. Sound. The documented `setTimeout`-under-lock edge is called out
  in-source.
- **`state/journal.ts`** — unreadable/unparseable/shape-mismatch all throw
  (`JournalUnreadableError`) rather than discarding in-flight work; recovery is
  idempotent per handler; `replayTaskRemapStrict` correctly restores
  all-or-nothing for the four non-project deletes.
- **`config/health.ts` collectValidEntries / brokenEntriesToPlain** — correct;
  skips unparseable rawText rather than corrupting a write. The lossy carrier is
  queries' own typed struct (Finding 2), not this helper.
- **`config/list-view.ts` scalar-chip variant** — `ListViewConfigSchema`
  includes `broken` and is `.strict()`, so `saveListViewConfig`'s
  `.parse(config)` preserves rather than strips the broken chips;
  `partitionBrokenChips` re-splits by label prefix. `pruneListViewForRemoved…`
  carries `broken` through. Sound.
- **projects / labels / sprints / milestones / calendar writers** — all use
  `brokenEntriesToPlain` (full-rawText preservation); round-trip is idempotent.
  A valid/broken **id** collision is possible (same shape as Finding 3) but is
  doctor-flagged and lossless; not developed separately.
- **`config/validation.ts`** — duplicate-key, board-status-dangling, and
  inverse-collision checks correct; `labels`-shape-before-membership guard
  correct.
- **`state/reconcile.ts`, `state/sync.ts`, `state/key-index.ts`** — parse/
  serialize round-trips sound; `rebuildKeyIndex` writes history before live so
  a live key wins.

---

## Summary

| # | Severity | File | One line |
|---|---|---|---|
| 1 | HIGH | `state/staged-swap.ts:236` | Crash recovery leaves newly-created files orphaned (backup-existence guard is dead for `had_original:false`); test hides it with an impossible fixture |
| 2 | MEDIUM-HIGH | `config/queries.ts:135` | Broken saved view loses `sort`/`display`/`archived` on any unrelated write (K28 preservation incomplete for queries) |
| 3 | LOW-MEDIUM | `config/workflow-write.ts:143` | Broken-vs-valid key collision writes a duplicate key past the validation gate |
