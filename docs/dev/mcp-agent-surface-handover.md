# Handover: MCP agent-facing surface fixes

Findings from an audit of the MCP tool descriptions and the server
`instructions`, for a developer agent to implement in server code. The
source of truth audited was `apps/mcp/src/tools/*.ts` (91 tools) and the
`MCP_INSTRUCTIONS` constant in `apps/cli/src/commands/mcp.ts`.

The user-facing MCP reference (`docs/user/mcp/reference.md`) has been
written to describe the **intended** state below (notably `delete_comment`
carrying a `confirm` gate). Once these land, the doc will be re-checked
against the shipped code.

Each item lists the file, the change, and why. Apply the same testing
discipline the repo requires (a new test shown to fail first; if a fix
edits a green test, say the test asserted the bug).

## 1. `delete_comment` must require `confirm: true` (behavior change)

- **File:** `apps/mcp/src/tools/comments.ts` (`delete_comment`).
- **Problem:** every other destructive `delete_*` tool
  (`delete_task`, `delete_label`, `delete_milestone`, `delete_sprint`,
  `delete_project`, `delete_user`, `delete_view`) takes `confirm` and
  enforces it via `requireConfirm`. `delete_comment` does not — yet the
  server `instructions` tell the agent "delete_* tools … require
  confirm: true", so the contract is stated but not honored here.
- **Change:** add an optional `confirm: boolean` param to
  `delete_comment` and gate the handler with `requireConfirm`, exactly as
  the sibling delete tools do. Update the tool description to end with
  "Always requires `confirm: true`." to match the others.
- **Why:** consistency and safety — an auto-approved agent should not be
  able to permanently delete a comment without the same gate every other
  delete has.
- **Tests:** a call without `confirm` is refused; with `confirm: true`
  it deletes. Mirror an existing delete tool's test.

## 2. `MCP_INSTRUCTIONS`: fix the tool-name pattern (wording)

- **File:** `apps/cli/src/commands/mcp.ts` (`MCP_INSTRUCTIONS`).
- **Problem:** the text says "Use the *_list tools (list_projects,
  list_labels, …)". The naming is a `list_` **prefix**, not a `_list`
  suffix; "*_list" is wrong and could mislead.
- **Change:** replace "the *_list tools" with "the `list_*` tools".

## 3. `MCP_INSTRUCTIONS`: add the missing discovery tools (wording)

- **File:** `apps/cli/src/commands/mcp.ts` (`MCP_INSTRUCTIONS`).
- **Problem:** the instructions tell the agent to call
  `get_workflow_config` first, but never mention `list_views` (saved-view
  discovery) or `get_calendar` (timezone and working days, which date
  queries depend on).
- **Change:** extend the discovery guidance to name `list_views` for
  saved views and `get_calendar` for calendar context, alongside the
  existing `list_*` reference-discovery line.

## 4. `export_tasks` description overstates its structure (wording)

- **File:** `apps/mcp/src/tools/task-crud.ts` (`export_tasks`).
- **Problem:** the description says unreadable tasks are named "in an
  `unreadable` field", but the tool returns raw CSV/JSON text with a
  prose `Warning:` line prepended — there is no structured `unreadable`
  field in that output.
- **Change:** reword to "named in a warning line" (or add a structured
  field — but wording is the low-risk fix). Match whatever the handler
  actually emits.

## 5. `create_task` `project` description is narrower than the input (wording)

- **File:** `apps/mcp/src/tools/task-crud.ts` (`create_task`).
- **Problem:** the `project` param says "Project key (slug)", but project
  resolution accepts slug, id, or name (as other tools' descriptions
  state).
- **Change:** confirm the resolver accepts slug/id/name for `create_task`,
  and if so, reword to "Project slug, id, or name." Keep it accurate to
  the resolver — do not widen the doc past the code.

## 6. `migrate_schema` `confirm` has different semantics — clarify (wording)

- **File:** `apps/mcp/src/tools/tracker.ts` (`migrate_schema`).
- **Problem:** on every other tool `confirm: true` is an are-you-sure
  gate. On `migrate_schema`, `confirm: false` previews and `confirm: true`
  applies — a mode toggle. An agent generalizing "confirm = are you sure"
  could misread it.
- **Change:** the description already explains the preview/apply behavior;
  add one explicit sentence distinguishing it from the safety-gate
  `confirm` used elsewhere, e.g. "Unlike the delete tools, `confirm` here
  is a preview/apply toggle, not a safety gate."

## 7. Even out terse tool descriptions (wording, optional)

- **Files:** `task-archive.ts`, `task-links.ts`, `git.ts`, and other
  one-line descriptions.
- **Problem:** some tools carry rich descriptions of side effects while
  others are one line. For example `link_tasks` performs a cycle check and
  an archived-target guard, none of which is in its "Add a relationship
  between tasks." description.
- **Change (optional, lower priority):** add a sentence to the terse ones
  documenting their notable side effects, so an agent reading only the
  schema learns the guardrails.

## Not a code change — a CLAUDE.md staleness note (for the human)

`CLAUDE.md` cites "`unarchiveView` is exported from core and called by
nothing at all" as an example of drift. That is stale: `unarchive_view`
is a registered MCP tool (`apps/mcp/src/tools/views.ts`), paired with
`archive_view`. Flagging for the human to update the example in CLAUDE.md
— an agent should not edit CLAUDE.md unprompted.
