# Rulings brief

The open decisions that gate the pre-publish build (TEMP-TODO K73). Each
section gives: **what the code does today** (file:line), **the tension**
(why it isn't obvious), **the options with their costs**, and **a
recommendation**. Rule on each; answers are recorded as K-numbers in
`decisions.md §9`, and the sequential build loop then runs unblocked.

Ground truth verified against source 2026-09-11. **Three items that the
backlog listed as open turned out already resolved** — they need no
ruling, only a verify-and-close. They're in Part A so you can confirm the
finding rather than decide. The genuine rulings are Part B.

Already decided this session: **K75** NEW-20 (per-surface), **K76**
deep-linking workstream.

---

## Part A — already resolved; confirm, don't decide

### A-1. Broken-view write (VUE-22 area) — **fixed already**
The backlog listed this as a live P1 data-loss. It isn't any more.
`packages/core/src/config/queries.ts:150-180` — `serializeBrokenQuery`
re-emits a broken entry from its full on-disk `rawText`, and
`buildQueriesPlainObject` writes `[...valid, ...broken]` into one array,
so a write **no longer drops a broken sibling** (closed under K28 /
Phase Z C2; the code comments say so explicitly). VUE-22 itself only ever
covered the read/display path. **Action: verify with a test that a write
preserves a concurrent broken view, then delete the stale `known-gaps`
entry. No ruling.** (Confirm you agree it's closed.)

### A-2. BAK-C18 (dangling-reference: refuse vs report) — **already ruled**
Listed as a case-vs-invariant contradiction. It was adjudicated
2026-09-02: the case was **rewritten to "report/keep"** to match P-11/P-12,
and you ruled for the invariants (recorded in `decisions.md`). The
dangling *relationship* is kept and reported; the missing *project* half
still refuses (schema rejects it). Case and invariants now agree. **Action:
the `known-gaps` note is stale — delete it. No ruling.**

### A-3. TSK-32 vs DEG-29 — **doc reconciled; it's a test fix, not a contradiction**
The TSK-32 case was already revised (per A179) to defer to DEG-7/DEG-29:
an unrecognised key **is** shown in the "Not recognised" group. The
load-bearing half (the key survives a status edit — data-loss guard) is
unaffected. What remains is that the **spec test still asserts the old
"panel does not show the key" behavior and fails on clean HEAD**. **Action:
update the test to the revised case. No ruling** (unless you want to
revisit A179 itself).

---

## Part B — genuine rulings

### B-1. `field != null` semantics *(gates a correctness fix)*
**Today:** `packages/core/src/query/evaluator.ts:244-248` — for a field
that's unset, `!=` returns `true`; and `null` on the right is parsed as
the literal string `"null"` (there's no null literal in the tokenizer).
So `milestone != null` matches **every** task — unset ones via the
undefined branch, set ones because `"<ulid>" !== "null"`. It answers
`200` with an empty `warnings` array: **silent, and wrong in the
permissive direction.**

**Tension:** fixing the bug forces a definition. What should `!= null`
*mean* for an optional field — "is set" vs "was explicitly cleared"? And
should `null` even be a value, or should presence be its own operator?
Related: `sprint = null` matches nothing today, `sprint is null` errors
at parse.

**Options:**
- **(a) [rec] Add real `is null` / `is not null` operators; make `= null` /
  `!= null` an error.** `field is not null` → field is set; `field is
  null` → field is unset. Honest and unambiguous; the DSL gains a proper
  presence test. Cost: tokenizer + parser + evaluator + docs; the query
  builder (B-6) then exposes it. This is also what the `known-gaps` design
  note (1413-1448) proposes.
- **(b) Just fix `!= null` to mean "is set".** Smaller change, no new
  operator. Cost: keeps `null`-as-string weirdness elsewhere; less clear.
- **(c) Reject any `null` comparison at parse time.** Smallest; removes a
  footgun but also a capability.

**Recommendation: (a).** It's the fix that leaves the DSL coherent, and
the query builder needs a presence test anyway.

### B-2. SET-45 — I/O failure vs validation failure on workflow write
**Today:** `apps/web/src/server/server.ts:1477-1519` — `handlePutWorkflow`
has an inner catch: a `LocttError` maps by code, **everything else** →
`400 config_invalid`. But an EACCES/disk error throws `FsAccessError`,
which extends `Error`, **not** `LocttError` — so a permission/disk problem
is reported to the user as "your config is invalid" (400), blaming their
input for a machine fault. The correct mapping (`FsAccessError` →
`500 io_failed`) exists at the top-level handler (`server.ts:5191`) but
the inner catch intercepts first and never rethrows. The read path already
gets this right. **Note: there is no SET-45 case in the repo** — "SET-45"
is the ruling label; a case must be written.

**Tension:** none, really — this is a latent mis-mapping. The only
question is whether it's worth a case + fix pre-publish.

**Options:**
- **(a) [rec] Fix it: add an `FsAccessError` branch → 500 `io_failed`,
  write the case.** One handler branch; the machinery (`statusForCode`)
  already maps `io_failed`→500. Small, correct, and it's a lie to the user
  otherwise.
- **(b) Won't-fix.** Accept the generic 400. Record the reason and close.

**Recommendation: (a)** — it's tiny and the current behavior misattributes
a fault to the user, the exact thing ERR-1 exists to prevent.

### B-3. A80 — `loctt init --prefix` validation
**Today:** core (`packages/core/src/init/init.ts:199`) validates **only
non-emptiness**, so `--prefix "web/x"` is accepted and allocates keys like
`web/x1`, which **break the task's own URL** (`/tasks/web/x1`). The web
wizard has a *narrow* format validator (`apps/web/src/client/init/prefix.ts`)
rejecting only URL/YAML-breaking chars. The narrow rule was already
**decided (A80)**: reject only breaking chars, accept lowercase/unicode/
no-trailing-dash. What's **not** settled is the core side.

**Tension:** the clean fix is core-side validation so CLI and UI agree by
construction — but that **changes what an existing command accepts and
could reject prefixes in trackers already on disk** (a migration risk).
Your docs explicitly parked that as "Ken's call, not an agent's."

**Options:**
- **(a) [rec] Add core-side prefix validation matching the narrow rule,
  applied only at `init`/`setProjectPrefix` (new trackers), not
  retroactively.** New trackers can't create URL-breaking prefixes; existing
  trackers are untouched (no migration). Cost: a small divergence — an old
  tracker could still hold a bad prefix — surfaced by `doctor`.
- **(b) Validate + migrate:** also flag/repair existing bad prefixes.
  Correct but a real migration; heavier.
- **(c) Leave core as-is; rely on the web wizard only.** CLI stays
  permissive; the two surfaces disagree by design.

**Recommendation: (a)** — closes the footgun for everyone going forward
with no migration risk; `doctor` covers the legacy tail.

### B-4. DS-A11Y40 — checkbox/radio border below 3:1
**Today:** `ui/Checkbox.tsx`/`ui/Radio.tsx` use `--border-strong`
(`#A7B1C2` light / `#43434A` dark) for the **resting, unchecked** control
edge — **2.16:1 light, 1.88:1 dark**, below the 3:1 WCAG needs for a
control boundary. Checked/focus states are fine. `--border-strong` is
shared app-wide, so darkening it changes every strong border.

**Tension:** raise contrast for controls without over-darkening every
other strong border.

**Options:**
- **(a) [rec] Add a dedicated `--border-control` token at ≥3:1**, used only
  by checkbox/radio. Surgical; nothing else shifts. Cost: one more token.
- **(b) Deepen `--border-strong` itself to ≥3:1.** Fewer tokens, but every
  strong border in the app gets darker — a global visual change.

**Recommendation: (a)** — a control boundary and a decorative-strong
border are genuinely different jobs; a separate token is the honest model.

### B-5. DS-BORDER-SUBTLE — hairline below 3:1
**Today:** `--border-subtle` is ~1.30:1 (deliberately faint). The problem:
some call sites use it as a **real divider** (`ListView.tsx:778`,
`BulkBar.tsx:110`, section separators), and a real divider should reach
3:1 — but "no hairline that still reads as decorative reaches 3:1 without
becoming as heavy as `--border-default`."

**Tension:** it's serving two jobs (decorative hairline vs structural
divider) with one token.

**Options:**
- **(a) [rec] Keep `--border-subtle` decorative; migrate the real-divider
  call sites to `--border-default`.** Honest split by role; the dividers
  that carry meaning get real contrast, hairlines stay hairlines. Cost: a
  handful of call-site edits + deciding which are "real."
- **(b) Strengthen `--border-subtle` to ≥3:1.** One token change, but every
  decorative hairline becomes a full-weight border — visually heavier
  everywhere.

**Recommendation: (a)** — same principle as B-4: separate the roles rather
than overload one token.

### B-6. Query builder — three design rulings *(gate the ~week feature)*
The visual nested query builder (MSL-7, LST-40/44/45) is a real build; its
shape needs three calls. Your docs already carry recommendations:
- **(i) A DSL the builder can't render** (user types something exotic):
  **[rec] refuse to open the visual builder and show only the text box** —
  honest, never silently rewrites a user's query. Alt: best-effort +
  warn, or offer-to-rewrite.
- **(ii) Replace the chip bar, or coexist?** **[rec] coexist** — add an
  "Advanced" affordance beside the chips so the common case stays a
  two-click filter. Alt: builder replaces chips (one mental model, but
  slower common case + LST-40/41 rewrite).
- **(iii) Scope of `NOT` in v1?** **[rec] defer `NOT` to v2** — nested
  negation is where these UIs get confusing; ship and/or nesting first.

**Recommendation: accept all three [rec]s** unless you want a different
feel. These don't block anything until the builder is scheduled — but
deciding now means it's ready to build when its turn comes.

---

## Summary of what I need from you

| # | Ruling | My rec |
|---|---|---|
| A-1/A-2/A-3 | confirm 3 items are already-resolved (verify + close) | — |
| B-1 | `!= null` semantics | add `is null`/`is not null` operators |
| B-2 | SET-45 IO-vs-validation | fix + write the case |
| B-3 | A80 core prefix validation | validate new trackers, no migration |
| B-4 | checkbox/radio contrast | new `--border-control` token |
| B-5 | subtle-border contrast | migrate real dividers to `--border-default` |
| B-6 | query builder ×3 | refuse / coexist / defer NOT |

Rule by number (e.g. "B-1 (a), B-3 (a), B-6 accept all"); I'll record each
and start the build.
