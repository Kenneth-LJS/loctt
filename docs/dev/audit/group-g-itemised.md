## Group G, itemised — 2026-08-17

The group was carried as "~79 cosmetic items" with no list anywhere, so
it could never be audited or closed. Extracted from the eight slice
reports, which do carry a `Category` per finding.

**The real count is 55, not 79.** The 122 parsed findings break down as:


| Category | Count | Cosmetic? |
|---|---|---|
| bug | 57 | no |
| abstraction | 18 | yes |
| duplication | 14 | yes |
| comment | 13 | yes |
| dead-code | 7 | yes |
| layering | 6 | no |
| doc-drift | 4 | no |
| naming | 3 | yes |

The 57 `bug` findings are the ones groups A–F closed. `layering` (6) and
`doc-drift` (4) are not cosmetic and are **not** in Group G — they are
unresolved and unclassified, which is a gap in the record rather than a
deferral.

### The 55

Each row is `slice · category · file`. Full text is in the named slice
report under a matching heading.

| Slice | Category | File | Finding |
|---|---|---|---|
| 1a | abstraction | `packages/core/src/task/duplicate.ts:88-97` | `duplicateTask` calls `inherit()` twice per field across eleven fields |
| 1a | abstraction | `packages/core/src/task/frontmatter.ts:16-18` | `frontmatter.ts` re-derives the known-key set but `serializeFrontmatter` still enumerate… |
| 1a | abstraction | `packages/core/src/task/io.ts:16-22` | `readTask` has no error translation, so a missing task surfaces a raw ENOENT |
| 1b | abstraction | `packages/core/src/task/traversal.ts:288-299` | `findStructuralCycles` mutates frames through repeated inline casts |
| 1b | abstraction | `packages/core/src/task/show.ts:103-125` | `resolveRelationships` issues one disk read per edge, unbounded |
| 2 | abstraction | `packages/core/src/git/publish-sync.ts:608-616` | `resolveConflicts` runs twice over every path to resolve one file |
| 2 | abstraction | `packages/core/src/git/publish-sync.ts:238-259` | `pruneEmptyDirs` walks paths that were never deleted |
| 2 | abstraction | `packages/core/src/git/publish-sync.ts:623-626` | `applyPlan` copies a path that `applyResolution` immediately overwrites |
| 2 | abstraction | `packages/core/src/git/three-way.ts:179` | `LOCAL_OWNED` is checked against both the full path and its top segment; `NEVER_MIRROR` … |
| 2 | abstraction | `packages/core/src/git/merge.ts:54-61` | `laterWins` is generic but only ever called with `T = Task` |
| 3 | abstraction | `packages/core/src/config/workflow-write.ts:191-220` | `validateRemapCoversDeletions` inlines the relationship case rather than generalising |
| 3 | abstraction | `packages/core/src/config/index.ts:113-131` | `loadOptionalConfigs` swallows the reason a config failed to load |
| 3 | abstraction | `packages/core/src/config/workflow-write.ts:672-674` | `makeJournalEntryId` is a single-line wrapper around `ulid()` |
| 4 | abstraction | `packages/core/src/query/evaluator.ts:262-320` | `evaluateTextAlias` returns nonsense for every operator except `~` |
| 4 | abstraction | `packages/core/src/query/parser.ts:249-256` | `close` is captured before `expect("RPAREN")` in `parseCallArgs`, making the arity error… |
| 7 | abstraction | `packages/contracts/src/task.ts:51-73` | Every entity id is a bare `string`, so cross-entity ids swap without a type error |
| 7 | abstraction | `packages/contracts/src/workflow.ts:54-58` | `defaultStatus`'s fallback contradicts the rule its own comment cites |
| 7 | abstraction | `packages/contracts/src/users.ts:102` | `UserSettings` is `.passthrough()` while every sibling user schema is `.strict()` |
| 1a | comment | `packages/core/src/task/create.ts:18-21` | `createTask`'s project parameter is documented as a project *key*; the code and every ca… |
| 1a | comment | `packages/core/src/task/update.ts:320-325` | `assertUnsettable`'s contract names `bulkUnsetField`, which was deliberately never built |
| 1a | comment | `packages/core/src/task/bulk.ts:171-215` | `bulkDelete` writes no history and `bulkArchive` does — divergence is correct, but the M… |
| 1b | comment | `packages/contracts/src/history.ts:10` | `contracts/history.ts` comment contradicts the code after M3 |
| 2 | comment | `packages/core/src/git/three-way.ts:5-22` | `three-way.ts`'s header comment describes a layering that no longer holds |
| 4 | comment | `packages/core/src/query/list.ts:96-113` | Triplicated comment block in `buildListContext` |
| 4 | comment | `packages/core/src/query/parser.ts:224-243` | `parseCallArgs` accepts bare `FIELD` args, contradicting its own docstring |
| 4 | comment | `packages/core/src/query/list.ts:143-146` | `list.ts` docstring describes an `offset` that is not on `ListTasksOptions` |
| 4 | comment | `packages/core/src/rank/lexorank.ts:134-140` | `midpointAfter`'s docstring is not a description of what it does |
| 7 | comment | `packages/contracts/src/history.ts:10` | `history.ts` doc comments contradict decision M3, which is built |
| 7 | comment | `packages/core/src/config/workflow.ts:22-24` | `parseWorkflowConfig`'s comment misstates why uniqueness lives in core |
| 8 | comment | `apps/cli/src/runtime/errors.ts:95-97` | `KNOWN_DOMAIN_ERRORS` omits `RelationshipError` by comment rather than by fact |
| 8 | comment | `apps/cli/src/index.ts:86-89` | `index.ts`'s comment justifies the unwrapped dispatch with a false premise |
| 1a | dead-code | `packages/core/src/task/update.ts:51` | Two exports on `@loctt/core` with zero consumers: `SYSTEM_MUTABLE_VIA` and the `IMMUTABL… |
| 1b | dead-code | `packages/core/src/task/traversal.ts:73-123` | `buildTree` / `TreeIndex` / `StructuralCycle` are exported but unused |
| 2 | dead-code | `packages/core/src/git/merge.ts:29-33` | `MergeConflict` is declared and never used |
| 3 | dead-code | `packages/core/src/config/router.ts:83` | `parseConfigValue` is exported but reachable only through `setConfigValue` |
| 3 | dead-code | `packages/core/src/schema/migrate.ts:152-158` | Migration-ordering guard is unreachable as written |
| 4 | dead-code | `packages/core/src/rank/index.ts:1-9` | `MIN` / `MAX` / `INITIAL` / `evenlySpacedRanks` / `REBALANCE_LENGTH_THRESHOLD` are expor… |
| 7 | dead-code | `packages/contracts/src/brands.ts:24` | `SlugKey` and `SprintKey` are dead public exports whose docs contradict P-1 |
| 1a | duplication | `packages/core/src/task/update.ts:149-155` | `todayDateString` is copy-pasted between `update.ts` and `bulk.ts`, and a third path ope… |
| 1a | duplication | `packages/core/src/task/bulk.ts:134-146` | `bulkArchive` reimplements `archiveTask`'s frontmatter mutation instead of sharing it |
| 1b | duplication | `traversal.ts:134-199` | Two full cycle-detection implementations, plus a third for the write path |
| 2 | duplication | `packages/core/src/git/publish-sync.ts:280-291` | `git()` and `gitSafe()` diverge silently on failure |
| 2 | duplication | `packages/core/src/git/publish-sync.ts:110` | `mergedTaskSet` and `resolve-conflicts.ts` each carry their own copy of the task-path re… |
| 2 | duplication | `packages/core/src/git/publish-sync.ts:643` | `SyncOutcome.updated` recomputes a condition already computed two lines above |
| 3 | duplication | `packages/core/src/config/projects.ts:66-81` | Every config module duplicates its serializer's object literal inside `save*` |
| 4 | duplication | `packages/core/src/query/query.test.ts:7-215` | `query.test.ts` duplicates `tokenizer.test.ts` and `parser.test.ts` almost entirely |
| 4 | duplication | `packages/core/src/query/evaluator.ts:138-148` | `getFieldValue` / `getTaskFieldValue` are near-identical, with a divergence that is a la… |
| 7 | duplication | `packages/contracts/src/task.ts:50` | The public task frontmatter field list is written out three times |
| 8 | duplication | `label.ts:80-109` | Five entity dispatchers repeat an identical delete-confirm-and-remap block |
| 8 | duplication | `apps/cli/src/commands/task-crud.ts:86-92` | `list --limit` validation is duplicated verbatim in the same file |
| 9 | duplication | `apps/mcp/src/tools/task-files.ts:53-61` | `attach_file`'s duplicated error mapping is dead for two of three classes |
| 9 | duplication | `apps/mcp/src/tools/comments.ts:59-69` | The three redundant try/catch blocks in `comments.ts` mirror the `task-files.ts` pattern |
| 1b | naming | `packages/core/src/task/index.ts:57, 69, 73, 75, 77` | Import lists in `task/index.ts` have missing spaces after commas |
| 2 | naming | `packages/core/src/git/publish-sync.ts:2,3,20` | Import statements are missing spaces after commas in five places |
| 9 | naming | `apps/mcp/src/tools/comments.ts:30` | `comments.ts` exports a mutable `ToolDef[]` where every sibling exports `readonly` |

**Still deferred until after the UI build**, for the original reason:
much of this is in code M2–M4 rewrites, so fixing it now means doing it
twice. The difference is that it can now be checked off.

