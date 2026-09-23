# Features

What LocTT can do, and which interface reaches each capability. If you
haven't yet, skim [Concepts](common/concepts.md) first — this page assumes
you know what `.loctt/` is and how it's shared.

The three interfaces are the **CLI** (`loctt`), the **MCP** server (agent
tools), and the **web UI** (`loctt ui`). They read and write the same
tracker, so a capability supported by two of them means the same thing done
two ways.

## Support at a glance

| Feature | CLI | MCP | UI |
|---|---|---|---|
| Tasks (create, edit, move, duplicate) | ✅ | ✅ | ✅ |
| Markdown body | ✅ | ✅ | ✅ |
| Relationships / links | ✅ | ✅ | ✅ |
| Attachments | ✅ | ✅ | ✅ |
| Comments | ✅ | ✅ | ✅ |
| Activity log | ✅ | ✅ | ✅ |
| Archive and delete | ✅ | ✅ | ✅ |
| Query language | ✅ | ✅ | ✅ |
| Saved views | ✅ | ✅ | ✅ |
| Sorting and pagination | ✅ | ✅ | ✅ |
| Projects | ✅ | ✅ | ✅ |
| Users | ✅ | ✅ | ✅ |
| Labels | ✅ | ✅ | ✅ |
| Sprints | ✅ | ✅ | ✅ |
| Milestones | ✅ | ✅ | ✅ |
| Custom fields | ✅ | ✅ | ✅ |
| Configurable workflow | *read* | *read* | ✅ |
| Calendar | *read* | *read* | ✅ |
| Board (Kanban) | ✅ | ✅ | ✅ |
| Timeline (Gantt) | — | — | ✅ |
| Git-backed sync | ✅ | ✅ | ✅ |
| Backup and restore | ✅ | ✅ | ✅ |
| Diagnostics | ✅ | ✅ | ✅ |
| Schema migration | ✅ | ✅ | ❌ |

✅ full support · *read* = read-only · — presented differently (a board and
timeline are UI views over the same tasks the CLI and MCP list) · ❌ not
available

Two things the table is telling you:

- **The workflow and calendar are read-only outside the UI.** The CLI and
  MCP can *read* your statuses, priorities, types, relationships, and
  working calendar, but changing them happens in the web UI (Settings) or by
  editing the config files. Everything else is fully writable from every
  interface.
- **Schema migration is CLI/MCP-only.** Upgrading the on-disk schema
  (`loctt migrate` / `migrate_schema`) is deliberately not a UI action.

## Where each capability is documented

- **From the terminal** — every command and flag: the
  [CLI reference](cli/reference.md).
- **From an agent** — every tool and example flows: the
  [MCP reference](mcp/reference.md).
- **In the browser** — every screen: the [Web UI guide](ui/guide.md).

For the concepts behind the features:

- [Configuration](common/configuration.md) — statuses, priorities, types,
  relationships, custom fields, and the config file formats.
- [Query language](common/query-language.md) — the filter language behind
  queries and saved views.
- [Git-backed mode](common/git-sync.md) — sharing tasks across machines.

## Notes worth knowing

- **Attachments from an agent are confined to the tracker.** The
  `attach_file` MCP tool only accepts a path inside the tracker root, so an
  agent can't reach out to arbitrary files on the machine. See
  [Agent setup](mcp/agent-setup.md) for how to control an agent.
- **Global search is a query.** The web UI's header search is the query
  `text ~ "your terms"` — the same [query language](common/query-language.md)
  the filter bar and `loctt list --query` use.
- **A CSV or JSON export is a report, not a backup.** It is offered by
  `loctt export` and the `export_tasks` MCP tool — not by the web UI, where
  a filtered spreadsheet dump had no use case. Use the backup tools
  (`loctt backup` / the `backup` MCP tool / Settings → Backup & restore) to
  capture something you can restore from.

## Scale

LocTT holds every task as a file and reads them into memory to answer a
query, so it is built for the hundreds-to-low-thousands of tasks a personal
project or small team accumulates, not for a corpus of tens of thousands.
There's no artificial task limit; the practical ceiling is how fast your
disk reads the files. A few concrete caps: an attachment is up to 50 MB, and
a bulk change (from the CLI or an agent) touches up to 500 tasks per call.

