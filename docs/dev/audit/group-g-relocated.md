# Group G, re-located — 2026-09-02

The itemised list was written 2026-08-17 and Phase 5 rewrote much of
the code beneath it. This pass re-checks all 55 against the current
tree before anyone works from them.

**Why it was needed.** On a first sample of 8, **five line references
had drifted** and one finding was **already fixed**. Working from stale
references is how an agent edits the wrong line with confidence.

## What changed

| Outcome | Count |
|---|---|
| Line reference drifted (finding still valid) | see per-item notes |
| **Already fixed since the audit** | 1 confirmed |
| **Claim no longer true** — the code gained real consumers | 4 |
| **Mis-categorised — a real defect, not cosmetic** | 1 confirmed, more likely |

### Already fixed — drop from the list

- **`loadOptionalConfigs` swallows the reason a config failed to load**
  (`config/index.ts`). Now distinguishes ENOENT from malformed, and its
  comment describes this exact finding. Closed, not deferred.

### No longer true — the "dead" exports have callers

Four `dead-code` rows were written when nothing called these. Phase 5
gave them consumers, so deleting them now would break the build:

| Export | Now called from |
|---|---|
| `evenlySpacedRanks` | `rank/board-move.ts:185`, `rank/reorder.ts` |
| `REBALANCE_LENGTH_THRESHOLD` | `rank/board-move.ts:181` |
| `parseConfigValue` | `config/router.ts:175` |
| `SlugKey` | `contracts/projects.ts:32` |
| `StructuralCycle` | `task/traversal.ts:112,172,173` |

Still genuinely unreferenced: **`MergeConflict`** (`git/merge.ts:30` —
one hit, its own declaration), **`TreeIndex`**, **`SprintKey`** and
**`SYSTEM_MUTABLE_VIA`** (re-exported through barrels, called nowhere).

### `buildTree` is not dead — it is duplicated

Core's `buildTree` still has no caller, but the web **built its own**
at `client/relationships/tree.ts` rather than using it. Measured: they
do different jobs — core's is server-side traversal, the web's builds a
display tree from an already-cached `/api/tasks` response, with a
path-based cycle guard REL-21 requires. So this is not a deletion; it
is the fifteenth instance of the pattern this run keeps finding, and
the decision is whether core's should exist at all.

### Mis-categorised — a real bug filed as cosmetic

**`evaluateTextAlias` (`query/evaluator.ts`)**, filed `abstraction`.
Measured through the CLI on a two-task tracker:

```
text ~ "alpha"   -> 1 match
text != "alpha"  -> 1 match
text = "alpha"   -> 1 match     <- substring, not equality
text > "alpha"   -> 1 match     <- greater-than on free text
```

`text > "alpha"` is accepted and matches. Nothing rejects a nonsense
operator on the text alias, and `=` behaves as a substring test. This
is a correctness defect on a user-facing query surface and belongs in a
gated batch, not a tidy-up.

### Confirmed still open

- **`readTask` has no error translation** (`task/io.ts:17`) — a missing
  task still surfaces a raw ENOENT. Touches all three surfaces.

## The lesson for the batches

Category labels from August are not a safe basis for scope. Of eight
sampled, one was fixed, four "dead" exports were alive, and one
"abstraction" was a bug. **Verify each item against the code as the
first step of its batch**, not from this table.


## Batch-by-batch outcome (2026-09-02)

Verified item by item as each batch came up, rather than from the
August table. The result is the argument for doing it that way.

| Batch | Items | Fixed | Needed no change |
|---|---|---|---|
| cli + mcp | 7 | 4 | 3 (all already fixed) |
| contracts | 7 | 3 | 4 |
| query + rank | 9 | 3 | 6 |
| config + schema | 7 | 2 | 5 |
| git | 11 | 2 | 8 (4 already fixed) |
| task | 14 | 4 | 10 |
| **total** | **55** | **18** | **36** |

**Two thirds of Group G needed no change.** Not because the audit was
careless — it was accurate in August — but because Phase 5 rewrote the
code underneath it and nobody closed the rows. Ten findings were
already fixed; five "dead" exports had gained callers; and several
were simply wrong when re-measured.

**What the verification caught that a batch edit would not:**

- `UserSettings` `.passthrough()` is **load-bearing**. Every settings
  panel saves `{...stored, ...next}`, so `.strict()` would reject a key
  one panel does not know about *on save* — editing a card layout
  would destroy sidebar pins. "Fixing" that finding would have caused
  data loss.
- Five rank/config exports called dead now have real callers.
  Deleting them would have broken the build.
- `laterWins` "only ever called with `T = Task`" is false — the tests
  instantiate it at `T = string`.
- `evaluateTextAlias` "returns nonsense for every operator" — the bare
  spelling errors cleanly; the documented `fields.<key>` form works. An
  earlier probe of mine misread an *error's* zero rows as a silent
  no-match.

**What the fixes were actually worth:** three were latent bugs of the
same shape — a field list written twice, where adding a field to one
copy and forgetting the other loses data silently.
`projectTaskFrontmatter` (the CLI's JSON, MCP output and web API at
once), `saveProjectsConfig` (a config value), and the archive triple
across three call sites. None was filed as a bug; all three were filed
as "duplication".

**And one hole the refactoring exposed rather than fixed**: sharing the
archive mutation revealed that `bulkArchive` never asserted
`archived_at` — 15 tests passed with the field dropped.
