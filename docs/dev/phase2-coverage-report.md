# Phase 2 — CLI/MCP coverage measurement

Read-only measurement. No file in the repo was modified. No suite was run;
every claim below comes from reading test sources and the shipped
command/tool implementations.

## Summary

- **CLI: 17 of 49 covered, 12 partial, 20 uncovered.**
- **MCP: 26 of 75 covered, 11 partial, 38 uncovered.**

Coverage is sharply **bimodal**, and the split is not random. The *task*
surface — create, list, show, set, unset, body, log, link, unlink,
archive, unarchive, delete, attach, detach, comments, config, git — is
genuinely well tested on both surfaces, with dedicated integration files,
error paths, edge cases (empty/100KB/unicode/`---` bodies), and
cross-surface parity. That is roughly 60% of real usage and it is in good
shape.

The *entity-management* surface — users, labels, milestones, sprints, and
most of projects — is close to untested at the surface layer on both CLI
and MCP. `loctt user`, `loctt label`, `loctt calendar` and `loctt rerank`
appear in **no test file anywhere in the repo**. On MCP, 30 tools appear
only inside `tests/e2e/11-mcp-schema-contract.test.ts`, which snapshots
tool *names* and whether a description is non-empty — it never calls them.
Registration is not behaviour.

Critically, the measurement also found that **both reference docs are stale
for exactly the region that is untested**. The Labels/Milestones/Sprints
sections of both docs describe a `key` + `label` API that the shipped code
no longer has (it takes `name`, resolved as `name|id`). Two MCP tools
(`duplicate_task`, `move_task`) and two CLI commands (`duplicate`, `move`)
ship and are wholly undocumented. This is the expected consequence of an
untested surface: the docs drifted and nothing failed.

**Judgement: this warrants a medium hardening pass, not a large one, and
the doc drift must be resolved before any of it is written.** The task
surface does not need work. The entity surface needs roughly 25–35 focused
integration tests. But the reference docs cannot currently serve as the
specification for the exact commands that most need tests — writing tests
against them today would encode a nonexistent API, and writing tests
against the code would be an agent grading its own work, which is the
failure mode this whole plan exists to prevent. **This is an escalation
under the plan's rules: an agent may not adjudicate whether the doc or the
code is correct.**

---

## CLI commands

`covered` = behaviour + error paths + output shape asserted.
`partial` = happy path asserted, gaps named.
`uncovered` = nothing meaningfully targets it at the CLI layer.

Where a command is `uncovered` at the CLI layer, the underlying core
function is generally well covered in `packages/core` — that is called out
because it changes the severity. An uncovered CLI command over tested core
risks flag parsing, ref resolution, confirmation gating, exit codes and
output formatting; it does not risk data corruption in the core operation
itself.

| Command | State | What is asserted | Gap | Severity |
|---|---|---|---|---|
| `init` | covered | `tests/integration/cli/init.test.ts` (prefix, project-label, defaults), `tests/e2e/02-init-variants.test.ts` (`--no-docs`, re-init refused), `cli.test.ts:688` accepts every documented flag | `--timezone` is accepted but its *effect* (zone written to `calendar.yaml`; bad zone rejected before writing) is never asserted | minor |
| `info` | partial | runs and prints after init; fails fast on too-new schema (`cli.test.ts:1047`) | documented `Next keys` per-project block and the `*` default marker are never asserted; no-tracker hint path not asserted | minor |
| `doctor` | partial | runs cleanly on a fresh workspace | `--rebuild-index` never exercised; exit 1 on an error-state check never asserted; the key-index drift → `!` path (the flag's whole reason to exist) untested | major |
| `views` | covered | `tests/integration/cli/views.test.ts` lists saved views | sort-suffix rendering not asserted | minor |
| `schema` | covered | `tests/integration/cli/schema.test.ts`, incl. non-default prefix | — | — |
| `project list` | uncovered | nothing | `--all`, archived hiding, `*` default marker | minor |
| `project create` | partial | used as setup in `cli.test.ts:109` (`--flag=value` form) and in set-prefix fixtures | never asserted as a subject: `--default`, duplicate-prefix rejection, output shape | major |
| `project edit` | uncovered | nothing | rename path entirely | minor |
| `project set-prefix` | covered | best-tested command in the repo — `tests/integration/cli/set-prefix.test.ts` (6 tests: rename, key_history resolvability, counter carry-over, collision-writes-nothing, unknown project, non-TTY refusal) plus `cli.test.ts:1151` (5 more incl. blast-radius message, own-prefix no-op) | interrupted-rename recovery is asserted in core, not here | — |
| `project archive` / `unarchive` | uncovered | nothing | soft-hide + reference preservation | minor |
| `project delete` | uncovered | nothing at CLI layer (core `projects/manage.test.ts` covers the operation) | **`--remap-to` and the `--yes` confirmation gate are unasserted at the CLI layer.** No test anywhere passes `--remap-to` to any CLI command | **blocker** |
| `project set-default` | uncovered | nothing | set and the documented `-` clear form | major |
| `user list` | uncovered | the string `"user"` appears in no test file | `--all`, `*` current marker | minor |
| `user current` | uncovered | nothing | — | minor |
| `user switch` | uncovered | nothing | identity switching is the attribution mechanism for every history entry | major |
| `user create` | uncovered | nothing | `--switch`, `--email`, `--timezone`, `--avatar` | major |
| `user edit` | uncovered | nothing | — | minor |
| `user archive` / `unarchive` | uncovered | nothing | active-user guard | major |
| `user delete` | uncovered | nothing at CLI layer | **`--remap-to` / `--unassign` mutual exclusion is documented and unasserted at both surfaces**; destructive, rewrites assignee/reporter across tasks | **blocker** |
| `label list` | uncovered | the string `"label"` appears in no test file | `--all` | minor |
| `label create` | uncovered | nothing | — | major |
| `label edit` | uncovered | nothing | documented `--color -` clear form | minor |
| `label archive` / `unarchive` | uncovered | nothing | — | minor |
| `label delete` | uncovered | nothing at CLI layer | drops the key from **every task** that has it; `--remap-to` and `--yes` unasserted | **blocker** |
| `milestone list` | partial | `tests/integration/cli/milestone-progress.test.ts` (5 tests) covers `--progress` thoroughly: category-derived, discarded excluded from denominator and named, 0/0, all-discarded reads complete | `--all` and `--ids` unasserted; base listing only implied | minor |
| `milestone create` | partial | used as setup only in the progress test | `--target-date` never asserted | major |
| `milestone edit` | uncovered | nothing | `--target-date -` clear, `--archived true\|false` literal-only validation | major |
| `milestone archive` / `unarchive` | uncovered | nothing | — | minor |
| `milestone delete` | uncovered | nothing at CLI layer | clears the field on every referenced task; `--remap-to`, `--yes` | **blocker** |
| `sprint list` | uncovered | nothing | `--all` | minor |
| `sprint create` | partial | setup only, in `cli.test.ts` burndown tests | `--state` default of `future`, `--goal`, date validation | major |
| `sprint edit` | uncovered | nothing | **`--force` re-open gate on a completed sprint** — a documented guard with no test; `--goal -` clear | major |
| `sprint archive` / `unarchive` | uncovered | nothing | — | minor |
| `sprint delete` | uncovered | nothing at CLI layer | `--remap-to`, `--yes` | **blocker** |
| `sprint burndown` | covered | `cli.test.ts:396–471`: table default, `--format json` parseable, unresolved name exits cleanly, unknown `--format` rejected | unit-selection rules (points/hours/weights/count) asserted in core, not here | — |
| `calendar show` | uncovered | the string `"calendar"` appears in no CLI test | whole command | minor |
| `create` | covered | integration (key printed, default status), `cli.test.ts` per-user `default_project` resolution (3 tests), enum pre-validation for `--status`/`--priority`/`--type` each exiting 2 with a `Known:` hint | — | — |
| `list` | covered | archived hiding/`--archived`/explicit query filter, unparseable query error, empty-result exit 0, missing `queries.yaml`, unknown view error, stale-view stderr warning + exit 0 | `--limit` and `--project` composition (`(<query>) and project = <key>`) never asserted | major |
| `show` | covered | title/key, ULID resolution, nonexistent ref, empty ref usage, attachment listing, deleted-target ULID truncation | — | — |
| `set` | covered | single-field update, bulk multi-ref, per-task failure with non-zero exit, trailing comma, unknown-enum exit 2, missing-task runtime error | **500-task cap and shared `bulk_op_id` unasserted at CLI layer** (both covered in core) | major |
| `comment` / `comments` | covered | add, list, empty-list message, edit marks edited, delete, missing body non-zero, unknown task non-zero, CLI↔MCP visibility | `@user:<id>` mention resolution and the documented drop-on-unresolvable behaviour untested at either surface | major |
| `comment-edit` | covered | edits and marks edited | cross-author editor provenance not asserted | minor |
| `comment-delete` | covered | deletes | — | — |
| `unset` | covered | clears a field; bulk clear across tasks | same bulk-cap gap as `set` | minor |
| `body` | covered | set/read, append with blank-line separator, `--set`+`--append` mutual exclusion exit 2, empty string as set-to-empty, 100KB, unicode, `---` delimiter safety, append-to-fresh has no leading newlines | — | — |
| `log` | covered | history entries; `--limit` non-integer exit 2, negative exit 2, `=0` returns nothing but is not an error | — | — |
| `attach` | covered | copy, duplicate rejected without `--force`, `--force` overwrites, `show` lists it, directory/nonexistent/symlink sources rejected, basename-only extraction | — | — |
| `detach` | covered | removes, missing fails, path-traversal name rejected | — | — |
| `link` | covered | creates; unknown type, nonexistent target, self-link, nonexistent source, structural cycle, `graph: none` cycle allowed, `graph: acyclic` cycle rejected | — | — |
| `unlink` | covered | removes a link | — | — |
| `rerank` | uncovered | the string `"rerank"` matches only `board-rerank` in `cli.test.ts`; the relationship-edge `rerank` command has no test | `--before`/`--after`/neither, mutual exclusion | major |
| `board-rerank` | covered | `cli.test.ts:193–335`: `--before` places ahead, `--after` places behind, neither moves to end, both rejected, unresolved ref exits cleanly, missing arg is usage error | — | — |
| `archive` | covered | hides from list, still shows directly; already-archived surfaces a domain error | — | — |
| `unarchive` | covered | restores to list | — | — |
| `delete` | partial | `--yes` removes from disk; non-TTY without `--yes` exits 2; nonexistent errors | **two e2e tests pass a `--hard` flag that does not exist** — see Defects below | major |
| `mcp` | uncovered | no test starts the server via `loctt mcp`; MCP integration uses its own stdio adapter | the documented CLI entry point to the MCP server | minor |
| `ui` | partial | `tests/integration/cli/web-startup.test.ts` starts it and kills it | `--port` and `--no-open` not asserted as behaviour | minor |
| `git enable/disable/status/publish/sync` | covered | `cli.test.ts:867–948` plus `tests/integration/git/` (no-remote: 5 tests; with-remote: 6 incl. auto_push on/off, auto_fetch, unreachable-remote exit 0 + durable local commit, custom branch, two-clone merge) and two e2e journeys | — | — |
| `config get/set/unset/list` | covered | round-trip after git enable, default before enable, unknown key exit 1, set-before-enable clean error, case-insensitive booleans, unparseable boolean lists accepted forms, `list` prints all known keys | — | — |
| `migrate` | partial | no-op when current; `--dry-run` does not crash on a fresh tracker | **an actual migration is never run through the CLI**; `--yes`, the plan output, the backup write, and the confirmation prompt are unasserted (core `schema/migrate.test.ts` covers the migration itself) | major |
| `duplicate` | covered | `tests/integration/cli/duplicate.test.ts`: copies fields+body with fresh key, title override, does not copy relationships, source untouched, unknown task non-zero | **not documented in `cli/reference.md`** | major (doc) |
| `move` | uncovered | dispatched at `apps/cli/src/index.ts:104`, no CLI test | **not documented in `cli/reference.md`**; core `task/move.test.ts` covers the operation | major (doc) |

---

## MCP tools

The 75 sections in `mcp/reference.md` include several that document a pair
(`archive_X` / `unarchive_X`); rows below follow the doc's headings.

`registration-only` is used where the sole mention is the name snapshot in
`tests/e2e/11-mcp-schema-contract.test.ts`. That file asserts the tool
exists and has a non-empty description. It never invokes it.

| Tool | State | What is asserted | Gap | Severity |
|---|---|---|---|---|
| `init` | covered | `tests/integration/mcp/init.test.ts` (bootstrap at bound root; `project_label`+`prefix` keyed to project id), schema-guard exemption (`mcp.test.ts:93`) | already-exists error not asserted | minor |
| `info` | partial | returns prose summary | documented `Next keys` block unasserted | minor |
| `doctor` | partial | returns prose diagnostic output | `rebuild_index` parameter never passed | major |
| `create_task` | covered | writes to disk, default status matches CLI, unknown status → `Known:` hint, valid status accepted, strict-mode unknown-arg rejection | the 4-step project-resolution ladder (explicit → per-user default → workspace default → sole project) is asserted on the CLI but not through MCP | major |
| `get_task` | covered | by key, relationship targets as keys not raw IDs, empty/known/unknown-extension attachment `mime`, `include_body=false`, `relationships` omitted when empty, nonexistent ref, ULID, empty ref | `missing: true` on a deleted relationship target is asserted CLI-side only | minor |
| `list_tasks` | covered | all tasks, archived hidden by default, `include_archived=true`, stale-saved-view warning prefix and clean body for healthy view | `limit`, `project` AND-merge, and the documented "unknown field is an error not `[]`" rule unasserted at MCP | major |
| `list_views` | covered | returns views without error | `No saved views configured.` prose branch unasserted | minor |
| `get_workflow_config` | covered | returns the configuration | — | — |
| `update_task` | covered | strongest-tested MCP tool: immutable-field rejection, auto-managed rejection, bad `labels` shape, non-string title, missing field arg, valid labels, workflow-invalid status forwarded, `updated_at` rejected, unknown fields forwarded to the workflow validator | date/`estimate`/`milestone`/`sprint` value shapes unasserted | minor |
| `unset_field` | covered | immutable rejected, `title` rejected as required, auto-managed rejected, clears a built-in optional | — | — |
| `list_comments` / `post_comment` / `edit_comment` / `delete_comment` | covered | post-list-edit-delete round trip, sees a CLI-written comment, empty body errors rather than writing | `editors` provenance and mention resolution unasserted | major |
| `migrate_schema` | covered | previews by default, no-op on confirm when current, clear error when tracker is newer, exempt from the boot guard | an actual migration never runs through MCP | major |
| `bulk_update_tasks` | covered | sets across several and reports the split, clears when value omitted, bad ref reported without aborting | 500 cap and `bulk_op_id` stamping unasserted at MCP (both in core) | major |
| `delete_task` | covered | rejected without `confirm`, removes with `confirm: true`, nonexistent errors | — | — |
| `archive_task` / `unarchive_task` | covered | archive, restore, and the archive-is-the-soft-path contract | — | — |
| `replace_task_body` | covered | replaces; empty string, 100KB, unicode, `---` delimiter | — | — |
| `append_task_body` | covered | appends | separator behaviour asserted CLI-side only | minor |
| `get_task_history` | partial | entries newest first | `limit` never passed | minor |
| `attach_file` | covered | absolute path, collision `isError` without force, `force: true` overwrites, relative path rejected with a clear message | — | — |
| `detach_file` | covered | detaches; `isError` when absent | — | — |
| `list_projects` | registration-only | name exists | return shape `{projects, default}` | major |
| `create_project` | partial | called as setup in the confirm-gate test | never asserted as a subject; `make_default`; validation errors | major |
| `edit_project` | registration-only | name exists | rename entirely | minor |
| `set_project_prefix` | covered | `tests/integration/mcp/set-project-prefix.test.ts` (4) + `mcp.test.ts:406` (3): renames and reports count, refuses without confirm leaving keys untouched, collision refused writing nothing, stale key still resolves | — | — |
| `archive_project` / `unarchive_project` | registration-only | names exist | whole behaviour | minor |
| `delete_project` | partial | confirm-gate refusal only (`mcp.test.ts:343`) | **the successful delete path, `remap_to`, `retired_keys` counter preservation, and the lone-project guard are all unasserted at MCP** | **blocker** |
| `set_default_project` | registration-only | name exists | set and clear-by-omission | major |
| `list_users` | partial | setup use only | return shape `{current, users}`, `include_archived` | major |
| `get_current_user` | registration-only | name exists | profile shape; `no users registered` error | major |
| `switch_user` | registration-only | name exists | identity switching — the attribution mechanism for all history | major |
| `create_user` | partial | setup use in the delete_user confirm test | `switch_to_on_create`, returned JSON, non-unique names | major |
| `edit_user` | registration-only | name exists | `email: null` clear | minor |
| `archive_user` / `unarchive_user` | registration-only | names exist | **the documented "blocked when the target is the active user" guard is unasserted** | major |
| `delete_user` | partial | confirm-gate refusal only | **`remap_to` / `unassign` mutual exclusion, the active-user block, and the successful delete are all unasserted** | **blocker** |
| `list_labels` | registration-only | name exists | return shape | minor |
| `create_label` | partial | setup use only | `color`, validation | major |
| `edit_label` | registration-only | name exists | `color: null` clear | minor |
| `archive_label` / `unarchive_label` | registration-only | names exist | whole behaviour | minor |
| `delete_label` | partial | confirm-gate refusal only | successful delete drops the key from every task; `remap_to` | **blocker** |
| `list_milestones` | registration-only | name exists | return shape (and the undocumented `progress` parameter the code accepts) | major |
| `create_milestone` | partial | setup use only | `target_date` | major |
| `edit_milestone` | registration-only | name exists | `target_date: null` clear, `archived` | major |
| `archive_milestone` / `unarchive_milestone` | registration-only | names exist | whole behaviour | minor |
| `delete_milestone` | partial | confirm-gate refusal only | successful delete unsets the field on every referenced task; `remap_to` | **blocker** |
| `list_sprints` | registration-only | name exists | return shape | minor |
| `create_sprint` | partial | setup use only | `goal`, date validation, `state` enum rejection | major |
| `edit_sprint` | registration-only | name exists | **the `force` gate on re-opening a completed sprint** — a documented guard with no test at either surface; `goal: null` clear | major |
| `archive_sprint` / `unarchive_sprint` | registration-only | names exist | whole behaviour | minor |
| `delete_sprint` | partial | confirm-gate refusal only | successful delete unsets the field on every referenced task; `remap_to` | **blocker** |
| `get_calendar` | registration-only | name exists | whole tool (and CLI `calendar show` is equally untested, so the config has no surface coverage at all) | major |
| `link_tasks` | covered | creates; unknown type, nonexistent target, self-link, tree cycle, `graph: none` cycle allowed, nonexistent source | — | — |
| `unlink_tasks` | covered | removes a relationship | — | — |
| `reorder_relationship` | registration-only | name exists | `before`/`after`/neither and the documented mutual-exclusion error message. Its sibling `reorder_board` has 6 tests; this has none. CLI `rerank` is equally uncovered, so this behaviour has **no surface coverage on either front-end** | major |
| `get_sprint_burndown` | covered | `mcp.test.ts:457`: series for a known sprint, clean error for unknown | unit-selection asserted in core only | — |
| `reorder_board` | covered | `mcp.test.ts:489`: schema registration, before, after, neither→end, both rejected, unresolved ref | — | — |
| `get_config_value` | covered | structured JSON with key/value/type | `unknown config key` error unasserted at MCP | minor |
| `set_config_value` | covered | sets and echoes the change | boolean coercion forms asserted CLI-side only | minor |
| `unset_config_value` | covered | unsets and echoes | — | — |
| `list_config_values` | covered | array with type and description | — | — |
| `enable_git` | covered | enables git-backed mode | — | — |
| `disable_git` | covered | disables after enabling | — | — |
| `get_git_status` | covered | structured JSON describing state | — | — |
| `publish_to_git` | covered | commits to the loctt branch | `No changes to publish` and push-failure prose branches unasserted at MCP (covered CLI-side) | minor |
| `sync_from_git` | covered | syncs the branch into the workspace | `Already up to date` branch unasserted at MCP | minor |
| `duplicate_task` | uncovered | present in the name snapshot only | **not documented in `mcp/reference.md`** | major (doc) |
| `move_task` | uncovered | present in the name snapshot only | **not documented in `mcp/reference.md`** | major (doc) |

---

## Gaps worth closing, ranked

**0. Resolve the reference-doc drift first. This blocks the rest.**
Not a test gap — a specification gap, and it must go to the user rather
than to an agent. Three findings:

- **Labels, milestones and sprints are documented with a `key` + `label`
  API that does not exist in the shipped code.** `mcp/reference.md` says
  `create_label {key, label, color}`; the code
  (`apps/mcp/src/tools/label.ts:33`) takes `{name, color}`. Same for
  `create_milestone`, `create_sprint`, and every `edit_*` / `delete_*` /
  `archive_*` in those three families, which take `{label}` / `{milestone}`
  / `{sprint}` as an id-or-name ref rather than `{key}`. `cli/reference.md`
  has the matching drift: it documents `loctt label create <key> [--label
  <label>]` where the code
  (`apps/cli/src/commands/label.ts:38`) implements `loctt label create
  <name> [--color <hex>]`. `project` and `user` are accurate in both docs;
  the MCP project tools use `{project}` where the doc says `{key}`.
- **`duplicate` / `duplicate_task` and `move` / `move_task` ship on both
  surfaces and appear in neither reference doc.** `duplicate` has good CLI
  integration coverage; `move` has none at either surface.
- The plan says the agent may not edit the reference docs, and may only
  transcribe cases *from* them. Both instructions are unexecutable over
  this region: transcribing produces cases for an API that does not exist,
  and the alternative — writing cases from the code — is precisely the
  self-grading failure the plan is built to prevent. **Escalated, per the
  plan's escalation rule.**

**1. The `remap_to` / `--remap-to` path on every entity delete.**
`project`, `label`, `milestone`, `sprint`, `user` — ten commands and tools.
The literal string `--remap-to` appears in no test file in the repo, and
`remap_to` is passed to no MCP tool in any test. These are the most
destructive operations either surface offers: deleting a label rewrites the
`labels` array on every task carrying it; deleting a user rewrites
assignee/reporter across the tracker. Core covers the rewrite itself
(`labels/manage.test.ts`, `users/manage.test.ts`, etc.), so the risk is
specifically in the surface plumbing — that the flag/parameter is parsed
and threaded into the core option at all. A `--remap-to` silently dropped
by an arg-parsing bug degrades to the unset path and destroys the field on
every affected task, with a zero exit code. **Blocker. This is the single
highest-value item in the report.**

**2. `delete_user` / `loctt user delete` mutual exclusion, and the
active-user guards.** `remap_to` and `unassign` are documented as mutually
exclusive; `archive_user` / `delete_user` are documented as blocked when
the target is the active user. Neither guard is asserted anywhere. Both are
cheap to test and both fail destructively — deleting the active user leaves
the tracker with no valid attribution target. **Blocker.**

**3. The entire user-identity surface.** `loctt user` matches no test file
in the repo; `switch_user`, `get_current_user`, `create_user
{switch_to_on_create}` are registration-only. The current user is what
every history entry and every new task is attributed to, so a defect here
mis-attributes data silently and permanently. Roughly 8 tests would close
it. **Blocker in aggregate**, though no single case is.

**4. Relationship reordering has no coverage on either surface.** CLI
`rerank` and MCP `reorder_relationship` are both untested, while their
board-rank siblings (`board-rerank`, `reorder_board`) have six tests each.
The asymmetry looks like an oversight rather than a decision: the two pairs
share `--before`/`--after`/neither semantics and a mutual-exclusion error,
and the board pair's tests would port almost directly. **Major.**

**5. Two documented guards that no test exercises.**
`sprint edit --force` / `edit_sprint {force}` (re-opening a completed
sprint) and `doctor --rebuild-index` / `doctor {rebuild_index}` (repairing
key-index drift). Both are explicitly specified, both are the sole reason
their flag exists, and both are unasserted at both surfaces. `--rebuild-index`
is the documented repair path for the one drift case LocTT states it cannot
auto-detect. **Major.**

Below the cut, and worth folding into Phase 3 rather than scheduling
separately: `list --limit` / `--project` composition; `migrate` never
running a real migration through either surface; the bulk 500-cap and
`bulk_op_id` at the surface layer; comment mention resolution; `init
--timezone`'s effect on `calendar.yaml`.

**Sizing.** Items 1–5 are roughly 25–35 integration tests, mostly short and
following patterns already established in `tests/integration/`. That is a
medium pass — comparable to one Phase 4 slice, not to the UI build. It
should be scheduled *after* the doc question in item 0 is answered, because
the specification for items 1 and 2 is exactly the region that is stale.

---

## What I verified vs estimated

**Verified directly** (read the test source and the implementation):

- All 49 CLI reference sections and all 75 MCP reference sections
  enumerated from the headings of the two reference docs.
- Every test name in `apps/cli/src/cli.test.ts` (1,268 lines),
  `apps/mcp/src/mcp.test.ts` (695), `apps/mcp/src/registry.test.ts` (85),
  all 39 CLI integration files, all 34 MCP integration files, both git
  integration files, and all 11 e2e files — read as `describe`/`it` titles.
- Read in full: `tests/e2e/03-cli-full-lifecycle.test.ts`,
  `tests/e2e/04-mcp-full-lifecycle.test.ts`,
  `tests/e2e/11-mcp-schema-contract.test.ts`,
  `apps/cli/src/runtime/args.ts`, `apps/cli/src/commands/task-archive.ts`,
  `apps/cli/src/commands/label.ts`, the delete-confirm block of
  `mcp.test.ts`, and the dispatch table in `apps/cli/src/index.ts`.
- The registration-only classification for the 30 MCP tools: verified by
  grepping every tool name across the whole test tree and confirming the
  only hit is the inline snapshot in `11-mcp-schema-contract.test.ts`,
  whose body I read.
- The doc-drift finding: verified against the `inputSchema` blocks in
  `apps/mcp/src/tools/{project,label,milestone,sprint,user}.ts` and the
  `UsageError` usage strings in
  `apps/cli/src/commands/{project,label,milestone,sprint,user}.ts`, both
  compared line-by-line against the reference docs.
- The `--remap-to` / `unassign` / `bulk_op_id` / `--all` gaps: verified by
  literal string search across every `.test.ts` in `tests/`, `apps/cli`,
  and `apps/mcp` (zero hits for `--remap-to` and `--unassign`).
- The layering distinction: verified that `remapTo` and `bulkOpId` *are*
  covered in `packages/core` (`{projects,labels,users,milestones,sprints}/
  manage.test.ts`, `task/bulk.test.ts`, `task/history.test.ts`), which is
  why those gaps are reported as surface-plumbing rather than data-loss.

**Estimated, and should be treated as lower-confidence:**

- I read `packages/core`'s 79 test files as a **file listing only**, not
  their contents. Claims of the form "core covers X" rest on filename and
  on targeted greps for specific identifiers, not on reading the
  assertions. If a Phase 3 or 4 decision turns on core's actual depth in a
  given area, re-verify that area directly.
- The `covered` / `partial` split for the well-tested task commands is
  based on `it` titles plus the files I opened, not on reading every
  assertion in all 74 CLI integration tests. Titles in this repo are
  descriptive and matched the bodies wherever I checked, so I have good
  confidence, but a `covered` row could be a `partial` if a title
  overstates its assertions.
- The 1,290 core / 193 integration / 74 CLI / 61 MCP test counts are taken
  from the task brief and `autonomous-plan.md`; I did not run the suites to
  confirm them (the brief forbids it), and my file-level reading is
  consistent with them but does not verify the totals.
- Severities are my judgement against the case docs' vocabulary. I weighted
  destructive and data-writing paths above formatting, per the brief. The
  `blocker` label on the `remap_to` family is the one I would most expect a
  reviewer to want to re-examine, since core does cover the underlying
  rewrite.
- I did not measure `tests/llm/` beyond its scenario filenames and greps.
  It targets 15 agent-behaviour scenarios over the task surface; none of
  them touch the entity-management tools, which is consistent with the gap
  described above but not independently verified.
- I did not examine `apps/web` at all; it is out of scope for this phase.

---

## Defects noticed in passing

Not sought — the brief says not to hunt. Both were unavoidable while
reading the e2e suite, and both are test defects rather than shipped-code
defects.

**D1 — two e2e tests pass a `--hard` flag that does not exist, and pass for
the wrong reason.** `cli/reference.md:621` states plainly: *"There is no
`--hard` flag."* The CLI's `delete` accepts only `--yes`
(`apps/cli/src/commands/task-crud.ts:352`) and does not call
`rejectUnknownFlags`, so `--hard` is silently ignored.

- `tests/e2e/03-cli-full-lifecycle.test.ts:55` runs
  `delete T-1 --hard --yes` with the comment *"soft-delete is the default;
  --hard --yes removes the directory"*. It passes because `--yes` alone
  does the work.
- `tests/e2e/10-error-paths.test.ts:39` is titled *"delete on an
  already-archived task without --hard exits non-zero"* and asserts that
  the second of two bare `delete T-1` calls exits non-zero. Under current
  semantics the *first* bare `delete` already fails — it refuses in a
  non-TTY without `--yes`. The test passes, but not for the reason it
  states, and it would still pass if delete's confirmation gate were
  removed entirely.

Both are fossils of a removed "soft-delete by default, `--hard` for
permanent" design. This is the pattern CLAUDE.md calls out — *"a fix
requires editing a green test [because] that test was asserting the bug"* —
and D1's second case is worse than inert: it is a passing test whose name
claims coverage of a confirmation gate it does not exercise. Worth fixing
in Phase 3 regardless of what else is scheduled.

**D2 — `apps/mcp/src/mcp.test.ts:319` and the delete-confirm block invoke
tools with parameters matching the code, not the docs** (`create_project
{name, prefix}`, `delete_label {label}`, `delete_milestone {milestone}`,
`delete_sprint {sprint}`). The tests are correct against the shipped code;
this is listed only as corroborating evidence that the reference docs — not
the tests — are the stale artefact in finding 0.
