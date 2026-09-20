# AI Agent Setup

After [connecting LocTT via MCP](../quickstart-mcp.md), your AI agent can create, query, and update tasks using structured tools. But for it to follow your project's specific workflow conventions, you need to give it instructions.

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

You don't need to instruct the agent about any of this. It will get validation errors if it tries invalid values, and it can call `get_workflow_config` to discover what's available.

## What you should configure

Project-specific conventions that go beyond structural validation:

### Status transitions

If your workflow has rules about how tasks move between statuses, state them explicitly. The MCP server doesn't enforce transition order — any valid status can be set on any task. Use your own status keys; the example below uses the default set (`backlog`, `in_progress`, `done`, `wont_do`).

```markdown
## Task Management

Status transitions:
- New tasks start as `backlog`
- Move to `in_progress` only when actively working on it
- Only move to `done` after the work is merged or shipped
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
- Run `list_tasks` with view "recent-open" to see current state
- Check if a task already exists for what you're about to do
- If working on an existing task, move it to `in_progress`

During work:
- Update the task body with progress notes using `append_task_body`
- If you discover subtasks, create them and link with `parent` relationship

After completing work:
- Update status to `done`
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
- Use `relates_to` for a soft association (related work, but not blocking)
```

## Full example

Here's a complete section you could add to your `CLAUDE.md`:

```markdown
## LocTT — Task Tracking

This project uses LocTT for task tracking. Tasks are managed via MCP tools — never edit `.loctt/` files directly.

### Workflow rules
- New tasks start as `backlog`
- Move to `in_progress` when you begin work
- Move to `done` only after the change is merged
- `wont_do` requires a comment explaining why

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

## Permissions and control

### Where the fence is

LocTT itself has **no permission layer** — no per-tool access control and
no read-only mode. Any tool the agent can call, it can run. The **only**
thing standing between the agent and a destructive action is your MCP
client's approval prompt (or your allowlist).

In particular: the `delete_*` tools require a `confirm: true` argument, but
**the agent supplies that argument itself** — it is not a prompt to you.
"Requires confirm" means the tool refuses if the agent forgets the flag; it
does not mean a human is asked. Your client's approval is the human gate.

To run an agent **read-only**, allowlist only the read tools (`get_*`,
`list_*`, `export_tasks`) and leave everything else to prompt.

### What to auto-approve

| Auto-approve | Review each call | Never auto-approve |
|---|---|---|
| Reads: `get_task`, `list_tasks`, `get_task_history`, `list_*`, `get_workflow_config`, `export_tasks` | Field writes: `create_task`, `update_task`, `unset_field`, `append_task_body`, `replace_task_body`, `post_comment`, `link_tasks`, `archive_task` | Permanent deletes: `delete_task`, `delete_project`, `delete_label`, `delete_milestone`, `delete_sprint`, `delete_view`, `delete_comment` |
| | Bulk writes (up to 500 tasks at once): `bulk_update_tasks`, `move_task` | Tracker-wide rewrites: `set_project_prefix` |
| | `attach_file` (see below) | Schema, backup, and sync: `migrate_schema`, `backup`, `restore`, `enable_git`/`disable_git`, `publish_to_git`, `sync_from_git` |
| | | Identity: `switch_user`, `set_config_value` |

The "never auto-approve" column is either irreversible or has tracker-wide
blast radius — `set_project_prefix` renames every task's key,
`publish_to_git` pushes your data to a remote, `switch_user` changes who
every surface acts as. Prefer the reversible `archive_*` tools over
`delete_*`, and **take a `backup` before turning an agent loose on real
data.**

**`attach_file`** copies a file into a task's `attachments/`. `source_path`
is confined to inside the tracker root — a path outside it (`~/.ssh/id_rsa`,
a `.env` in another project) is refused, so the agent can't reach arbitrary
files on the machine. The residual risk is a sensitive file *staged inside
the tracker*: once attached it lives in `.loctt/` and may be committed or
synced. `detach_file` only removes files already in a task's attachments,
so it's safe to allowlist.

### Scoping an agent to one project

There is **no per-project scoping.** The MCP server binds to a *tracker*
(the directory with `.loctt/`), and an agent connected to it can see and
change **every project in that tracker**. If you need an agent confined to
one project, give it its own tracker in its own directory — separate
`.loctt/` directories are the isolation boundary.

### Auditing what the agent did

Every change records **who made it**: the actor is the current user. So the
cleanest way to tell an agent's work from your own is to **give the agent
its own user** and switch to it for the agent's session
(`loctt user create "Agent" --switch`, or have the agent's client run as
that user). Then `loctt log <task>` and the Activity tab attribute each
entry.

History is **per task** — there is no single tracker-wide "everything the
agent touched this session" view. To review a session, check the history
of the tasks it worked on.

### Concurrent edits

LocTT and the MCP server share the same files, with no cross-surface lock
outside git-sync. If you edit a task while an agent writes to it:

- **Field updates** (`update_task`) are last-write-wins — whoever writes
  last wins, silently.
- **Body edits** are last-write-wins too, unless the agent passes the
  `body_token` from its read (which refuses a stale write). You can't force
  the agent to do this.

So while an agent is running against a tracker, assume a task you're both
touching can be clobbered in either direction. For real concurrent work,
let the agent finish, or keep to different tasks.

## Notes

- The agent can always call `get_workflow_config` to discover available statuses, priorities, types, and relationships at runtime. You don't need to list every valid value.
- These instructions are about conventions and judgment calls — the kind of thing you'd tell a new team member, not what a schema enforces.
- Keep instructions concise. Agents work better with clear rules than lengthy explanations.
