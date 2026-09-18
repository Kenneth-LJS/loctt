# Query, list, and saved views

The DSL, list execution, sorting, pagination, and saved views — across the
CLI and MCP, with the web API as the third party most of these compare
against.

Gaps only. See [README.md](README.md) for conventions.

---

## A. One language, three surfaces

### QRY-C1 · blocker · P10 P1 · CLI MCP
**A view saved from the UI runs unchanged everywhere.** Three sites emit
`field in [a, b]` with square brackets (`apps/web/src/server/server.ts:449`,
`apps/web/src/client/list/buildDsl.ts:39`,
`apps/web/src/client/sidebar/builtinFilters.ts:54,112`); the tokenizer has
no `[` token at all, so the web writes DSL the parser rejects.

- `POST /api/views` with a multi-value facet writes an entry that
  `parseQueriesConfig` re-reads successfully — one bad query rejects the
  whole file (`packages/core/src/config/queries.ts:42`), so this is not
  only that view's problem.
- `loctt list --view <name>` exits 0 and returns the keys the API returned
  for the equivalent filters.
- MCP `list_tasks` with that view returns the same set.
- The three sets are equal, not merely non-empty.

**Given** the UI saves a view built from two selected statuses, **when** the
view is run through the CLI and MCP, **then** both exit successfully and
return exactly the keys the API returned.

### QRY-C2 · major · P4 P10 · CLI MCP
**The same bad query produces the same error on every surface.**
`handleListTasks` has no try/catch (`apps/web/src/server/server.ts:1554-1617`),
so tokenize/parse/validation errors become
`500 {"error":"Internal server error"}` — discarding the message, position,
and suggestions `validate.ts` carries deliberately.

- An unknown field, a syntax error, an unknown enum value, and an
  undeclared custom field each name the same field, position, and
  suggestions on CLI, MCP, and HTTP.
- No surface returns a zero-row success for any of the four.
- The HTTP responses are 4xx, not 500.

**Given** the same tracker reachable three ways, **when** each malformed
query runs on each surface, **then** field name, position, and suggestion
list agree.

### QRY-C3 · minor · P10 · CLI
**Every documented DSL construct runs end to end.**

- `status in (a, b)`, `status not in (a, b)`, `text ~ "x"`,
  `due_date < today`, `parent = <key>`, `fields.<k> > 3`,
  `not (status = done)`, and a parenthesised `or` inside an `and` each
  exit 0.
- `priority in [high, critical]` — the bracket form the web generates —
  fails naming the unexpected `[`, proving brackets are not accepted on
  one surface and rejected on another.
- `status.category not in (completed, discarded)` runs, since every
  built-in sidebar filter depends on it.
- Single- and double-quoted strings behave identically.

**Given** a seeded tracker, **when** each construct runs via
`loctt list --query`, **then** parenthesised forms exit 0 and the bracket
form exits non-zero naming `[`.

---

## B. Sorting and paging

### QRY-C4 · major · P10 · CLI MCP
**Sort and offset exist wherever the core supports them.** Core has both;
the CLI has no `--sort` (`docs/user/cli/reference.md:336` documents none)
and MCP has neither `sort` nor `offset`
(`apps/mcp/src/tools/task-crud.ts:82-86`), so the web is the only surface
that can order or page a list.

- A sort flag/parameter orders results by the named field on both surfaces.
- Sorting by `priority` uses the workflow `value` ordering, not
  lexicographic.
- Multiple sort keys apply in order.
- The same field and direction through `GET /api/tasks?sort=&dir=`
  produces an identical sequence.

**Given** tasks with distinct priorities, **when** each surface sorts by
priority descending, **then** all three produce the same order.

### QRY-C5 · major · P9 · MCP
**`list_tasks` reports truncation honestly.**

- With more matches than `limit`, the response states the total matched,
  not just the returned slice.
- An offset retrieves subsequent pages with no overlap and no omission.
- The union of all pages equals the unpaginated result, each row once.

**Given** 100 matching tasks and `limit: 30`, **when** `list_tasks` is
called, **then** the response states 100 matched and paging retrieves all
100 without duplicates.

### QRY-C6 · minor · P10 · MCP
**`list_views` exposes enough to address a view unambiguously.**

- Each entry includes `id`, `name`, `query`, and `sort` when present.
- Archived views are distinguishable from live ones.
- Two views sharing a name are selectable by `id` — `findView`
  (`packages/core/src/views/manage.ts:27`) throws on an ambiguous name, so
  the id must be reachable.
- A missing `queries.yaml` yields a stated "no views" result, not an error
  (current behaviour, `apps/mcp/src/tools/views.ts:29-31`).

**Given** `queries.yaml` with two views named `overdue`, **when**
`list_views` is called, **then** both appear with distinct `id`s.
