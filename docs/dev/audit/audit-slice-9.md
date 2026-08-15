# Audit — Slice 9: `apps/mcp/src/`

Phase 4 structural audit, report-only. No file was edited.

**Files read completely** (every non-test `.ts` in the slice, 1,820 lines):
`index.ts`, `registry.ts`, `types.ts`, `runtime/errors.ts`, `runtime/fields.ts`,
`runtime/confirm.ts`, `runtime/workflow-assert.ts`, and all 16 `tools/*.ts`:
`task-crud.ts`, `project.ts`, `user.ts`, `sprint.ts`, `tracker.ts`,
`milestone.ts`, `comments.ts`, `label.ts`, `git.ts`, `config.ts`,
`task-files.ts`, `task-rank.ts`, `task-links.ts`, `views.ts`, `task-body.ts`,
`task-archive.ts`. (The 2,515-line figure in the plan counts `mcp.test.ts` +
`registry.test.ts`, which are out of remit.)

Verification was done against a **fresh `mktemp -d` tracker**, never the repo's
`.loctt`. Two scratch probe scripts were written to the scratchpad directory
only.

---

## Findings

### `duplicate_task` rejects a project name, violating P-3 and diverging from its own sibling handlers

- **File**: `apps/mcp/src/tools/task-crud.ts:286-307` (handler); schema at `:284`
- **Category**: bug
- **What is wrong**: The handler passes `args["project"]` straight into
  `overrides.project` with no resolution step. `core/task/duplicate.ts:87`
  writes that value directly into the frontmatter `project` slot
  (`project: overrides.project ?? fm.project ?? ""`), which per **P-2** must be
  a ULID. Its two sibling handlers in the same file both resolve first:
  `create_task` calls `resolveProjectIdForUser` at `:151`, `move_task` at `:260`.

  Verified end-to-end on a temp tracker with two projects (`Tasks`/`T-`,
  `Web`/`WEB-`):

  ```
  duplicate_task {ref:"T-1", project:"Web"}
    → Error: no key allocation state for entity type "Web"      [isError]
  duplicate_task {ref:"T-1", project:"01M031BS64F1PSTSABQ19P7JXP"}
    → Created WEB-1: Source (copy)                              [ok]
  move_task     {refs:["T-1"], project:"Web"}
    → Moved 1, failed 0  /  T-1 → WEB-2                         [ok]
  ```

  So the *documented-by-schema* input ("Target project; defaults to the
  source's") is the one input that does not work. **P-3** states CLI and MCP
  accept a project name or a ULID; this accepts only a ULID.
- **Why it matters**: Three compounding problems. (1) An agent that reads
  `list_projects` and passes the natural human identifier gets a failure with no
  hint that a ULID was wanted. (2) The error text leaks a key-allocation
  internal — `no key allocation state for entity type "Web"` names no remedy and
  is not actionable, failing the slice's error-handling bar. (3) The same
  message appears for a genuinely nonexistent project
  (`project:"no-such-project"` produces byte-identical output), so an agent
  cannot distinguish "you passed a name, pass an id" from "that project does not
  exist". Note the failure is *loud*, not silent — no name is written to disk in
  this path — but only because key allocation happens to reject first; nothing
  in `duplicate.ts` guards the ULID slot itself.
- **Blast radius**: `duplicateTask` in `packages/core/src/task/duplicate.ts` is
  shared. **The CLI has the identical defect** —
  `apps/cli/src/commands/task-crud.ts:191-204` passes `getArg(args,"--project")`
  into the same `overrides.project` with no resolution, while its own `move`
  resolves. So this is a shared-root bug reaching two surfaces, not an MCP-only
  divergence, and a fix belongs in core (or in both boundaries consistently).
  Also touches `overrides.project` typing in the core `DuplicateTaskOverrides`
  contract.
- **Size**: S (one resolve call per surface) or M (if fixed in core with an
  invariant guard, which is the better shape)
- **Auto-fixable**: no — changes accepted input and an error message; escalates
  by rule
- **Confidence**: high (verified by execution)

### Two shipped tools have no section in the reference doc

- **File**: `docs/user/mcp/reference.md` (absent); tools at `apps/mcp/src/tools/task-crud.ts:246` and `:274`
- **Category**: doc-drift
- **What is wrong**: The registry ships 75 tools. Diffing shipped names against
  every `###` heading in the reference (including the `A / B` combined headings
  and the comment-tools table) leaves **`move_task` and `duplicate_task`
  entirely undocumented**. Nothing in the doc mentions either. The
  75-sections/75-tools coincidence hides this: the doc's count is made up by
  splitting other tools across headings.
- **Why it matters**: Phase 3 transcribes cases from the reference. Two tools —
  one of which reallocates task keys and exercises **P-7** (`key_history`
  retirement), the other of which carries the P-3 bug above — would get zero
  cases, and their absence is invisible to a reader counting sections. `move_task`
  is among the most invariant-dense operations on the surface (P-7, P-9).
- **Blast radius**: Phase 3 case authoring; any agent using the reference as the
  tool catalog.
- **Size**: M (two tool sections to author)
- **Auto-fixable**: no — the plan forbids an agent editing the reference doc
- **Confidence**: high (verified by script diffing `getTools()` against the doc)

### The entire entity region of the reference doc specifies a pre-P-1 `key`/`label` API that does not exist

- **File**: `docs/user/mcp/reference.md:310-575`
- **Category**: doc-drift
- **What is wrong**: Every table across Projects, Labels, Milestones and Sprints
  documents a slug-based vocabulary (`key` as the identifier, `label` as the
  display name) that the code has never shipped in this form. Shipped schemas use
  `name` for display and an entity-specific ref parameter (`project` / `label` /
  `milestone` / `sprint`) accepting **id or name**. See the exhaustive map below —
  **17 tools** affected.
- **Why it matters**: This is the Phase 3 blocker, and it is wider than the one
  verified `create_label` example in the plan. An agent transcribing cases from
  this region writes cases for an API with different parameter *names*, different
  *required* sets, and a different identity model (`P-1`: there is no slug). Every
  such case fails against shipped code, and the natural agent response — "the doc
  is the spec, so the code is wrong" — would drive edits to correct code.
- **Blast radius**: Phase 3 case authoring across four entity families; anyone
  scripting MCP from the reference.
- **Size**: L
- **Auto-fixable**: no — the plan forbids an agent editing the reference doc
- **Confidence**: high (every row cross-checked against the shipped `inputSchema`)

### `set_default_project` echoes the unresolved user input instead of what it set

- **File**: `apps/mcp/src/tools/project.ts:163-171`
- **Category**: bug
- **What is wrong**: Unlike its seven siblings in the file, the handler does not
  call `resolveProjectIdFromInput`; it forwards the raw string. That part is
  *sound* — `setDefaultProject` (`packages/core/src/projects/manage.ts:289`)
  resolves internally and errors correctly on an unknown name (verified:
  `Error: unknown project: no-such`). The defect is the success message:
  `Set workspace default to ${project}` echoes whatever the agent typed, so
  passing a name reports `Set workspace default to Web` while the stored value is
  a ULID.
- **Why it matters**: Minor but real for an agent, which treats tool output as
  ground truth. Two projects can share a name (**P-1**: names are not unique), so
  the echo can name an ambiguity that core just resolved one specific way, and the
  agent has no way to learn which. Every sibling handler reports the resolved id
  (`Archived project ${id}`), so this is also an internal inconsistency.
- **Blast radius**: message only; no on-disk effect. Resolving locally to build
  the message would also make the file uniform.
- **Size**: S
- **Auto-fixable**: no — changes an output string; escalates by rule
- **Confidence**: high (verified by execution)

### `create_task`'s `project` parameter description contradicts P-1

- **File**: `apps/mcp/src/tools/task-crud.ts:141`
- **Category**: doc-drift
- **What is wrong**: The schema describes `project` as `"Project key (slug)."`
  **P-1** is explicit that projects are `{id, name, prefix}` and **there is no
  slug**. The handler in fact passes the value to `resolveProjectIdForUser`,
  which accepts a name or a ULID. The same stale phrasing appears in the
  reference at `:62`.
- **Why it matters**: The `describe()` string is the contract an LLM reads, and
  no test asserts it. "Slug" tells an agent to invent a lowercased-hyphenated
  form of the project name — which will usually *not* match a display name and
  will fail resolution. The tool's own top-level description (`:138`) is correct
  and says "pass `project` to disambiguate", so the tool contradicts itself
  within one definition.
- **Blast radius**: description text only; also the reference doc line, which an
  agent may not fix.
- **Size**: S
- **Auto-fixable**: no — it is an input-schema description an LLM depends on;
  escalates by rule under "signature/public export"
- **Confidence**: high

### `list_tasks` warning line prints an empty view name for ad-hoc queries

- **File**: `apps/mcp/src/tools/task-crud.ts:131`
- **Category**: bug
- **What is wrong**: `Warning: saved view "${view ?? ""}" — ...` is emitted
  whenever `onWarning` fires, but the warning path is not exclusive to saved
  views. When `view` is undefined the agent sees a literal
  `Warning: saved view "" — ...`, attributing the problem to a saved view that
  does not exist.
- **Why it matters**: The comment above it (`:102-105`) explains the whole point
  is that an agent has no stderr and a short list would otherwise read as a
  definitive answer — so the warning must be *legible*. Naming a nonexistent
  empty-string view sends the agent looking for a saved view to fix.
- **Blast radius**: message only; `list_tasks` is one of the most-called tools.
- **Size**: S
- **Auto-fixable**: no — output-string change; escalates by rule
- **Confidence**: medium (the empty-name branch is reachable by construction —
  `view` is optional and `onWarning` is not gated on it — but I did not
  construct a workflow config that fires `onWarning` without a view)

### `create_project` is not atomic when `make_default: true`

- **File**: `apps/mcp/src/tools/project.ts:53-62`
- **Category**: layering
- **What is wrong**: The handler performs two independent core calls —
  `createProject`, then `setDefaultProject` — each taking its own
  `withStateLock`. There is no surrounding transaction. If the second throws
  (or the process dies between them), the project exists but the default is
  unchanged, and the tool reports failure despite a partial write.
- **Why it matters**: **P-9** establishes the house rule that a compound
  operation is one lock and one journal entry; this is the same class of
  half-completed write in a different operation. The agent's retry then hits
  "prefix already in use" — the prefix uniqueness check — leaving it stuck with
  no way to reach the state it asked for.
- **Blast radius**: `createProject` + `setDefaultProject` in
  `packages/core/src/projects/manage.ts`. A correct fix likely wants a
  `makeDefault` option on core's `createProject` inside one lock, which is a
  core signature change.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: medium (the non-atomicity is certain from the code; I did not
  force a failure between the two calls)

### `list_config_values` swallows every read error into `null`

- **File**: `apps/mcp/src/tools/config.ts:74-79`
- **Category**: bug
- **What is wrong**: The per-key `try { … } catch { value = null; }` is
  unconditional, so a genuine fault (unreadable config, malformed YAML,
  `FsAccessError`) is rendered identically to "this key is unset".
- **Why it matters**: The sibling `get_config_value` surfaces its errors, so the
  two config readers disagree about whether a broken config is visible. An agent
  running `list_config_values` to check whether git mode is on would read
  `git.enabled: null` from a config file it cannot parse, and conclude the
  feature is off rather than that the tracker is broken. `FsAccessError` is
  explicitly classified as an actionable domain error in
  `runtime/errors.ts:67` — this handler discards exactly that signal.
- **Blast radius**: `list_config_values` only; `CONFIG_KEYS` is small and
  git-only today, so impact is currently narrow.
- **Size**: S
- **Auto-fixable**: no — changes observable behaviour on the error path
- **Confidence**: high

### `attach_file`'s duplicated error mapping is dead for two of three classes

- **File**: `apps/mcp/src/tools/task-files.ts:53-61`, `:81-86`
- **Category**: duplication
- **What is wrong**: `AttachmentSourceError` (`:57`) and
  `AttachmentNotFoundError` (`:82`) are caught and re-wrapped into
  `errorResult(err.message)` — byte-identical to what the dispatcher's outer
  catch already does, since `runtime/errors.ts:60-62` lists all three attachment
  classes in `isKnownDomainError`. Only the `AttachmentExistsError` branch
  (`:54`) earns its place, because it appends the actionable
  `". Pass force: true to overwrite."`.
- **Why it matters**: `task-rank.ts:6-11` and `task-crud.ts:3-6` both carry
  comments stating this exact pattern was deliberately removed as redundant, so
  this file is the odd one out against a documented convention. The cost is that
  a reader must check `isKnownDomainError` to know the catches are no-ops, and a
  future error class added to core silently gets different treatment here.
- **Blast radius**: `task-files.ts` only. Removing the two redundant branches is
  behaviour-preserving *given* the current `isKnownDomainError` list — but that
  coupling is why it is not on the auto-fix list.
- **Size**: S
- **Auto-fixable**: no — the "no behaviour change" proof depends on a list in
  another file; escalates by rule
- **Confidence**: high

### `comments.ts` exports a mutable `ToolDef[]` where every sibling exports `readonly`

- **File**: `apps/mcp/src/tools/comments.ts:30`
- **Category**: naming
- **What is wrong**: `export const TOOLS: ToolDef[]` — the other fifteen tool
  files all declare `export const TOOLS: readonly ToolDef[]`. `registry.ts:46`
  types the collection as `readonly (readonly ToolDef[])[]`, so the array is
  widened at the seam rather than being uniformly immutable.
- **Why it matters**: Purely a consistency/immutability gap; no current caller
  mutates it. Worth noting because the registry's whole design leans on these
  arrays being static.
- **Blast radius**: one type annotation.
- **Size**: S
- **Auto-fixable**: no — it is a type on a public export; escalates by rule
  despite being provably inert
- **Confidence**: high

### The three redundant try/catch blocks in `comments.ts` mirror the `task-files.ts` pattern

- **File**: `apps/mcp/src/tools/comments.ts:59-69`, `:86-97`, `:111-121`
- **Category**: duplication
- **What is wrong**: Each of `post_comment`, `edit_comment` and `delete_comment`
  wraps its core call in `try { … } catch (err) { return errorResult((err as Error).message); }`.
  Unlike `task-files.ts`, these catch **everything** — a `TypeError` or an
  unexpected I/O fault is converted into a routine tool error.
- **Why it matters**: This defeats the dispatcher's deliberate design.
  `index.ts:136-143` documents at length that non-domain errors must propagate so
  the MCP framework surfaces them as server faults, "masking it as an errorResult
  here would hide the diagnosis". These three handlers do precisely the masking
  the dispatcher's comment warns against, so a real bug in comment handling
  reaches the agent as a plausible-looking domain error and is never logged as a
  fault.
- **Blast radius**: three handlers. Worth checking whether the comment core path
  throws a class missing from `isKnownDomainError` — if so, deleting the catches
  needs that class added first.
- **Size**: S
- **Auto-fixable**: no — changes which failures become server faults
- **Confidence**: high (the over-broad catch is plain from the code; whether any
  comment-specific error class is missing from `isKnownDomainError` is the open
  question a fix must answer)

### Agent-guidelines section contradicts the shipped `migrate_schema` tool

- **File**: `docs/user/mcp/reference.md:10` vs `apps/mcp/src/tools/tracker.ts:96`
- **Category**: doc-drift
- **What is wrong**: The guideline states "**There is no MCP tool that runs the
  migration** — the user must invoke the CLI command." `migrate_schema` ships,
  is registered, and performs the migration with `confirm: true`. The doc
  documents it correctly 165 lines later at `:175`, so the file contradicts
  itself.
- **Why it matters**: Agent guidelines are read as policy. An agent that hits the
  schema guard will follow `:10`, tell the user to go run the CLI, and never
  offer the tool that exists — the worst outcome for the one situation where
  every other tool is refusing to run.
- **Blast radius**: doc only.
- **Size**: S
- **Auto-fixable**: no — reference doc is off-limits to agents
- **Confidence**: high

---

## Reference-doc drift map

Exhaustive, tool by tool, `docs/user/mcp/reference.md` vs the shipped
`inputSchema`. **17 tools have parameter-level drift; 2 are undocumented; 1
guideline is contradicted.** The task region (`create_task` … `detach_file`) is
otherwise accurate — drift is concentrated in the entity region exactly as the
Phase 2 measurement predicted.

Legend: **doc** = what the reference specifies, **code** = what ships.

### Projects (`reference.md:304-377`)

| Tool | Doc params | Shipped params | Drift |
|---|---|---|---|
| `list_projects` | none; returns `{projects, default: <key\|null>}` | none | **Return shape**: `default` is a **ULID**, not a key. Verified: `"default": "01M031BS4BPT4TWX9AZ5VEH431"` |
| `create_project` | `key` (req), `label` (req), `prefix` (req), `make_default` | `name` (req), `prefix` (req), `make_default` | **`key` does not exist** (P-1: no slug). **`label` → `name`.** Doc's "Project keys are immutable" describes a nonexistent field |
| `create_project` returns | `Created project <key>` | JSON `{id, name, prefix}` | **Return shape wrong.** Verified |
| `edit_project` | `project`, `name` | `project`, `name` | ✅ accurate |
| `set_project_prefix` | `project`, `prefix`, `confirm` | same | ✅ accurate |
| `archive_project` / `unarchive_project` | `key` (req) | `project` (req) | **Param renamed.** Doc says "Project key"; code accepts id or name |
| `delete_project` | `key`, `confirm`, `remap_to`(="target project key") | `project`, `confirm`, `remap_to` | **`key` → `project`.** Returns doc `{key, remappedTaskCount}`; code returns `{id, remappedTaskCount}` |
| `set_default_project` | `key` (opt) | `project` (opt) | **Param renamed** |
| `move_task` | **absent** | `refs` (1–500), `project` | **Undocumented tool** |
| `duplicate_task` | **absent** | `ref`, `title`, `project` | **Undocumented tool** |

### Users (`reference.md:378-443`)

| Tool | Doc | Code | Drift |
|---|---|---|---|
| `list_users` | `include_archived` | same | ✅ |
| `get_current_user` | none | none | ✅ |
| `switch_user` | `ref` | same | ✅ |
| `create_user` | `name`, `email`, `timezone`, `switch_to_on_create` | same | ✅ |
| `edit_user` | `ref`, `name`, `email`(nullable), `timezone` | same | ✅ |
| `archive_user`/`unarchive_user` | `ref` | same | ✅ |
| `delete_user` | `ref`, `confirm`, `remap_to`, `unassign` | same | ✅ |

**Users is the one clean entity family** — no drift. Phase 3 can transcribe it
as-is.

### Labels (`reference.md:445-485`)

| Tool | Doc | Code (`tools/label.ts`) | Drift |
|---|---|---|---|
| `list_labels` | none | none | ✅ params. Doc omits that each label has a ULID id + optional color (the tool description states it) |
| `create_label` | `key` (req), `label` (req), `color` | `name` (req), `color` (opt) | **`key` does not exist; `label` → `name`.** The plan's verified example. Doc marks two params required; code requires one |
| `create_label` returns | unstated | JSON `{id, name}` | **Return shape undocumented** |
| `edit_label` | `key` (req), `label`, `color` | `label` (req, ="id or name"), `name`, `color` | **Three-way collision**: doc's `key` is code's `label`; doc's `label` is code's `name`. An agent following the doc sends `label:"New name"` — which code reads as *which label to edit* |
| `archive_label`/`unarchive_label` | `key` | `label` | **Param renamed** |
| `delete_label` | `key`, `confirm`, `remap_to` | `label`, `confirm`, `remap_to` | **`key` → `label`.** Returns doc `{key, ...}`; code `{id, ...}` |

`edit_label` is the most dangerous row in the map: the doc's parameter names are
not merely absent from the code, they **collide with different code parameters**,
so a doc-faithful call is well-formed under the shipped schema and does the wrong
thing rather than erroring.

### Milestones (`reference.md:487-526`)

| Tool | Doc | Code (`tools/milestone.ts`) | Drift |
|---|---|---|---|
| `list_milestones` | **none** | `progress` (bool, opt) | **Param entirely undocumented.** Doc says "No parameters" |
| `create_milestone` | `key` (req), `label` (req), `target_date` | `name` (req), `target_date` | **`key` does not exist; `label` → `name`** |
| `create_milestone` returns | unstated | `{id, name}` | **Undocumented** |
| `edit_milestone` | `key` (req), `label`, `target_date`, `archived` | `milestone` (req), `name`, `target_date`, `archived` | **`key` → `milestone`; `label` → `name`.** Same collision class as `edit_label` |
| `archive_milestone`/`unarchive_milestone` | `key` | `milestone` | **Param renamed** |
| `delete_milestone` | `key`, `confirm`, `remap_to` | `milestone`, `confirm`, `remap_to` | **`key` → `milestone`.** Returns `{key,…}` vs `{id,…}` |

### Sprints (`reference.md:528-575`, `:615`)

| Tool | Doc | Code (`tools/sprint.ts`) | Drift |
|---|---|---|---|
| `list_sprints` | none | none | ✅ |
| `create_sprint` | `key` (req), `label` (req), `start_date`, `end_date`, `state`, `goal` | `name` (req), `start_date`, `end_date`, `state`, `goal` | **`key` does not exist; `label` → `name`** |
| `create_sprint` returns | unstated | `{id, name}` | **Undocumented** |
| `edit_sprint` | `key` (req), `label`, `start_date`, `end_date`, `state`, `goal`, `force` | `sprint` (req), `name`, … , `force` | **`key` → `sprint`; `label` → `name`** |
| `archive_sprint`/`unarchive_sprint` | `key` | `sprint` | **Param renamed** |
| `delete_sprint` | `key`, `confirm`, `remap_to` | `sprint`, `confirm`, `remap_to` | **`key` → `sprint`.** Returns `{key,…}` vs `{id,…}` |
| `get_sprint_burndown` | `sprint` | `sprint` | ✅ |

### Tasks, tracker, config, git, relationships

Accurate throughout, with these exceptions:

| Tool | Drift |
|---|---|
| Agent guidelines `:10` | States no MCP migration tool exists; `migrate_schema` ships |
| `create_task` `:62` | `project` described as "Project key (slug)" — P-1 says no slug exists; matches the same stale phrasing in the shipped schema (`task-crud.ts:141`) |
| `list_tasks` `:92` | Doc hardcodes "default 30"; code interpolates `DEFAULT_LIST_LIMIT`. Correct today, silently stale if the constant changes |
| `update_task` `:142` | Doc lists `key_history` among rejected immutable fields. Not in `UPDATE_TASK_FIELD_SCHEMAS`, so it *is* rejected — but via the "not exposed" path, giving a different message than the doc implies. Minor |

### Drift summary by region

| Region | Tools | Clean | Drifted |
|---|---|---|---|
| Tracker setup | 4 | 3 | 1 (`migrate_schema` guideline) |
| Tasks | 20 | 18 | 2 undocumented (`move_task`, `duplicate_task`) + 2 minor |
| Projects | 8 | 2 | 6 |
| Users | 7 | 7 | 0 |
| Labels | 6 | 1 | 5 |
| Milestones | 6 | 0 | 6 |
| Sprints | 7 | 3 | 4 |
| Calendar / views / config / git / rank | 17 | 17 | 0 |

**Totals: 75 tools · 17 with parameter-level drift · 2 undocumented · 1
contradicted guideline.** The pattern is uniform and mechanical: the entity
region was written against a `{key, label}` slug model, and the code moved to
`{id (ULID), name}` per **P-1** without the doc following. Users is the sole
entity family that was updated.

---

## Checked and found sound

- **`index.ts` dispatcher.** Ordering is correct and deliberate: unknown-tool
  check → schema-version guard (with `dirExists` first, so "no tracker" is not
  masked as "missing .schema-version") → prefix-rename recovery → strict arg
  parse → handler. The `.strict()` arg schema with a path-qualified error is
  the right call for an LLM caller. The domain-error/rethrow split at `:136-143`
  is well-reasoned and correctly implemented.
- **Prefix-rename recovery** honours the invariants doc's "resumable recovery
  never throws out of the boot hook" rule — failure is returned as an
  `errorResult` naming `loctt doctor`, not thrown.
- **`registry.ts`.** Duplicate-name detection at build time (`:69`) is a genuine
  guard, not decoration. `stripHandler` is pure and independently testable.
- **`runtime/fields.ts`.** The `WRITABLE_BUILTIN_FIELDS`-minus-exposed check at
  `:83-91` is subtle and correct — without it a request to set `updated_at` would
  fall through to core's custom-field path and silently write `fields.updated_at`.
  The comment explains exactly that. This is the strongest code in the slice.
- **`runtime/errors.ts`.** The `isKnownDomainError` allowlist is explicit rather
  than a `catch-all instanceof Error`, and the `FsAccessError` inclusion carries
  a comment justifying why an I/O error is user-actionable. Correct.
- **`runtime/confirm.ts`** and the `archive_*`/`delete_*` asymmetry — every one
  of the six `delete_*` tools gates on `confirm: true`; every `archive_*` does
  not. Verified across `task-crud.ts`, `project.ts`, `label.ts`, `milestone.ts`,
  `sprint.ts`, `user.ts`. `set_project_prefix` also gates, correctly, since it
  rewrites every task.
- **`runtime/workflow-assert.ts`.** Fails closed only when config is present,
  returns the known-values list in the error. Called from `create_task` for all
  three enums.
- **Entity resolution error messages** are clean and actionable where resolution
  is done properly: `unknown label: nope`, `unknown sprint: nope`,
  `unknown project: no-such` (all verified by execution). This is what makes the
  `duplicate_task` leak stand out.
- **`bulk_update_tasks` null/undefined handling** (`task-crud.ts:342`) — the
  `raw === null ? undefined : raw` mapping with its comment about JSON being
  unable to carry `undefined` is correct and non-obvious.
- **`get_task` relationship rendering** correctly prefers `resolvedKey` and falls
  back to the raw target with `missing: true` for deleted edges — **P-4**
  compliant (no ULID shown for a live task) and matching the doc.
- **`task-rank.ts`** before/after mutex is enforced at the boundary with a clear
  message, in both tools.
- **`user.ts` `delete_user`** remap/unassign mutex is checked before any
  resolution work.
- **Layering overall is good.** No business logic was found in this slice — every
  handler validates, resolves, calls core, and serializes. The only layering
  finding is the `create_project` non-atomicity, which is a missing core
  affordance rather than logic living in the wrong place.
- **`init` / `migrate_schema` schema-guard exemptions** are the only two, both
  justified in comments, and `init` independently checks for an existing
  directory before proceeding.
