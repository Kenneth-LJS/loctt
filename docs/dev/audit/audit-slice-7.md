# Audit slice 7 — `packages/contracts/src`

Phase 4 structural audit. **Report-only; no file was edited.**

## Files read completely

All 16 non-test `.ts` files in `packages/contracts/src` (2,111 lines):

`brands.ts` (90) · `calendar.ts` (36) · `history.ts` (64) · `index.ts` (206) ·
`labels.ts` (39) · `list-view.ts` (86) · `milestones.ts` (36) · `projects.ts` (63) ·
`query.ts` (73) · `service-schemas.ts` (163) · `service.ts` (395) · `sprints.ts` (54) ·
`state.ts` (70) · `task.ts` (172) · `users.ts` (103) · `workflow.ts` (461)

Test files (`brands.test.ts`, `contracts.test.ts`, `list-view.test.ts`,
`relationship.test.ts`, `users.test.ts`, `workflow.test.ts`) were out of slice and
not read except where noted.

Several findings were reproduced by execution under `npx tsx`; those runs are
quoted inline. All scratch files were written outside the repo and deleted.

---

## Findings

### `estimate`'s schema transform is discarded on write, so a number reaches disk while the type says `string`

- **File**: `packages/contracts/src/task.ts:66` (and the identical clause at `:135`)
- **Category**: bug
- **What is wrong**: `estimate` is declared
  `z.union([z.string(), z.number()]).transform(v => String(v)).optional()`.
  The transform makes `TaskFrontmatter["estimate"]` infer as `string | undefined`,
  but Zod transforms only apply to a schema's *output*. `writeTask`
  (`packages/core/src/task/io.ts:40`) calls `TaskFrontmatterSchema.parse(task.frontmatter)`
  purely as an assertion and **discards the returned value**, then serializes the
  original object. The normalization therefore never runs on the write path.

  `setField` accepts `value: unknown` (`packages/core/src/task/update.ts:162`) and
  assigns it straight through at `:215` (`patch[field] = value`). The web route
  `PATCH /api/tasks/:ref` (`apps/web/src/server/server.ts:2603-2617`) parses the body
  as `UpdateTaskRequest`, whose `value` is `unknown` (`service.ts:39`), with **no Zod
  validator** — `service-schemas.ts` has no `UpdateTaskRequestSchema`. So a JSON body
  `{"field":"estimate","value":5}` puts a raw number on disk.

  Reproduced end-to-end against a real tracker (CLI `init` + `create`, then the exact
  `setField` call the web handler makes):

  ```
  ON DISK      : "estimate: 5"     <- unquoted YAML number
  IN-MEMORY    : 5 number          <- but the type says string
  API RESPONSE : "5"               <- projection re-applies the transform
  AFTER RE-READ: "5" string        <- read path coerces
  ```

  Three representations of one field disagree simultaneously. `schema-reference.md:126`
  documents the intent ("A number is coerced to a string at parse time") and `:83`
  shows `estimate: "5"` quoted, so disk is genuinely wrong, not merely unusual.

  This is exactly the wave-1 shape named in the brief — a parameter type looser than
  the schema governing the same data — but inverted: here the *schema's own output
  type* is narrower than what the schema's input, and the write path, actually permit.
  It is invisible to the compiler because `TaskFrontmatter` is the post-transform type,
  and invisible to tests that construct object literals because a literal author
  naturally writes `estimate: "5"`. The CLI does pass a string (verified:
  `loctt set T-1 estimate 5` writes `estimate: "5"`), which is why nothing surfaced it.
- **Why it matters**: the in-memory `Task` returned by `setField` lies about its own
  type — `typeof fm.estimate === "number"` while TypeScript guarantees `string`. Any
  consumer doing `fm.estimate.trim()`, `.startsWith()`, or `.length` throws at runtime
  with no compiler warning. The API response and the file on disk disagree, so a client
  that writes back what it read silently changes the stored type. Git sync compares
  serialized YAML, so `5` vs `"5"` is a spurious diff between two clones that did the
  same thing.
- **Blast radius**: `packages/core/src/task/io.ts:40` (write path), `update.ts:215`
  and `:492`/`:504` (`setFields`), every `apps/web/src/server/server.ts` route that
  calls `setField`/`setFields` (11 call sites of `projectTaskFrontmatter` alone), the
  MCP `update_task` tool, and any git-sync field-level merge comparing `estimate`.
- **Size**: M
- **Auto-fixable**: no — touches an on-disk shape and a write path.
- **Confidence**: high (reproduced by execution)

### A `type: enum` custom field with no `values` silently accepts any value

- **File**: `packages/contracts/src/workflow.ts:238`
- **Category**: bug
- **What is wrong**: `CustomFieldDefSchema.values` is `.optional()` with no conditional
  requirement, even though the schema already uses `superRefine` elsewhere for exactly
  this class of rule (`EstimationConfigSchema:294` requires `preset_values` when
  `unit === "custom_enum"`). `schema-reference.md:365` states `values` is
  "**Required** for `type: enum`".

  Neither layer enforces it. `validateWorkflowConfig`
  (`packages/core/src/config/validation.ts:235`) checks duplicate keys across five
  collections but never checks that an enum field has values. And the task-validation
  branch is guarded `if (def.type === "enum" && def.values)`
  (`validation.ts:131`) — with `values` absent the condition is false, the `else if`
  chain matches no non-enum type, and the value falls through **entirely unvalidated**.

  Executed:

  ```
  enum field with no values, core config errors: []
  task setting size=anything:                    []
  ```

  A field declared as a closed enum accepts arbitrary strings, numbers, objects —
  anything — at every surface.
- **Why it matters**: this defeats the "stored enum values are config keys, never
  labels" invariant at its source. The whole point of an enum custom field is that
  stored values are drawn from a declared key set; a config that omits `values`
  turns it into an unvalidated free-text field while still *presenting* as an enum
  to pickers and queries. A user who deletes the last entry from a `values:` list
  (leaving `values:` absent rather than `values: []`) converts a validated field into
  an unvalidated one with no error anywhere.
- **Blast radius**: `packages/core/src/config/validation.ts:131`, `saveWorkflowConfig`
  (`config/workflow-write.ts:99`), `loctt doctor` (`diagnostics/doctor.ts:79`),
  every surface rendering an enum picker, and DSL queries filtering on the field.
- **Size**: S (the contract-side clause) / M (with the core-side guard at `validation.ts:131`)
- **Auto-fixable**: no — tightening a schema changes what configs load.
- **Confidence**: high (reproduced by execution)

### Duplicate `custom_fields[].values[].key` passes both validation layers

- **File**: `packages/contracts/src/workflow.ts:238`
- **Category**: bug
- **What is wrong**: `CustomFieldValueDefSchema` entries are validated independently,
  and `validateWorkflowConfig` checks uniqueness for `statuses`, `priorities`,
  `task_types`, `relationships` and `custom_fields` — but **not** for the nested
  `values` array inside a custom field. Executed:

  ```
  contract accepted duplicate enum value keys: yes
  validateWorkflowConfig errors: []
  ```

  Two entries `{key:"m",label:"Medium"}` and `{key:"m",label:"Mega"}` both persist.
- **Why it matters**: `allowedValues` is built as `new Set(def.values.map(v => v.key))`
  (`validation.ts:132`), so the second entry is unreachable for validation, while a
  picker rendering `def.values` shows two visually distinct options that store the same
  key. Selecting "Mega" stores `m` and redisplays as "Medium" — a silent data-meaning
  change. This is the same class of defect that `ProjectsConfigSchema:46` and
  `LabelsConfigSchema:29` already guard against for their own collections; the nested
  case was simply missed.
- **Blast radius**: `packages/core/src/config/validation.ts:235` (the checker that
  should own it), `saveWorkflowConfig`, `doctor`, enum pickers on all three surfaces,
  and any priority/enum sort using the optional numeric `value`.
- **Size**: S
- **Auto-fixable**: no — changes what configs validate.
- **Confidence**: high (reproduced by execution)

### `history.ts` doc comments contradict decision M3, which is built

- **File**: `packages/contracts/src/history.ts:10` and `:17`
- **Category**: comment
- **What is wrong**: the `HistoryKind` doc says `body_edited` — "body content changed
  (**no content captured**)" — and for the comment kinds, "**No comment body is
  captured**, matching `body_edited`." Both statements are false as of the M3 work
  recorded in `decisions.md:142` (marked ✅ built).

  Verified in core:
  - `packages/core/src/task/io.ts:95` — `{ kind: "body_edited", before: body, after: newBody }`
  - `packages/core/src/task/comments.ts:243-246` — carries `before: previousBody` and
    `after: comment.body`, with an inline comment reading "Carry the text (M3). A
    deletion is the load-bearing case".
  - `packages/core/src/task/create.ts:141` — `created` carries
    `after: { frontmatter, body }`.

  So the two kinds the comment singles out as capturing nothing are precisely the two
  M3 changed most deliberately.
- **Why it matters**: `decisions.md` M2 states that last-write-wins on a contested
  field is "viable *only because* of M3: history records before/after per field, so
  losing a merge race is recoverable by reading history". A contracts-layer comment
  asserting the opposite is the most load-bearing kind of stale comment here — it tells
  a reader that the recovery path M2 depends on does not exist. Someone trusting it
  could reasonably conclude a body-merge loss is unrecoverable, or "optimise" the
  content out of `_history.yaml` to address the size concern the same decision
  explicitly accepted. `CLAUDE.md` requires verifying claims against source; this
  comment is the claim that fails.
- **Blast radius**: comment only, but read by anyone touching history, git merge
  (`git/resolve-conflicts.ts:143` unions `_history.yaml`), or the activity feed.
- **Size**: S
- **Auto-fixable**: yes — comment correction, explicitly on the plan's auto-fix list.
  Still deferred this run per the report-only constraint.
- **Confidence**: high

### `HistoryEntry` has no Zod schema, so `_history.yaml` is cast, never validated

- **File**: `packages/contracts/src/history.ts:38`
- **Category**: bug
- **What is wrong**: `HistoryKind` and `HistoryEntry` are declared as bare TypeScript
  types with no accompanying schema — the only on-disk shape in this package with no
  runtime validator. Every other file here pairs a schema with its type and exports
  both; `index.ts:16` exports `HistoryEntry`/`HistoryKind` as *types only*, with no
  schema line, which makes the omission visible in the barrel.

  The consequence is at `packages/core/src/task/history.ts:76`:
  `const all = Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];` — a raw
  `as` cast over YAML that was never checked. A hand-edited or merge-corrupted
  `_history.yaml` with a misspelled `kind`, a missing `timestamp`, or a non-array entry
  flows into `coalesceHistory`, `mergeHistory` and the burndown replay
  (`sprints/burndown.ts:264`) as if well-formed.
- **Why it matters**: `_history.yaml` is now the documented recovery path for M2's
  last-write-wins merges and is unioned across clones by
  `git/resolve-conflicts.ts:143` on identity `(timestamp, kind, actor, field)`. An
  entry with a missing `timestamp` or `kind` silently participates in that identity
  computation. Because history append is deliberately best-effort ("history must not
  take down the operation that triggered it"), nothing else will ever surface the
  corruption — it degrades quietly in exactly the file that exists to make data loss
  recoverable.
- **Blast radius**: `packages/core/src/task/history.ts` (read/append/coalesce/merge),
  `git/resolve-conflicts.ts:143`, `sprints/burndown.ts:118-264`, the activity feed.
- **Size**: M
- **Auto-fixable**: no — adds a public export and a validation point.
- **Confidence**: high

### Every entity id is a bare `string`, so cross-entity ids swap without a type error

- **File**: `packages/contracts/src/task.ts:51-73`; `projects.ts:21`; `labels.ts:18`;
  `milestones.ts:18`; `sprints.ts:24`; `users.ts:18`
- **Category**: abstraction
- **What is wrong**: `ProjectDef.id`, `LabelDef.id`, `MilestoneDef.id`, `SprintDef.id`
  and `UserProfile.id` are all `z.string().min(1)`, and the task frontmatter slots that
  reference them (`project`, `milestone`, `sprint`, `assignee`, `reporter`, `labels[]`)
  are all plain `string`. They are structurally identical and semantically distinct —
  the exact case the brief asks about.

  `brands.ts` already establishes the pattern for refined primitives, and its header
  explains the deliberate choice to keep the inferred type as plain `string`. That is
  reasonable for *format* refinements like `IsoDate`, where any string of the right
  shape is interchangeable. It is the wrong call for *identity*, where two values of
  identical shape must not be interchangeable.

  Verified: a frontmatter literal assigning a label id to `project`, a sprint id to
  `milestone`, a label id to `sprint`, and a sprint id to `assignee` compiles clean
  under `--strict`. All four are silently wrong.
- **Why it matters**: P-2 makes referencing by the right id load-bearing —
  "Tasks reference their project by ULID, never by name or prefix". The type system
  currently enforces neither which *kind* of id lands in a slot nor that it is an id at
  all. `validateTaskAgainstWorkflow` catches a wrong id at runtime *only when* the aux
  config is supplied (`validation.ts:76`, `aux.projects && ...`), and `AuxConfigs` is
  entirely optional, defaulting to `{}` — so the runtime net has a hole in exactly the
  callers that forget it. A branded type (`type ProjectId = string & {__brand}`) costs
  nothing at runtime and closes the whole class at compile time.
- **Blast radius**: large but mechanical — every id-handling signature in core, cli,
  mcp and web. Introducing brands is a signature change and escalates by rule
  regardless of size.
- **Size**: L
- **Auto-fixable**: no
- **Confidence**: high (reproduced by compilation)

### `SlugKey` and `SprintKey` are dead public exports whose docs contradict P-1

- **File**: `packages/contracts/src/brands.ts:24` and `:33`
- **Category**: dead-code
- **What is wrong**: both are exported from `brands.ts` and re-exported from
  `index.ts:5-6`, and neither has a single consumer. Grep across `packages/` and
  `apps/` (excluding `dist/` and tests) returns only the definition and the barrel
  re-export.

  Worse than unused, their doc comments are actively misleading. `SlugKey` is
  documented as "used for project/label/milestone keys" — but **P-1 states there is no
  slug on `ProjectDef`**, and labels and milestones key on ULIDs, not slugs. `SprintKey`
  is documented for sprint keys, but `SprintDef` (`sprints.ts:24`) has `id` and `name`
  and no key field at all.
- **Why it matters**: `decisions.md` exists precisely because "nothing in the codebase
  distinguishes [a deliberate no] from an oversight". An exported, documented
  `SlugKey` describing project slugs is a standing invitation to reintroduce the
  slug concept P-1 forbids — and `service-schemas.ts:76-80` records that this already
  happened once (`projectKey` "was previously declared here and silently discarded").
  A public export is the strongest possible signal that a concept is real.
- **Blast radius**: removal touches the public barrel (`index.ts`), so it escalates
  despite zero consumers. `brands.test.ts` exercises them; confirm before removing.
- **Size**: S
- **Auto-fixable**: no — unused *exports* are on the plan's auto-fix list, but the
  plan also says anything touching a public export escalates regardless of size, and
  the more specific rule governs.
- **Confidence**: high

### The public task frontmatter field list is written out three times

- **File**: `packages/contracts/src/task.ts:50` (disk), `:119` (public), `:159` (`KNOWN_KEYS`)
- **Category**: duplication
- **What is wrong**: the same 25 fields with the same 25 validators appear in
  `TaskFrontmatterSchema`, again in `TaskFrontmatterPublicSchema`, and the key names a
  third time in the `KNOWN_KEYS` array inside `projectTaskFrontmatter`. The only
  intended difference between the two schemas is `.passthrough()` versus `.strict()`.

  Verified all three are currently in sync (25/25/25, no set differences), so this is
  a latent hazard rather than a live defect — reported because the failure mode is
  silent in two of three directions:
  - a field added to disk-schema only → never echoed by the API, no error
  - a field added to both schemas but not `KNOWN_KEYS` → stripped by the projection,
    no error (the loop copies only `KNOWN_KEYS`, so `.strict()` never sees it)

  Only the third direction (in `KNOWN_KEYS`, absent from the public schema) throws.

  `packages/core/src/task/frontmatter.ts:17` already demonstrates the fix in this
  repo — it derives its list from `Object.keys(TaskFrontmatterSchema.shape)` with an
  explicit comment that this is "so this list can't drift if a new [field is added]".
  The same technique is available here: the public schema can be derived via
  `TaskFrontmatterSchema.omit({}).strict()`-style composition, and `KNOWN_KEYS` from
  `Object.keys(TaskFrontmatterPublicSchema.shape)`.
- **Why it matters**: `KNOWN_KEYS` at minimum is provably redundant with the schema
  it feeds. Three hand-maintained copies of an on-disk shape is the setup for the
  wave-1 `created_at` defect — a field that exists in one place and is forbidden in
  another, invisible to the compiler.
- **Blast radius**: `apps/web/src/server/server.ts` (11 `projectTaskFrontmatter` call
  sites), every API consumer of `TaskFrontmatterPublic`.
- **Size**: M
- **Auto-fixable**: no — touches a public export and the API shape.
- **Confidence**: high (field sets compared by execution)

### `PATCH /api/tasks/:ref` has no request schema, breaking `service-schemas.ts`'s stated contract

- **File**: `packages/contracts/src/service-schemas.ts:1-20` (the file's own doctrine)
- **Category**: layering
- **What is wrong**: the module header states its reason for existing: "Without this
  layer, handlers cast incoming JSON to a core function's parameter type — which is a
  TypeScript fiction that says nothing about what actually arrived on the wire." It
  then provides schemas for views, workflow, init, all five bulk operations, and both
  comment routes.

  `UpdateTaskRequest` (`service.ts:33`) — the single-task field write, the most-used
  write path in the product — has **no** corresponding schema. `handleSetField`
  (`apps/web/src/server/server.ts:2603`) does exactly what the header warns against:
  `parseJsonBody<UpdateTaskRequest>(req, res)`, a cast, followed by a hand-rolled
  `typeof request.field !== "string"` check and no check at all on `value`.

  Note the asymmetry: `BulkSetRequestSchema:108` *does* validate the same conceptual
  payload (`{field, value}` pairs) for the bulk route. The single-task route is the
  unguarded one.
- **Why it matters**: this is the delivery mechanism for the `estimate` finding above —
  no schema means no place to coerce or reject a numeric `value`. More generally it is
  a hole in a boundary the package explicitly claims to own, and the header instructs
  future maintainers to keep these "in sync with the `Request` interfaces in
  `service.ts`", which cannot be done for an interface that has no schema.
- **Blast radius**: `apps/web/src/server/server.ts:2603-2621`; indirectly every field
  write from the web UI.
- **Size**: M
- **Auto-fixable**: no — adds a public export and changes what requests are rejected.
- **Confidence**: high

### `key_history` permits empty-string entries while `labels` forbids them

- **File**: `packages/contracts/src/task.ts:77` and `:142`
- **Category**: bug
- **What is wrong**: `key_history: z.array(z.string()).optional()` — no `.min(1)` on
  the element, in both the disk and the public schema. The neighbouring
  `labels: z.array(z.string().min(1))` (`:61`, `:130`) does constrain its elements, as
  does `TaskRelationship.target` (`:35`) and every id field in the package. Verified:
  `projectTaskFrontmatter` accepts `key_history: [""]` without complaint.
- **Why it matters**: P-7 makes `key_history` load-bearing — "the old key is preserved
  in `key_history` and keeps resolving. Dropping `key_history` breaks every existing
  link, bookmark, and commit message referencing the old key." An empty string entered
  into the key index is a key that resolves to nothing, or worse, participates in
  lookup as a degenerate match. `packages/core/src/state/keys.ts:58` deduplicates
  `key_history` entries but does not filter empties. The inconsistency with `labels`
  in the same object literal suggests an oversight rather than a decision.
- **Blast radius**: `packages/core/src/state/keys.ts`, the key index rebuild
  (`C2`, CLI-only recovery path), `task/move.ts` (which appends on reallocation per
  P-7), key lookup on all three surfaces.
- **Size**: S
- **Auto-fixable**: no — tightens an on-disk shape.
- **Confidence**: high (reproduced by execution)

### `CalendarConfig.working_days` accepts an empty array and duplicates

- **File**: `packages/contracts/src/calendar.ts:33`
- **Category**: bug
- **What is wrong**: `working_days: z.array(Weekday)` has no `.min(1)`, no uniqueness
  refinement, and `holidays` permits duplicate dates. Verified: `working_days: []`,
  `working_days: [1,1,1]` and two holidays on the same date all parse.

  This package is otherwise consistent about rejecting degenerate collections with a
  documented rationale — `BoardsConfigSchema:366` requires `.min(1)` on `columns`
  ("Empty `columns` is rejected — pick one or omit"), `EstimationWeightsSchema:282`
  rejects `{}` ("A zero-entry map would silently produce a flat burndown, which is
  almost certainly a config mistake"), `ProjectsConfigSchema:35` requires at least one
  project, and `ListViewFiltersSchema:50` rejects duplicates within an array. Calendar
  is the outlier.
- **Why it matters**: the header says the calendar is "purely cosmetic", which bounds
  the damage — but `TrackerInfoResponse.today` (`service.ts:202`) is resolved from
  `calendar.yaml`'s timezone specifically so "every surface shares one definition of
  today", and the same file drives weekend shading. A zero-working-day calendar shades
  the entire timeline as non-working with no error to explain it, which by
  `EstimationWeightsSchema`'s own stated reasoning is a config mistake worth rejecting.
- **Blast radius**: timeline/Gantt rendering, `calendar.yaml` writers, `loctt calendar`
  (which `TEMP-BUILD-PLAN.md` records as appearing in no test file).
- **Size**: S
- **Auto-fixable**: no — tightens an on-disk shape.
- **Confidence**: high (reproduced by execution)

### `ProjectsConfig.default` may point at an archived project

- **File**: `packages/contracts/src/projects.ts:55`
- **Category**: bug
- **What is wrong**: the `superRefine` checks `default` against the set of all project
  ids, including archived ones. Verified: a config whose only project is
  `archived: true` and which names it as `default` parses successfully.

  The schema's own comment (`:31`) sets the standard it misses: "Stale references are
  rejected at parse time so the file always reflects a coherent state." A default
  pointing at a project hidden from every picker is not a coherent state.
- **Why it matters**: Q1 establishes that "'No default — force picker' is a valid
  workspace state", so an absent default is well-handled; an *archived* default is the
  unhandled middle case. `loctt create` resolves the target project through the
  default chain (`--project` > user `default_project` > workspace default), so new
  tasks land in a project the UI does not show. D20-adjacent invariant P-1 keeps
  `ProjectDef` minimal precisely so this file stays easy to reason about.
- **Blast radius**: `packages/core/src/projects/*` default resolution, `loctt create`,
  the web create dialog, MCP `create_task`.
- **Size**: S
- **Auto-fixable**: no — changes what configs load.
- **Confidence**: high (reproduced by execution)

### `defaultStatus`'s fallback contradicts the rule its own comment cites

- **File**: `packages/contracts/src/workflow.ts:54-58`
- **Category**: abstraction
- **What is wrong**: `defaultStatus` returns
  `config.statuses.find(s => s.default === true) ?? config.statuses[0]`. The doc
  justifies the fallback as existing "only for configs built in memory by tests that
  bypass parsing".

  But `StatusDefSchema`'s own comment (`:30-34`) explains that explicit `default: true`
  was chosen over an implicit rule *precisely because* "the first status" was
  "documented, neither was implemented, and reordering the list would silently change
  which status new tasks get". The fallback reinstates exactly that rule in production
  code.

  It is also reachable in production, not only in tests: `WorkflowConfigSchema:446`
  guards the no-default case with `if (config.statuses.length > 0 && ...)`, so a config
  with `statuses: []` parses cleanly (verified). And `parseWorkflowConfig`
  (`core/config/workflow.ts:31`) deliberately does not run `validateWorkflowConfig` on
  reads, so a config with duplicate or zero defaults that is already on disk loads
  fine and reaches this function.
- **Why it matters**: the return type is already `StatusDef | undefined`, so callers
  must handle absence regardless — the fallback buys nothing at the type level while
  reintroducing an order-dependent behaviour the schema was designed to eliminate.
  Reordering `statuses` in `workflow.yaml` then silently changes which status new tasks
  receive, in exactly the configs where the invariant is already weakest.
- **Blast radius**: task creation defaults on all three surfaces.
- **Size**: S
- **Auto-fixable**: no — changes behaviour.
- **Confidence**: medium (the reachable paths are verified; whether any shipped caller
  hits a zero-default config in practice is not)

### `parseWorkflowConfig`'s comment misstates why uniqueness lives in core

- **File**: `packages/core/src/config/workflow.ts:22-24` (contracts-side root cause)
- **Category**: comment
- **What is wrong**: the comment reads "Per-collection uniqueness checks live in
  `validateWorkflowConfig`, because **Zod validates entries independently and cannot
  see two entries collide**." The stated reason is false, and this package disproves it
  four times over: `ProjectsConfigSchema:37`, `LabelsConfigSchema:29`,
  `MilestonesConfigSchema:27`, `SprintsConfigSchema:45` and `BoardsConfigSchema:367`
  all detect duplicates inside a `superRefine`, which sees the whole collection.

  The *decision* the comment defends is sound and I am not disputing it — the following
  sentences give the real rationale ("a config that is already on disk is reported by
  `loctt doctor` rather than made unloadable"), which is a genuine and well-reasoned
  read/write asymmetry.
- **Why it matters**: the false premise is what makes `WorkflowConfigSchema` look
  consistent with its five sibling config schemas when it is in fact the only one that
  enforces no uniqueness at all. A reader who accepts the stated reason will not
  question why `workflow.yaml` is special, and will not notice that the nested
  `custom_fields[].values[].key` case (finding 3 above) is covered by *neither* layer.
  Recording the real reason is what makes the remaining gap visible.
- **Blast radius**: comment only.
- **Size**: S
- **Auto-fixable**: yes — comment correction. Deferred this run per report-only.
- **Confidence**: high

### `UserSettings` is `.passthrough()` while every sibling user schema is `.strict()`

- **File**: `packages/contracts/src/users.ts:102`
- **Category**: abstraction
- **What is wrong**: `UserSettingsSchema` is `.passthrough()`, with a documented reason
  — UI render prefs "are accepted via passthrough so they survive a load → save round
  trip without core needing to model them". That reasoning is sound and matches
  `TaskFrontmatterSchema`'s.

  The gap is that `packages/core/src/users/settings.ts:61` does
  `const safe = UserSettingsSchema.parse(settings)` on the **write** path and, unlike
  `writeTask`, does use the result — so the round-trip works. But because the schema is
  permissive, a typo'd key (`card_layout_` for `card_layout`, `editor_mode: "wysiwyg "`)
  is preserved silently forever rather than rejected, and `CardLayoutSchema:87` goes to
  real trouble to reject a mistyped *value* ("The set is closed so a typo in
  hand-edited YAML is caught at load rather than silently rendering nothing") while a
  mistyped *key* sails through.
- **Why it matters**: the three modelled fields are not all cosmetic — `default_project`
  participates in the `loctt create` resolution chain, and `editor_mode` is D17. The
  file's own comment calls `default_project` "the one cross-cutting field". A typo in
  it degrades to "no default" silently, which is a valid state per Q1 and therefore
  produces no error anywhere.
- **Blast radius**: `packages/core/src/users/settings.ts:37-61`, project resolution in
  `loctt create`, the settings UI.
- **Size**: M
- **Auto-fixable**: no — changes what settings files load.
- **Confidence**: medium (the passthrough is deliberate and documented; the finding is
  that the known-key subset deserves stricter treatment than the unknown remainder,
  which is a design call rather than a defect)

---

## Checked and found sound

Recorded so the next reader does not re-derive these.

- **`ProjectDefSchema` is exactly `{id, name, prefix, archived}` and `.strict()`** —
  P-1 holds. No `slug`, no `created_at`. This is the contracts-side counterpart of the
  wave-1 `assignProvisionalPrefixes` finding (`git/merge.ts:283` sorting on a
  non-existent `created_at`): the schema is correct and **core is the wrong side**.
  Adding `created_at` here to make that sort work would violate P-1 — the fix belongs
  in `merge.ts`. Flagging explicitly because it is the tempting wrong fix.

- **`service-schemas.ts:76-80` correctly documents the `projectKey` removal** — the
  comment explains that a `projectKey` field was "previously declared here and silently
  discarded", and that `.strict()` now rejects it. Consistent with P-1 and a good
  example of the pattern the rest of this report asks for.

- **`RelationshipDefSchema` rejects `symmetric: true` and self-inverse directional
  rels** — verified by execution. Matches decisions.md Q19 (superseded → `kind:
  "symmetric"`), and `workflow.ts:162` errors when `inverse === key` exactly as
  documented.

- **`relationshipTypeKeys` returns `["relates","relates"]` for a hand-built literal
  missing both `kind` and `inverse`** (reproduced). Not reported as a bug: that literal
  is schema-invalid (verified — `RelationshipDefSchema` rejects it), and all four
  production callers wrap the result in `new Set(...)`
  (`config/validation.ts:43`, `task/relationships.ts:195`, `task/traversal.ts:24`,
  `query/validate.ts:309`), so the duplicate is absorbed. The `?? rel.key` fallbacks at
  `workflow.ts:197`/`:203` are documented defensive code for exactly this case.

- **`TaskFrontmatterSchema.passthrough()` + `.strict()` public projection** — the
  two-schema split is deliberate and correct, and works: verified that an unknown key
  survives a disk parse and is stripped from the projection. The duplication is
  reported above; the *design* is right.

- **The three field lists in `task.ts` are currently in sync** — 25/25/25 with no set
  differences, verified by comparing `.shape` keys against `KNOWN_KEYS`. Reported as a
  drift hazard, not a live defect.

- **`projectTaskFrontmatter` throws on null/empty enum values, but core never writes
  them** — `unsetField` and `setFields` delete keys rather than assigning `null`
  (`update.ts:492`, `:504`), so the throw is not reachable on normal paths. The
  "throws … that's a sign of corruption" comment is accurate.

- **`parseWorkflowConfig` not running uniqueness checks on read is deliberate** — the
  read/write asymmetry (`core/config/workflow.ts:26-29`) is a considered decision:
  don't make an on-disk config unloadable, report it via `doctor`. Only the comment's
  stated *reason* is wrong (reported above), not the behaviour.

- **`UserProfile.avatar` rejects path separators and `.`/`..`** (`users.ts:26-31`) —
  correctly defends against traversal from a hand-edited `profile.yaml`.

- **`ListViewFiltersSchema` rejects a key present in both `visible` and `hidden`** —
  deliberately stricter than the documented "hidden wins", with the reason given
  inline (`list-view.ts:65-67`). Sound.

- **`SprintDefSchema` permits `start_date === end_date`** — a one-day sprint is
  legitimate; only `end_date < start_date` is rejected. Correct.

- **Q10 holds** — nothing in `sprints.ts` restricts the number of `active` sprints and
  no automatic transition exists in the schema layer.

- **`SchemaStatusResponse`'s "CLI-only" comment is already fixed** — `service.ts:163`
  now correctly says migration is reachable from all three surfaces, resolving the
  action item recorded at `decisions.md:108`.

- **D20 holds in the contract** — `PriorityDefSchema.value` is optional and carries no
  display affordance; nothing here leaks it to a user-facing shape.

- **`index.ts` re-exports are complete and alphabetized**, with types and values
  separated. The only anomaly is `history.ts` contributing types but no schema, which
  is the substance of the `HistoryEntry` finding above rather than a barrel defect.

- **`BulkTaskRefsSchema`'s 500-item cap** (`service-schemas.ts:98`) is justified inline
  by the state-lock argument and is consistent across all five bulk schemas.

- **`BulkDeleteRequestSchema` requires the literal `"DELETE"`** — a real server-side
  guard, not merely client-side, with the reasoning given inline. Sound.
