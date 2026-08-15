# Phase 4 structural audit — Slice 4: `packages/core/src/query/` + `packages/core/src/rank/`

Read in full (non-test): `query/tokenizer.ts`, `query/parser.ts`, `query/evaluator.ts`,
`query/validate.ts`, `query/list.ts`, `query/index.ts`, `rank/lexorank.ts`,
`rank/reorder.ts`, `rank/index.ts`.
Read in full (test, for coverage judgement only): `query/tokenizer.test.ts`,
`query/parser.test.ts`, `query/query.test.ts`, `query/evaluator.test.ts`,
`query/validate.test.ts`, `query/list.test.ts`, `query/docs-examples.test.ts`,
`rank/lexorank.test.ts`, `rank/reorder.test.ts`.

Every finding below was reproduced by executing the actual code via `tsx`, not
inferred from reading. Reproductions are quoted inline.

---

### `evenlySpacedRanks` emits duplicate ranks for count ≥ 649 — rebalance can collapse an ordering

- **File**: `packages/core/src/rank/lexorank.ts:209-221`
- **Category**: bug
- **What is wrong**: In the two-digit branch, `stride = Math.floor(totalSlots / count)`.
  For `count ≥ 649`, `totalSlots (1296) / count` floors to `1`, so
  `Math.floor(stride / 2) === 0` and `slot === i`. Consecutive slots `0` and `1`
  then both produce `lo = 1` because of the `if (lo === 0) lo = 1;` clamp on
  line 219, yielding `"01"` twice. Verified:
  ```
  evenlySpacedRanks(649) → 01,01,02,03,04,05,06,07…   (first duplicating count)
  evenlySpacedRanks(700) → 700 items, 680 unique, 20 duplicate pairs
  evenlySpacedRanks(1296) → 1296 items, 1260 unique, 36 duplicate pairs
  ```
  The function's own contract (`Spreads count items evenly`) and the
  `strictly increasing` property asserted in its tests are both violated. The
  test only checks counts 2, 5, 10, 34, 100, 500 — all below the 649 threshold,
  so it is green and asserts nothing about the failing region.
- **Why it matters**: `reorderBoardRank` (reorder.ts:229) calls
  `evenlySpacedRanks(ranked.length)` where `ranked.length` is *every ranked task
  in the tracker*. A tracker with ≥649 board-ranked tasks that trips a rebalance
  writes duplicate `board_rank` values to disk. Two tasks with an identical rank
  have no defined order, and the next `computeNewRank` before/after either of
  them calls `ranked.indexOf(anchor)`, which returns the *first* match — so a
  subsequent drag silently positions relative to the wrong task. This corrupts
  persisted on-disk ordering, not just a render.
- **Blast radius**: `rank/reorder.ts` both rebalance paths; `board_rank` on
  every task file; `apps/web/src/server/server.ts:2046`,
  `apps/mcp/src/tools/task-rank.ts:61`, `apps/cli/src/commands/task-rank.ts:57`.
  Relationship rebalance (reorder.ts:136) is bounded by links-per-task so it is
  unlikely to reach 649, but shares the function.
- **Size**: S (the fix is in one branch) — but see risk note: it changes rank
  strings written to disk.
- **Auto-fixable**: no
- **Confidence**: high

---

### Rebalance in `reorderBoardRank` writes `updated_at` on every ranked task in the tracker

- **File**: `packages/core/src/rank/reorder.ts:224-250`
- **Category**: bug
- **What is wrong**: When a rebalance fires, `updates` is replaced with an entry
  for *every* ranked task, and the persist loop at 238-250 stamps
  `updated_at: new Date().toISOString()` on each one before `writeTask`.
- **Why it matters**: `updated_at` is the default list sort key
  (`list.ts:280`). A rebalance triggered by one user dragging one card rewrites
  the `updated_at` of every ranked task to the same instant, destroying the
  "most recently updated first" ordering across the whole tracker and producing
  a git diff touching every task file. The rebalance is documented as hidden
  from callers (`reorder.ts:52-53` — "the only observable difference is that a
  previously-long rank shrinks"); that comment is false. A rank change is not a
  content edit and arguably should not touch `updated_at` at all for the
  untouched peers.
- **Blast radius**: every task file's `updated_at`; default list ordering on all
  three surfaces; git-sync diff size and merge surface (slice 2's territory).
- **Size**: S
- **Auto-fixable**: no (on-disk shape / observable ordering)
- **Confidence**: high

---

### `link_count(...) in (…)` parses and validates, then always evaluates false

- **File**: `packages/core/src/query/evaluator.ts:437-445`
- **Category**: bug
- **What is wrong**: `parseCall` accepts any operator in `OP_TOKEN_MAP` after a
  `link_count(...)`, including `in` / `not in`, and `parseValue` duly builds a
  list. `validateQuery` (validate.ts:176-179) returns early after checking the
  kind and never looks at the operator or value. But the evaluator's
  `link_count` branch calls `resolvePrimitive(node.value)`, which returns
  `undefined` for `{type:"list"}` (evaluator.ts:121-122), so it `return false`.
  Verified:
  ```
  parse  'link_count("child") in (1,2)' → OK  (comparison, op "in", call link_count)
  eval   against a task with one "child" link → false
  eval   'link_count("child") = 1' on same task → true
  ```
  `not in` is worse: it also returns `false`, so the negated form is false for
  every task rather than true.
- **Why it matters**: This is the same failure class the whole
  tokenizer/parser/validator stack was built to eliminate — a query that is
  accepted end-to-end and silently matches nothing, indistinguishable from
  "no tasks match". `validate.ts:11-15` names that exact bug as its reason to
  exist, and this path routes around it.
- **Blast radius**: any surface accepting a DSL string — CLI `--query`, MCP
  list tools, `GET /api/search`, saved views in `queries.yaml`.
- **Size**: S
- **Auto-fixable**: no (adds an error message / changes accepted grammar)
- **Confidence**: high

---

### Numeric literals that fail to parse become `NaN` and silently match nothing

- **File**: `packages/core/src/query/parser.ts:286`; tokenizer at `tokenizer.ts:123-136`
- **Category**: bug
- **What is wrong**: The tokenizer's number scanner consumes any run of
  `[0-9.\-T:Z]`, so `1.2.3` and `3-4` are emitted as `NUMBER` tokens. The
  parser then does `Number(tok.value)` with no check, producing `NaN`.
  Verified:
  ```
  'x = 1.2.3'     → value {"type":"number","value":null}   (NaN, JSON-serialised as null)
  'estimate > 3-4' → value {"type":"number","value":null}
  ```
  A `NaN` right-hand side flows into `compareValues`, where `Number.isNaN(rightNum)`
  is true so it falls through to string comparison against `"NaN"` — matching
  nothing, with no error anywhere.
- **Why it matters**: Same silent-zero-results class as above. A user typo in a
  numeric literal is reported as "no tasks match". The date branch has the mirror
  problem: `due_date < 2024-13-45` is accepted as a `DATE` because the regex only
  checks `\d{4}-\d{2}-\d{2}` shape, never validity.
- **Blast radius**: all query surfaces.
- **Size**: S
- **Auto-fixable**: no (new error message / new rejection)
- **Confidence**: high

---

### `between()` grows ranks without bound on repeated head-inserts, well past the rebalance threshold

- **File**: `packages/core/src/rank/lexorank.ts:96-132`, threshold at `:167`,
  trigger at `reorder.ts:131` and `:224`
- **Category**: bug
- **What is wrong**: `betweenInner(MIN, x)` where `x` starts with `"0"` copies
  the shared `'0'` digit and descends, so each head-insert appends exactly one
  character. Verified:
  ```
  200 iterations of `cur = between(MIN, cur)` starting from INITIAL
    → length 31: "000000000000000000000000000000i"
  ```
  The rebalance guard is `newRank.length > REBALANCE_LENGTH_THRESHOLD (24)`,
  which is checked *only after* the rank is computed, and only on the reorder
  path. It fires eventually, so this is bounded in the reorder API — but the
  window between insert 1 and insert 25 all writes progressively longer
  `board_rank` strings to disk, and `evenlySpacedRanks` is what resets them,
  which is the function with the duplicate defect above. The `lexorank.test.ts`
  "repeated inserts at the same end" test asserts only
  `expect(lowest.length).toBeLessThan(120)` after 100 inserts — with growth of
  exactly one char per insert the true value is ~101, so that bound is 19 away
  from failing and is not a meaningful assertion of "stays bounded".
- **Why it matters**: The module docstring claims `MIN`/`MAX` "bound the value
  space so inserts at the start or end always have room". Head-inserts have room
  only by lengthening; end-inserts behave better (`yzzzzzzzy` after 50, length 9).
  The asymmetry is undocumented and the test that should catch it is slack.
- **Blast radius**: `board_rank` string length in every task file; rebalance
  frequency; the duplicate-rank defect above becomes reachable sooner.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### The tokenizer has no `[` token, and its catch-all error names only the character

- **File**: `packages/core/src/query/tokenizer.ts:178`
- **Category**: bug
- **What is wrong**: `[`, `]`, `&`, `|`, `@`, `{`, `}`, `+`, `*`, `/`, `%`, `!`
  (unpaired), `;`, `:` (outside a date) and every non-ASCII character all fall
  to the same terminal `throw new TokenizeError(\`unexpected character "${ch}"\`, i)`.
  Verified — this is the shipped defect the brief names, still live:
  ```
  'status in [a, b]'  → TokenizeError: unexpected character "[" at position 10
  'a = 1 && b = 2'    → TokenizeError: unexpected character "&" at position 6
  'status = "a" | b'  → TokenizeError: unexpected character "|" at position 13
  ```
  The message is *positionally* correct but semantically blind: it never says
  "lists use parentheses: `in (a, b)`", never says "use `and` / `or`", and never
  shows the input with a caret. For the characters that have an obvious intended
  meaning in a query DSL — `[`/`]` for a list, `&&`/`||` for boolean, `!` alone
  for negation — a bare "unexpected character" is the least useful thing the
  tokenizer knows how to say. There is no test covering any character class
  other than `@`.
- **Why it matters**: The brief records that the bracket-list form reached
  production on three code paths. Nothing in the tokenizer has changed to make
  the next such form easier to diagnose; the failure mode is identical.
  Adding recognised-but-rejected tokens with targeted messages is the
  structural fix (it also makes `queryMentionsArchived`'s silent
  `catch { return false }` at `list.ts:298-301` less likely to mask a real
  parse problem).
- **Blast radius**: every DSL entry point; the error text is user-facing on CLI
  stderr, MCP tool errors, and the web search box.
- **Size**: M
- **Auto-fixable**: no (error messages are explicitly high-risk per the brief)
- **Confidence**: high

---

### A `FIELD` followed by `(` is treated as a call across whitespace, so a stray space changes the error

- **File**: `packages/core/src/query/parser.ts:158`
- **Category**: bug
- **What is wrong**: The call check is `this.tokens[this.pos + 1]?.type === "LPAREN"`.
  Tokens carry `position` but the check is index-adjacency, not source-adjacency,
  so intervening whitespace is invisible. Verified:
  ```
  'has_link ("a")'  → OK, parses as has_link(kind:"a")
  'status (a = 1)'  → ParseError: unknown function "status".
                        Available: has_link(kind?, target?), link_count(kind?)
  ```
  The second is a user who typed a stray space between a field and a
  parenthesised group. The reported error blames an entirely different feature.
  The parser has `position` on both tokens and could compare
  `nameTok.position + nameTok.value.length === lparen.position` to distinguish.
- **Why it matters**: Misleading errors on the most common DSL typo class. The
  parser test at `parser.test.ts:189-194` explicitly claims to cover "does not
  mistake a parenthesised group for a call" but only tests `(status = done)`
  (LPAREN-first) and `status = done` — neither exercises `FIELD` `LPAREN`.
- **Blast radius**: parse error text on all surfaces.
- **Size**: S
- **Auto-fixable**: no (error message)
- **Confidence**: high

---

### `a in ()` — an empty list — parses, validates and matches nothing

- **File**: `packages/core/src/query/parser.ts:301-313`
- **Category**: bug
- **What is wrong**: `parseList` explicitly permits an empty list
  (`if (this.peek()?.type !== "RPAREN")` guard). Verified:
  ```
  'a in ()' → OK  value {"type":"list","values":[]}
  ```
  The evaluator then computes `rhs = []` and `rhs.includes(fieldStr)` is always
  false, so `in ()` is universally false and `not in ()` universally true —
  with no error. Compare `'a in (1,)'`, a trailing comma, which *does* error.
  An empty list is never something a user means.
- **Why it matters**: Third instance of the accepted-but-silently-empty class.
- **Blast radius**: all query surfaces.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: high

---

### `evenlySpacedRanks` can emit a rank beginning with `"0"`, which the module's own comment forbids

- **File**: `packages/core/src/rank/lexorank.ts:210-221` vs the guard at `:195`
- **Category**: bug
- **What is wrong**: The single-digit branch has an explicit assertion that
  `start ≥ 1` "so we never produce a rank of '0', which is a phantom prefix of
  any longer rank starting with the same first digit". The two-digit branch has
  no such guard on `hi`. Verified:
  ```
  evenlySpacedRanks(35)[0] === "0i"
  evenlySpacedRanks(40)[0] === "0g"
  ```
  Both begin with `'0'`. `between(MIN /* "0" */, "0i")` then descends into the
  matching zero — the exact scenario the single-digit assertion was written to
  prevent — and this is precisely the range (`count > BASE - 2 === 34`) the
  assertion does not cover.
- **Why it matters**: The invariant is stated, enforced on one branch, and
  violated on the other. The `never produces a rank ending in '0'` test
  (`lexorank.test.ts:95-102`) checks the wrong end of the string.
- **Blast radius**: rebalanced `board_rank` values ≥ 35 items; subsequent
  head-inserts against those ranks.
- **Size**: S
- **Auto-fixable**: no (changes rank strings written to disk)
- **Confidence**: high

---

### `reorderBoardRank` reads all peers but `computeNewRank` ignores them when an anchor is unranked

- **File**: `packages/core/src/rank/reorder.ts:198-217` with `:284-312`
- **Category**: bug
- **What is wrong**: `beforeRank` / `afterRank` are read from the anchor task's
  `board_rank`, which is `string | undefined`. When the anchor exists but has
  no rank yet (very common — `board_rank` is optional and only written by this
  API), `mode.rank` is `null` and `computeNewRank` falls back to
  "insert at the start" (before) or "insert at the end" (after), silently
  ignoring where the anchor actually sits in the list. The user asked "put X
  before Y" and got "put X first". No error, no signal in `ReorderResult`.
  The relationship path (`:84-107`) at least *errors* when the anchor is not
  linked, but it has the same silent behaviour when the link exists with no
  `rank` — `beforeRank = link.rank` is `undefined` there too.
- **Why it matters**: A drag-to-position that lands somewhere else is a
  data-ordering bug the user must undo manually. The `reorder.test.ts` suite
  establishes ranks by calling reorder on each task first (lines 100-102,
  153-155), so it never exercises the unranked-anchor case at all.
- **Blast radius**: web board drag-drop (`server.ts:2046`), MCP `task-rank`,
  CLI `task-rank`.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### `reorderBoardRank` is O(all tasks) on every call and rewrites files inside the state lock

- **File**: `packages/core/src/rank/reorder.ts:190`, `:238-250`
- **Category**: layering
- **What is wrong**: Every single board reorder calls `loadAllTasks(locttDir)`
  — reading and parsing every task file in the tracker — to build the peer rank
  list, then in the rebalance case issues one sequential `await writeTask` per
  task, all inside `withStateLock`. The relationship path by contrast reads one
  task. There is no batched write and no early exit for the common case where
  only one task changes (the non-rebalance path still walks `allTasks` at 238 to
  find the single match).
- **Why it matters**: A board drag is an interactive, latency-sensitive
  operation. Holding the global state lock across N file reads plus, on
  rebalance, N sequential file writes makes every other command block behind a
  drag. This is a shared-core cost paid by all three surfaces.
- **Blast radius**: `withStateLock` contention across CLI/MCP/web; board UX.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: high

---

### `evaluateQuery` throws a bare `Error` for `relationship.*` — an unhandleable error type from a pure function

- **File**: `packages/core/src/query/evaluator.ts:429-434`
- **Category**: layering
- **What is wrong**: The evaluator throws a plain `Error` (not `ParseError`,
  not `QueryValidationError`) from inside `tasks.filter(...)`, once per task
  until the first throw. `validate.ts:166-173` already raises a proper
  `QueryValidationError` for the same input, with a position, before any task is
  read — so on the `listTasks` path this evaluator branch is unreachable. On
  any path that evaluates without validating, callers get an untyped `Error`
  they cannot distinguish from an internal failure, from a function documented
  as pure.
- **Why it matters**: Two implementations of one rule in two layers, with
  different error types and different positional information. The evaluator is
  the wrong layer to reject grammar — validation is explicitly the layer built
  for it (`validate.ts:130-136`). Note this is *not* dead code: `evaluateQuery`
  is a public export (`core/src/index.ts:207`) callable without validation.
- **Blast radius**: `evaluateQuery` public export; any direct caller.
- **Size**: S
- **Auto-fixable**: no (error type is public behaviour)
- **Confidence**: high

---

### Triplicated comment block in `buildListContext`

- **File**: `packages/core/src/query/list.ts:96-113`
- **Category**: comment
- **What is wrong**: The same six-line comment ("`text ~ q` searches the body,
  but no caller ever supplied getBody…") appears three times: once correctly
  attached to `getBody` at 96-100, then twice more as orphaned blocks at
  103-106 and 108-112 inside the object literal after the last property, with
  blank lines between. Almost certainly a bad merge or a triple-paste.
- **Why it matters**: Cosmetic, but it is in the middle of a public factory and
  reads as though two more properties were intended and dropped.
- **Blast radius**: none.
- **Size**: S
- **Auto-fixable**: **yes** — comment correction, zero behaviour change.
- **Confidence**: high

---

### `query.test.ts` duplicates `tokenizer.test.ts` and `parser.test.ts` almost entirely

- **File**: `packages/core/src/query/query.test.ts:7-215`
- **Category**: duplication
- **What is wrong**: Its `describe("tokenizer")` block re-asserts simple
  comparison, quoted strings, numbers, booleans, `today`, and/or/not, `not in`,
  `in`, `!=`/`~`, unterminated string and unexpected character — all present in
  `tokenizer.test.ts`. Its `describe("parser")` block similarly re-asserts
  comparison, string/number/date/today values, and/or/not, `in`/`not in`,
  parens, precedence, empty and unexpected-token — all present in
  `parser.test.ts`. The only content not duplicated is two date cases
  (`2026-04-16`, ISO with time) and the `not_started` list member.
- **Why it matters**: 215 lines of test maintained in parallel with 295 lines
  covering the same behaviour. When a grammar change lands, two files must move
  together, and the duplicated coverage inflates the apparent safety net over a
  tokenizer that (per the findings above) has real untested holes. Checked
  before reporting: the duplication is *not* load-bearing — no test in
  `query.test.ts` covers a behaviour absent from the other two beyond the three
  cases noted, which would fold into `tokenizer.test.ts`/`parser.test.ts`.
- **Blast radius**: test suite only.
- **Size**: M
- **Auto-fixable**: no (deleting tests is a judgement call, not provable-safe)
- **Confidence**: high

---

### `getFieldValue` / `getTaskFieldValue` are near-identical, with a divergence that is a latent bug

- **File**: `packages/core/src/query/evaluator.ts:138-148` and `packages/core/src/query/list.ts:317-325`
- **Category**: duplication
- **What is wrong**: Both resolve "built-in frontmatter field, else custom field
  under `fields`". The evaluator uses `hasOwnProperty` for *both* lookups; the
  list version uses `hasOwnProperty` for the frontmatter lookup but plain
  `field in task.frontmatter.fields` for the custom-field lookup (line 321).
  The `in` operator walks the prototype chain — so a sort on
  `{ field: "toString" }` against a task that has any `fields` object returns
  `Object.prototype.toString` as the sort key. The regression test at
  `list.test.ts:131-146` covers exactly this hazard but its fixture tasks have
  **no `fields` property**, so the buggy line is never reached and the test is
  green regardless.
- **Why it matters**: The comment on the test explicitly describes the failure
  mode ("crashing the YAML formatter elsewhere if such a value leaked out") and
  the second half of the function still has it. This is the "green test
  asserting the wrong thing" pattern CLAUDE.md flags.
- **Blast radius**: `listTasks` sort with an attacker- or typo-supplied field
  name, when tasks carry custom fields.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: high

---

### `resolvePrimitive`'s UTC fallback reintroduces the timezone bug it documents

- **File**: `packages/core/src/query/evaluator.ts:118-120`
- **Category**: bug
- **What is wrong**: `return ctx.today ?? new Date().toISOString().slice(0, 10)`.
  The `EvalContext.today` docstring (lines 19-29) states the whole point is to
  keep the evaluator pure — "no clock, no config I/O" — yet the fallback reads
  the process clock. `ListOptions.today` is likewise optional
  (`list.ts:55`), and `applyListTasksFilterAndSort` only forwards it when
  defined (`list.ts:252`), so a caller that forgets to pass it gets the exact
  UTC-vs-workspace-timezone behaviour that commit `0602e6e` fixed, silently.
  `list.test.ts:416-423` asserts only that the fallback "doesn't throw".
- **Why it matters**: The defence against a fixed bug is opt-in. A purity claim
  in a docstring that the code contradicts three lines later is worse than no
  claim. Making `today` required at the `ListOptions` boundary would push the
  clock read to the surfaces where it belongs.
- **Blast radius**: signature change on `ListOptions` → CLI, MCP, web callers.
- **Size**: M (S in this file, M once the signature moves)
- **Auto-fixable**: no (public signature)
- **Confidence**: high

---

### `evaluateTextAlias` returns nonsense for every operator except `~`

- **File**: `packages/core/src/query/evaluator.ts:262-320`
- **Category**: abstraction
- **What is wrong**: The function is documented "Only supports the ~ operator"
  but accepts any `op` and threads `op === "~"` through five return sites. For
  `text = "T-1"` on a task with `key: "T-1"`, the title/key/id loop matches and
  returns `op === "~"` → `false`. For `text != "zzz"` with no match it returns
  `true`. Verified both. So `text =` is *always* false and `text !=` is
  *always* true, for every task, regardless of content — and nothing rejects
  either. `validateQuery` does not constrain the operator on `text`.
- **Why it matters**: Fourth instance of accepted-but-meaningless. The `op ===
  "~"` return-value threading is also the wrong shape: the operator should be
  rejected at validation, and this function should return a plain boolean.
- **Blast radius**: `text` alias on all surfaces, including `GET /api/search`.
- **Size**: S
- **Auto-fixable**: no
- **Confidence**: high

---

### `parseCallArgs` accepts bare `FIELD` args, contradicting its own docstring

- **File**: `packages/core/src/query/parser.ts:224-243`
- **Category**: comment
- **What is wrong**: The docstring says "Arguments must be strings: a bare word
  would put relationship kind names back into identifier position, which is the
  collision the function form exists to avoid. Numbers and booleans are rejected
  for the same reason". The code at line 238 accepts `tok.type === "FIELD"`
  — i.e. bare words — and `parser.test.ts:155-159` asserts that acceptance is
  deliberate ("Convenience for the common case"). The docstring describes a
  design that was subsequently relaxed, and now argues against the code beneath
  it. Note this also means a kind named `true`, `today`, `and`, `or`, `not` or
  `in` cannot be written unquoted (it tokenizes as a keyword, not FIELD) — the
  collision the docstring warns about, partially real, partially not.
- **Why it matters**: A comment that contradicts the code and the test is
  actively misleading to the next reader deciding what the grammar guarantees.
- **Blast radius**: none (comment).
- **Size**: S
- **Auto-fixable**: **yes** — comment correction only.
- **Confidence**: high

---

### `list.ts` docstring describes an `offset` that is not on `ListTasksOptions`

- **File**: `packages/core/src/query/list.ts:143-146`
- **Category**: comment
- **What is wrong**: The comment says offset "is not currently surfaced on
  ListTasksOptions; callers that paginate beyond the first page pass it via the
  same options bag". It *is* surfaced — the signature on line 147 is
  `ListTasksOptions & { offset?: number }`, an explicit intersection. The
  comment describes an earlier state.
- **Why it matters**: Minor, but it reads as a warning about an untyped escape
  hatch that no longer exists.
- **Blast radius**: none.
- **Size**: S
- **Auto-fixable**: **yes** — comment correction only.
- **Confidence**: high

---

### `midpointAfter`'s docstring is not a description of what it does

- **File**: `packages/core/src/rank/lexorank.ts:134-140`
- **Category**: comment
- **What is wrong**: "Returns the shortest string `s` such that
  `aRest + ANY === aRest` lexicographically" — this is not a well-formed
  statement (`aRest + ANY` is never equal to `aRest`), and `ANY` is undefined.
  The actual behaviour is: find the first non-`'z'` digit of `aRest`, return the
  `'z'`-prefix plus the midpoint of the remaining digit space; if all `'z'`,
  append `'i'`.
- **Why it matters**: This is the least obvious function in the rank module and
  its only explanation is unparseable. Any future correctness work on `between`
  starts here.
- **Blast radius**: none (comment).
- **Size**: S
- **Auto-fixable**: **yes** — comment correction only.
- **Confidence**: high

---

### `MIN` / `MAX` / `INITIAL` / `evenlySpacedRanks` / `REBALANCE_LENGTH_THRESHOLD` are exported from `rank/index.ts` but not from `core/index.ts`

- **File**: `packages/core/src/rank/index.ts:1-9` vs `packages/core/src/index.ts:214-220`
- **Category**: dead-code
- **What is wrong**: `rank/index.ts` re-exports seven names; `core/src/index.ts`
  forwards only `between` (renamed `lexorankBetween`), `compare` (renamed
  `lexorankCompare`), and the three reorder names. `MIN`, `MAX`, `INITIAL`,
  `evenlySpacedRanks` and `REBALANCE_LENGTH_THRESHOLD` are therefore public
  within the package but invisible to `@loctt/core` consumers. Confirmed by
  grep: no non-test file outside `src/rank/` imports any of them.
  Separately, `lexorankBetween` and `lexorankCompare` themselves have zero
  consumers in `apps/` — the only external users of this module are the three
  `reorder*` functions.
- **Why it matters**: The barrel advertises an API surface that either nobody
  can reach or nobody uses. It also makes the intended boundary unclear: is
  `between` meant to be a public primitive, or an implementation detail of
  `reorder`? The two barrels answer differently.
- **Blast radius**: public export surface of `@loctt/core` — high-risk per the
  brief regardless of how small the diff is.
- **Size**: S
- **Auto-fixable**: no (public export)
- **Confidence**: high

---

### `close` is captured before `expect("RPAREN")` in `parseCallArgs`, making the arity error position fragile

- **File**: `packages/core/src/query/parser.ts:249-256`
- **Category**: abstraction
- **What is wrong**: `const close = this.peek(); this.expect("RPAREN");` — the
  position of the closing paren is captured for the arity error, but if the
  token is *not* RPAREN, `expect` throws first and `close` is never used, so
  the two lines are coupled in a way that only works by accident of ordering.
  More importantly the arity check runs *after* the paren is consumed, so
  `has_link("a","b","c")` reports position 20 (the `)`) rather than position of
  the first excess argument — verified. Pointing at the offending argument
  would be more useful and is available.
- **Why it matters**: Error-position quality is the stated goal of carrying
  `position` through the AST (`parser.ts:6-9`). This site undercuts it.
- **Blast radius**: parse error positions for call arity.
- **Size**: S
- **Auto-fixable**: no (error position is user-visible)
- **Confidence**: medium

---

### Invariant D20 check: no violation found

Checked as instructed. `priority.value` is reachable in the DSL for sorting via
`ENUM_ATTRS` (`validate.ts:57`) and `getNestedFieldValue`/`workflowDefList`
(`evaluator.ts:38-48`), and `buildPriorityMap`/`compareTasks`
(`list.ts:304-343`) substitute the numeric `value` for the key when sorting on
`priority` — which is the "exists for DSL sorting" half of D20. Nothing in this
slice formats or emits `value` for display. The recompute-as-1..N half lives
outside this slice (priority drag-reorder), so it is not judged here.
`validate.ts:266` correctly permits ordering operators on `priority` on the
grounds that they compare against `value`.

**One D20-adjacent risk worth naming, not a violation:** `buildPriorityMap`
silently skips priorities whose `value` is `undefined` (`list.ts:311`), and
`compareTasks` then falls back to comparing the priority *key* as a string
(`list.ts:338-342`), producing alphabetical-by-key order. If the 1..N recompute
ever leaves a gap, `order by priority` degrades to nonsense rather than
failing. Recorded here because D20's stated breakage is "failing to recompute
makes `order by priority` wrong" — this is the code path that would be wrong,
and it does so silently.

### Files with no findings

None. Every non-test file in the slice produced at least one finding, except
`packages/core/src/query/index.ts`, which is a clean barrel (its only issue is
the asymmetry noted under the `rank/index.ts` finding, which is about
`core/index.ts`, not this file).
