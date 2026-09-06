# Phase Z — Adversarial verification of `phase-z-findings-correctness-query-rank.md`

Independent re-check of the two query-evaluator findings. Every claim below
was re-derived from source and re-run through the real query pipeline
(`tokenize → parseQuery → validateQuery → evaluateQuery`, plus the public
`listTasks` entry point and, for reachability, a real `setField` → `readTask`
round-trip on a temp tracker). The temporary test file was deleted after the
run; no edit is left in the repo.

| # | Finding | Verdict |
|---|---|---|
| 1 | Timestamped date field compares wrong vs date-only literal / `today` | **CONFIRMED — RECLASSIFIED High → Medium.** Mechanism real and reachable; but the "overdue view" claim is wrong (that view is correct), and no first-party UI ever writes a timestamp. |
| 2 | `text` with non-`~` operator evaluates inverted, passes validation | **CONFIRMED for `=` (Medium stands).** The report's `!=` claim is refuted — `text != x` gives the correct answer. Ordering ops behave as "does not contain", not "always false". |

---

## Finding 1 — timestamped `due_date` vs `today` / date literal

### Mechanism (read, not trusted)

- `packages/core/src/query/evaluator.ts:226-247` (`compareValues`): for
  `< <= > >=`, tries `Number()` on both sides; both `NaN` for date strings, so
  it falls to `leftStr <op> rightStr`. `=` at `:220` is plain string equality;
  `in` at `:467-470` is `rhs.includes(fieldStr)`.
- `resolvePrimitive` `:117-120` resolves `today` to a bare `YYYY-MM-DD`.
- `packages/contracts/src/task.ts:10-15` `DateOrIsoString` accepts
  `^\d{4}-\d{2}-\d{2}(T…)?$`, used for `start_date` / `due_date` /
  `completed_date` (`:70-77`, and `:207-210` in the public projection).
- `"2026-06-01T09:00:00Z" > "2026-06-01"` lexicographically (longer string
  with equal prefix sorts after). So on the **same calendar day** a timestamped
  value is judged strictly greater than the date, and never equal.

### My test (through the real API, run against current source)

```
fixture: due_date "2026-06-01T09:00:00Z";  ctx.today = "2026-06-01"

due_date <= today        expected true   ACTUAL false   RED
due_date >  today        expected false  ACTUAL true    RED
due_date =  today        expected true   ACTUAL false   RED
due_date in (today)      expected true   ACTUAL false   RED
due_date <= 2026-06-01   expected true   ACTUAL false   RED   (plain literal, no `today`)

-- adversarial: which real views break? --
due_date <  today   on 2026-05-31T23:00Z → true   CORRECT
due_date <  today   on 2026-06-01T09:00Z → false  CORRECT (due today is not overdue)
due_date <  today   on 2026-06-02T01:00Z → false  CORRECT
due_date >= today   on 2026-06-01T09:00Z → true   CORRECT
due_date >= today   on 2026-05-31T23:00Z → false  CORRECT

listTasks "due_date >= 2026-06-01 and due_date <= 2026-06-08"
  (the web builtin "due this week" shape, builtinFilters.ts:130)
  over {today+time, tomorrow+time, day7+time, yesterday+time}
  expected [D-in7, D-tmrw, D-today]   ACTUAL [D-tmrw, D-today]   RED — day-7 dropped

control: due_date "2026-06-01" (date-only) — every operator correct  GREEN
```

Mechanism confirmed. Failures are confined to the **equal-day boundary**:
`<=`, `>`, `=`, `in` are wrong when the stored day equals the compared day.
`<` and `>=` are correct for every timestamped value because a differing day
prefix decides before the `T` is reached, and on the equal day the "longer
string sorts after" rule happens to give the right answer for those two.

**Consequence for the report's impact statement.** It says the bug is
"silently breaking overdue/due-today/future views". Overdue (`< today`) is
**not** broken — I tested it three ways. Due-today (`= today` / `in (today)` /
`<= today`) and future (`> today`, which wrongly includes today's tasks) are.
The web sidebar's built-in "Overdue" (`due_date < today and …`,
`builtinFilters.ts:138`) is therefore unaffected; its "Due this week"
(`>= today and <= today+7d`, `:130`) drops a timestamped task due on the
seventh day and nothing else.

### Reachability — can a date field actually hold a timestamp?

Traced every write path. **Nothing normalises to date-only; the only
write-side shape check is the contract regex, which explicitly permits the
timestamp.**

| Path | What reaches disk | Evidence |
|---|---|---|
| core `setField(due_date, "2026-06-01T09:00:00Z")` | stored **verbatim**, `health` undefined, then `listTasks "due_date <= today"` returns `[]` | my test: `setField` → `readTask` → `listTasks`, RED on the last assertion only |
| core `setField(due_date, "not-a-date")` | **refused**: `CorruptWriteError — refusing to write abc: this write would introduce corruption in "due_date" (wrong_type: must be YYYY-MM-DD or full ISO-8601 timestamp)` | my test; the guard is `io.ts:52-70`'s serialise-and-reparse, i.e. `DateOrIsoString` itself |
| `validateTaskAgainstWorkflow` (`config/validation.ts`) | checks `YYYY-MM-DD` only for **custom** `date`-typed fields (`:189-192`, `:227`); never inspects built-in `due_date`/`start_date` | read |
| `createTask` (`task/create.ts:134-135`) | copies `options.due_date` / `start_date` raw | read |
| MCP `update_task` (`apps/mcp/src/runtime/fields.ts:28-36, 46-47`) | `DateLikeString` regex **deliberately** accepts a full ISO timestamp ("must be YYYY-MM-DD or full ISO-8601 timestamp"); verified `r.test("2026-06-01T09:00:00Z") === true` | read + node one-liner |
| MCP `create_task` (`apps/mcp/src/tools/task-crud.ts:230-231`) | `z.string().optional()` described as "YYYY-MM-DD" but **not enforced** | read |
| CLI `loctt create --due X` / `loctt set T-1 due_date X` (`apps/cli/src/commands/task-crud.ts:106-107,128-129,532`) | raw string straight to core | read |
| Web `POST /api/tasks` and the generic set-field route (`server.ts:3547`, `:4010-4030`) | `request.value` passed raw to `setField`; no date-shape check in either handler | read (grep for `due_date`/regex inside both handlers: none) |
| Web timeline drag route (`server.ts:3095-3101`) | **the one place** that enforces `YYYY-MM-DD` | read |
| Web `MetaPanel` / `CreateTaskModal` date pickers | `<input type=date>` → `YYYY-MM-DD`; never emit a timestamp | read |
| Hand-edited `task.md` with `due_date: 2026-06-01T09:00:00Z` | `yaml` v2 core schema parses it as a **string** (verified: `parse("due_date: 2026-06-01").due_date instanceof Date === false`); `coerceFrontmatter`'s Date branch (`frontmatter.ts:103-108`) is not reached; schema accepts; `health` clean | read + node one-liner |
| `completed_date` (auto-managed) | always `todayDateString()` → `YYYY-MM-DD` (`update.ts:203-209, 467`; `create.ts:155`; `bulk.ts:60`) | read — this field is **safe** |

So the report's central premise holds: a timestamp is storable and is not
merely "permitted by the read schema". Three of four surfaces (MCP, CLI, web
HTTP API) accept it; the MCP `update_task` schema advertises it as valid in
its own error text. Only the web's own widgets are incapable of producing one.

### Why I reclassify High → Medium rather than leave High

1. **No first-party UI writes a timestamp.** The web date pickers,
   `completed_date` auto-management, and every documented example write
   `YYYY-MM-DD`. The docs (`docs/user/common/query-language.md:68-69`) say
   dates are plain calendar dates. A timestamp reaches disk only via an
   agent/CLI/API caller choosing to send one — a real path, and one the MCP
   schema invites, but not the default path.
2. **The failure is a one-day boundary, not wholesale.** Overdue is right;
   `>=` is right. What breaks is "due today" and the top edge of a range.
   The report's "silently drops any task whose date field carries a time"
   for the overdue view is false.
3. It remains a genuine correctness bug — not theoretical — because the
   contract and the MCP boundary both *declare* the timestamp form valid,
   and the evaluator then gives the wrong answer for it with no warning.

**The two places that disagree** are `DateOrIsoString` (accepts timestamps)
and `evaluator.ts` + `utils/today.ts:4-5` + the docs (assume date-only). Fix
belongs in one of them: either compare on `slice(0, 10)` for date fields (or
normalise on write), or tighten the contract/MCP regex to `YYYY-MM-DD` and
have the write guard reject the timestamp. Not fixed here.

---

## Finding 2 — `text` alias with a non-`~` operator

### Mechanism (read, not trusted)

- `evaluator.ts:262-320` `evaluateTextAlias`: every "found it" exit returns
  `op === "~"` (`:274`, `:309`, `:316`); the fall-through "not found" exit
  returns `op === "~" ? false : true` (`:319`). So for **any** non-`~`
  operator the function returns *false when the term is present, true when
  absent* — i.e. it behaves as "does not contain", regardless of which
  operator was written.
- Dispatch `:414-418` passes `node.op` through unchanged.
- `validate.ts`: `text` is in `QUERYABLE_FIELDS` (`:58`); `validateComparison`
  (`:231-276`) checks satisfiability, field name and enum values only;
  `validateEnumValue` (`:337-347`) returns immediately because `text` is not
  an enum field. No operator constraint exists for `text`.
- Parser: `=` `!=` `<` `<=` `>` `>=` are all ordinary `ComparisonOp`s
  (`parser.ts:4`, `:67-74`); nothing special-cases the `text` field.

### My test

```
match   = { title: "urgent fix" }     noMatch = { title: "calm" }

validateQuery(parse("text = urgent"))                 no throw   (no workflow)
validateQuery(parse("text = urgent"), { workflow })   no throw
validateQuery(parse("text != urgent"), { workflow })  no throw
validateQuery(parse("text < urgent"), { workflow })   no throw      → passes upstream: CONFIRMED

text = urgent   on match     expected true   ACTUAL false   RED   (inverted)
text = urgent   on noMatch   expected false  ACTUAL true    RED   (inverted)
text != urgent  on match     expected false  ACTUAL false   GREEN (correct)
text != urgent  on noMatch   expected true   ACTUAL true    GREEN (correct)

listTasks "text = urgent"  over [match, noMatch]
  expected [T-1]   ACTUAL [T-2]                             RED — returns the wrong task

listTasks "text = urgent" with buildListContext (body search wired)
  over [T-3 body contains "urgent", T-2 "calm"]
  expected [T-3]   ACTUAL [T-2]                             RED — body path inverted too
control listTasks "text ~ urgent" same context → [T-3]     GREEN

control listTasks "text ~ urgent" over [match, noMatch] → [T-1]   GREEN
```

`text = x` is fully inverted through the public entry point, and passes
validation. **CONFIRMED.**

### Corrections to the report's characterisation

- **`text != urgent` on match → false is the *correct* answer**, not a
  failure. The report lists it as a failing scenario; my test shows `!=`
  gives the right result on both fixtures. It is right by accident — the
  inverted `op === "~"` boolean coincides with negation — but it is right.
- **Ordering operators are not "always false regardless of content".** They
  return false on a match and true on a non-match, i.e. they act as `!=`.
  Still meaningless for a substring alias, but a different wrong than stated.

Net: of the six non-`~` operators, one (`=`) is inverted, one (`!=`) is
correct, four (`< <= > >=`) silently behave as `!=`. The severity-bearing
case — `=` returns the complement of what the user asked — stands.

### Reachability — does any surface emit `text` with a non-`~` operator?

Searched every generator of query text in `apps/web`, `apps/cli`, `apps/mcp`:

- The only programmatic emitter is the web search endpoint,
  `server.ts:3418-3447`, which builds `` `text ~ ${JSON.stringify(q)}` `` —
  `~` only.
- The client's query help (`querySyntaxHelp.ts:59`) shows only `text ~`.
- `dslToSearch.ts`, `builtinFilters.ts`, `listSearch.ts` emit no `text`
  clause at all; `listSearch.q` is a free-text DSL string typed by the user.

So no first-party code ever produces `text = …`. The bug is reachable only
through **hand-written queries**: `loctt list "text = x"`, MCP `list_tasks`
with `query: "text = x"` (`task-crud.ts:141`, raw string), the web list's `q`
URL/search-box parameter, and a saved view in `queries.yaml`. That is the
report's own qualification and it is accurate; Medium is the right tier —
the answer is confidently wrong and nothing warns, but you have to write the
query yourself to hit it.

Fix (not applied): either reject non-`~` operators on `text` in
`validateComparison` — a `QueryValidationError` like the unknown-field one —
or map `=` → `~` and `!=` → `not ~` in `evaluateTextAlias`. The first is the
smaller change and matches the docs, which describe `text` only as a
substring search.

---

## Method notes

- Temp test: `packages/core/src/query/zz-phase-z-verify.test.ts`, 20 cases,
  run with `npx vitest run` in `packages/core`; 11 red / 9 green as tabulated
  above. Deleted after the run. `git status` shows only the pre-existing
  Phase-Z docs and `TEMP-BUILD-PLAN.md`.
- One fixture mistake caught and corrected mid-run: my first body-search case
  called `listTasks` without `ctx`, so `getBody` was never supplied and the
  body was not searched (`list.ts:274-276`). Re-run with
  `buildListContext(tasks)`; the inverted result then reproduced through the
  real body path and the `~` control passed. Recorded so nobody re-derives
  the wrong lesson from the first run.
- `rank/` was not re-verified: the report raised no finding there and the
  task scoped verification to the two findings.
