# AI Agent Setup

After [connecting LocTT via MCP](getting-started.md#mcp-setup-ai-agent-integration), your AI agent can create, query, and update tasks using structured tools. But for it to follow your project's specific workflow conventions, you need to give it instructions.

This guide covers what to put in your agent's instruction file — `CLAUDE.md` for Claude Code, `.cursorrules` for Cursor, or whatever your tool uses.

## Naming convention

Include "LocTT" in your section headers, prefixes, or tags so the instructions are easy to find and remove if you ever uninstall LocTT from the project. The exact style should match your existing docs — some examples:

```markdown
## LocTT — Task Tracking
```
```markdown
### Task Management (LocTT)
```
```markdown
- [LocTT] Check `list_tasks` before starting work
```
```markdown
<!-- loctt -->
...instructions...
<!-- /loctt -->
```

Use whatever convention fits — the only requirement is that searching for "LocTT" (case-insensitive) finds all related instructions for cleanup.

## What the MCP server already handles

The MCP tools enforce structural constraints automatically:

- Only valid status/priority/type keys are accepted (from `workflow.yaml`)
- Relationships are validated against configured types
- Task identity (ID, key) is managed by the system
- Frontmatter is never edited directly — all changes go through validated tools

You don't need to instruct the agent about any of this. It will get validation errors if it tries invalid values, and it can call `get_config` to discover what's available.

## What you should configure

Project-specific conventions that go beyond structural validation:

### Status transitions

If your workflow has rules about how tasks move between statuses, state them explicitly. The MCP server doesn't enforce transition order — any valid status can be set on any task.

```markdown
## Task Management

Status transitions:
- New tasks start as `not_started`
- Move to `in_progress` only when actively working on it
- Move to `in_review` when a PR is open
- Only move to `done` after the PR is merged
- Use `blocked` when waiting on an external dependency — add a comment explaining what's blocking
- `wont_do` requires a comment explaining why
```

### Task description conventions

Tell the agent what a well-structured task looks like.

```markdown
## Task Descriptions

When creating tasks:
- Title should be a short imperative phrase ("Add pagination to task list", not "Pagination")
- Set priority based on: critical = production broken, high = blocks other work, medium = planned work, low = nice-to-have
- Set task_type: bug for defects, feature for new functionality, task for everything else
- Body should include:
  - Context: why this task exists
  - Acceptance criteria: what "done" looks like
  - Notes: any relevant technical details or links
```

### Workflow patterns

Define how the agent should interact with tasks during its work.

```markdown
## Workflow

Before starting work:
- Run `list_tasks` with view "active" to see current state
- Check if a task already exists for what you're about to do
- If working on an existing task, move it to `in_progress`

During work:
- Update the task body with progress notes using `append_task_body`
- If you discover subtasks, create them and link with `parent` relationship

After completing work:
- Update status to `in_review` or `done` as appropriate
- Add a summary of what was done to the task body
```

### Query conventions

Point the agent at your saved views.

```markdown
## Queries

Useful saved views:
- `recent-open` — all active, non-archived tasks sorted by last update
- `blocked` — tasks that need attention
- Use `list_tasks` with the appropriate view before starting a session
```

### Relationship conventions

If you use relationships in specific ways, document them.

```markdown
## Task Relationships

- Use `parent`/`child` for breaking work into subtasks
- Use `blocks` when one task literally cannot proceed until another is done
- Use `depends_on` for softer dependencies (would benefit from, but not blocked)
```

## Full example

Here's a complete section you could add to your `CLAUDE.md`:

```markdown
## LocTT — Task Tracking

This project uses LocTT for task tracking. Tasks are managed via MCP tools — never edit `.loctt/` files directly.

### Workflow rules
- New tasks start as `not_started`
- Move to `in_progress` when you begin work
- Move to `in_review` when a PR is open for review
- Move to `done` only after the change is merged
- Use `blocked` with a comment explaining what's blocking

### Creating tasks
- Title: short imperative phrase
- Always set priority and task_type
- Body should include context and acceptance criteria
- Check for existing tasks before creating duplicates

### During work
- Check `list_tasks` (view: "recent-open") at the start of each session
- Update task body with progress notes
- Create subtasks for discovered work, linked with `parent`
- Update status as work progresses

### Queries
- `recent-open` — active tasks by last update
- `blocked` — tasks needing attention
```

## Permissions and auto-approval

Most MCP clients (Claude Code, Cursor, etc.) let you pre-approve specific tool calls so the agent doesn't prompt every time. Most LocTT tools are safe to allowlist — they only read and write inside `.loctt/`.

**Do not auto-approve `attach_file`.** It takes an absolute filesystem path and copies that file into the task's `attachments/` directory. The MCP server runs with your user's permissions, so any path you can read, the agent can attach — including secrets like `~/.ssh/id_rsa`, `~/.aws/credentials`, browser cookie stores, or `.env` files in other projects. Once copied into `.loctt/`, those contents may be committed, pushed, or synced to other machines.

Treat `attach_file` like a file-upload dialog: review every call before approving it, and check that `source_path` points where you expect. `detach_file` is safe to allowlist — it can only remove files already inside the task's attachments directory.

## Notes

- The agent can always call `get_config` to discover available statuses, priorities, types, and relationships at runtime. You don't need to list every valid value.
- These instructions are about conventions and judgment calls — the kind of thing you'd tell a new team member, not what a schema enforces.
- Keep instructions concise. Agents work better with clear rules than lengthy explanations.
