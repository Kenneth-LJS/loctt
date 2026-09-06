# Phase Z — Correctness review: `packages/core/src/query/` and `packages/core/src/rank/`

Read-only review. Two confirmed correctness bugs, both reproduced against the
built `dist/` and both uncovered by the existing test suite. `rank/` was
stress-probed (head/tail/narrowing inserts to depth 60, `evenlySpacedRanks`
for counts 1…5000) and found sound — no collisions, no trailing-zero ranks,
no out-of-bounds ranks, strictly increasing throughout. No rank finding.

---

## Finding 1 — Timestamped date fields compare wrong against a date-only value (incl. `today`)

**Severity: High**

**Where:** `packages/core/src/query/evaluator.ts:229-248` (`compareValues`, the
`<`/`<=`/`>`/`>=` branch — falls back to lexicographic string compare when a
side is non-numeric) combined with `resolvePrimitive` at `:117-120` (resolves
`today` to a bare `YYYY-MM-DD`).

**The contradiction that makes it reachable:** the query docs
(`docs/user/common/query-language.md:68-69`) assert *"Task dates are plain
calendar dates (`YYYY-MM-DD`), so `due_date < today` compares dates, not
instants."* But the contract schema does **not** enforce date-only:
`DateOrIsoString` in `packages/contracts/src/task.ts:10-15` accepts
`^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}...)?$` — a full ISO-8601 timestamp — for
`start_date`, `due_date`, and `completed_date` (task.ts:70-77). So a task may
legitimately store `due_date: 2024-06-01T09:00:00Z`, and the tokenizer even
accepts the timestamp form as a DATE literal (`tokenizer.test.ts:186`).

**Concrete failing scenario** (verbatim, test-writable against `evaluateQuery`):

```
fm  = { due_date: "2024-06-01T09:00:00Z" }        // due earlier TODAY
ctx = { today: "2024-06-01" }

evaluateQuery(parse("due_date <= today"), fm, ctx)  // ACTUAL false  — should be true (it is today)
evaluateQuery(parse("due_date = today"),  fm, ctx)  // ACTUAL false  — should be true-ish
evaluateQuery(parse("due_date > today"),  fm, ctx)  // ACTUAL true   — should be false (not in the future)
```

Same defect with a plain date literal, no `today` involved:

```
fm = { due_date: "2024-06-01T09:00:00Z" }
evaluateQuery(parse("due_date <= 2024-06-01"), fm)  // ACTUAL false — should be true
evaluateQuery(parse("due_date > 2024-06-01"),  fm)  // ACTUAL true  — should be false
```

**Why:** `Number("2024-06-01T09:00:00Z")` and `Number("2024-06-01")` are both
`NaN`, so the comparison falls to `leftStr < rightStr`. Lexicographically
`"2024-06-01T09:00:00Z"` sorts **after** `"2024-06-01"` (it is a longer string
sharing the prefix), so a task due earlier today is judged strictly greater
than today. An overdue-tasks view (`due_date < today`) or a due-today view
(`due_date <= today`) silently drops any task whose date field carries a time,
and a "due in the future" view wrongly includes it. Reads as a correct,
non-empty answer.

**Why existing tests miss it:** every date/`today` test stores a **date-only**
value — `list.test.ts:510-544` (`due_date: "2026-08-13"`), `parser.test.ts:40`,
`query.test.ts:116-131`, `validate.test.ts:125`. `tokenizer.test.ts:186`
confirms the *timestamp literal* tokenizes but never evaluates one against a
date-only side. No test in `evaluator.test.ts` or `list.test.ts` stores a
timestamped `due_date`/`start_date`/`completed_date` and compares it to `today`
or a date-only literal, so the string-prefix inversion is never exercised.

---

## Finding 2 — `text` alias with any operator other than `~` evaluates inverted / meaningless, yet passes validation

**Severity: Medium**

**Where:** `packages/core/src/query/evaluator.ts:262-320` (`evaluateTextAlias`)
and `:414-418` (the `text` dispatch). The function returns the literal
`op === "~"` as its match/no-match boolean at every decision site
(`:274`, `:309`, `:316`, `:319`). Validation
(`packages/core/src/query/validate.ts:337-347`, `validateEnumValue`) treats
`text` as an ordinary field — it is not an enum field — and never constrains
the operator, so `text = x`, `text != x`, `text < x`, etc. all parse, validate,
and run.

**Concrete failing scenario** (verbatim, test-writable against `evaluateQuery`):

```
match   = { title: "urgent fix", key: "T-1", id: "x" }
noMatch = { title: "calm",       key: "T-2", id: "y" }

evaluateQuery(parse("text = urgent"),  match)    // ACTUAL false — "urgent" IS in the title
evaluateQuery(parse("text = urgent"),  noMatch)  // ACTUAL true  — "urgent" is NOT present
evaluateQuery(parse("text != urgent"), match)    // ACTUAL false
evaluateQuery(parse("text < urgent"),  match)    // ACTUAL false (always false regardless of content)
evaluateQuery(parse("text > urgent"),  match)    // ACTUAL false (always false regardless of content)
```

`text = urgent` is fully backwards: it returns tasks that do **not** contain the
term and hides those that do. `validateQuery(parse("text = urgent"))` passes,
so nothing warns the user.

The docs describe `text` only as a substring search
(`docs/user/common/query-language.md:75`, `features.md:157`) and every example
uses `~` — the alias is meaningful with `~` alone. The correct behaviour is
either to reject a non-`~` operator on `text` in `validate.ts` (a
`QueryValidationError` the way an unknown field is rejected), or to make
`evaluateTextAlias` treat `=` as `~` and `!=` as its negation. Today it does
neither: it accepts the operator and returns the wrong rows.

**Why existing tests miss it:** every `text`-alias test uses `~` only —
`evaluator.test.ts:122-159` and `:437-478`, plus `docs-examples`/`list` uses.
No test asserts the result of `text = …`, `text != …`, or `text < …`, so the
inverted booleans are never observed. There is also no validator test asserting
that a non-`~` operator on `text` is rejected.

---

## Areas checked and found sound (no finding)

- **Saved-view error degradation.** A view whose query is *syntactically* broken
  never reaches `listTasks`: `config/queries.ts:63-80` splits it into a
  `BrokenSavedQuery` marker at load time (VUE-22), and `resolveView`
  (`list.ts:118-132`) only sees healthy entries. A view with a *semantic* error
  (since-deleted field) degrades via `onWarning` and runs
  (`list.ts:243-256`). The boundary holds; the raw-`throw` path in `listTasks`
  for a TokenizeError/ParseError is unreachable through a persisted view.
- **`lexorank.between` / `evenlySpacedRanks`.** Stress-probed: 40 head inserts
  (final len 9), 40 tail inserts (len 8), 60 always-insert-after-`a` narrowing
  (len 11), and `evenlySpacedRanks(1,2,5,33,34,100,648,649,650,1000,5000)`. In
  every case ranks were strictly increasing, unique (no collisions), never
  ended in `'0'`, and stayed strictly within (`MIN`, `MAX`). The
  final-digit-derivation fix for count > 648 holds.
- **`computeNewRank` duplicate-anchor handling** (`reorder.ts:379-425`) and
  `board-move.ts:interpolate` (`:240-248`): `indexOf` for *before* / `lastIndexOf`
  for *after*, plus `interpolate`'s widen-past-equal-bounds fallback, correctly
  avoid `between(x, x)` throws when per-column duplicate ranks (multiple
  `INITIAL` = `"u"`) occur under K8.
- **Enum-typo / unknown-field validation** (`validate.ts`): `stat = done` →
  unknown field with suggestions; `status = frobnik` → unknown value; NaN
  literals (`3-4`, `1.2.3`) caught by `assertSatisfiable`; empty list rejected;
  `2024-13-45` rejected at the tokenizer.
- **`in`/`not in` on missing and array fields**, negation precedence
  (`not a and b` → `(not a) and b`), and `has_link`/`link_count` arity all
  behaved as documented.

### Noted but not raised as findings (lower confidence / by-design)

- Numeric coercion of empty/whitespace string field values: `estimate > -1`
  is `true` when `estimate: ""` because `Number("") === 0`
  (`compareValues:231`). Requires an empty-string numeric field, which the
  schema does not normally produce; the numeric-when-both-parse rule is
  explicitly intended.
- A ULID value starting with digits (`id = 01M0TC…`) tokenizes as NUMBER +
  FIELD and fails to parse; already understood and worked around at the server
  layer (see `apps/web/src/server/server.ts:836`), out of scope here.
