# M1 vacuity sweep

**Run 2026-08-29**, after an ERR-2 test was found passing on retry
backoff rather than on the recovery it claimed to verify.

Six agents, one per case-prefix group, each in an isolated git
worktree. The method per test: read the case in full, apply the
narrowest source change that would break the behaviour the case
requires, rebuild, run only that test. **The test must go red.** A
test that stays green asserts nothing.

Isolation was not optional. The UI fixture serves `apps/cli/dist`, so
a concurrent `npm run build` swaps the binary mid-run — the harness
defect recorded in `tests/ui/README.md`, which has caused three
misdiagnoses in this repo.

## Results

| Group | Checked | Vacuous | Weak |
|---|---|---|---|
| XS | 20/20 | 1 | 1 |
| MSL/VUE/ONB/TSK | 24/24 | 5 | — |
| SHL | 25/25 | 2 | 1 |
| LST | 45/49 | 12 | 1 |
| ERR | 16/16 | 6 | 2 |
| BLK | 56/56 | **0** | — |

**Complete: 27 vacuous of 186 checked.** LST's remaining 4 (LST-3, 18,
38, 43) have **no test at all** — a coverage gap, not a verdict.

---

## XS — 20 of 20 checked, 13 distinct mutations

Baseline green established before, and the full set re-run against
restored source after, so every red is attributable to a mutation
rather than to a broken tree.

### XS-1 — VACUOUS

`tests/ui/flow-list.spec.ts:3188` — "a CLI edit converges without a
manual reload, disturbing nothing else".

**Mutation:** all three staleness mechanisms disabled in
`queryClient.ts` — `staleTime` → `Infinity`, `refetchOnWindowFocus` →
`false`, healthy-path `refetchInterval` → `false`. Build succeeded.
**Still passed, 3.1s.**

**Why it asserts nothing.** The test calls `page.reload()` — the exact
thing the case forbids ("Convergence happens without the user pressing
browser reload"). A full page load refetches from the server whatever
the client cache is set to, so every client-side mechanism can be
deleted and the test cannot see it. The dropdown click and Escape
before it are inert, despite a comment claiming they stand in for an
explicit refetch.

Two further assertions are dead. The selection set up as "a selection
the refetch must not disturb" is never re-asserted — it cannot be,
because the reload clears it, so the case's third bullet is
unverified. "Sort survived" checks only the URL, which a reload
preserves for free.

**Deceptive because it does go red** under a server-side mutation
(freezing the task scan in a boot cache). That proves the server
re-reads on a cold load, not the client convergence the case is about.

**Fix:** drop the reload. Wait out the staleness window against the
exported `STALENESS_WINDOW_MS`, or drive a real hidden → visible
transition so `refetchOnWindowFocus` fires. Then assert on the
never-reloaded page: the row shows the new value, "1 task selected" is
*still* visible, scroll and filters unchanged.

### XS-39 — HEALTHY overall, one half asserts nothing

`tests/ui/flow-list.spec.ts:3483`. Goes red when the lazy
`foldUnknownTasks` path is deleted from `lookupByKey`, which is the
mechanism its case names — caught by its CLI assertion.

Its **UI half** survives a permanently frozen server-side task scan.
The test writes the new task directory *before* the first
`page.goto`, so the UI only ever cold-loads a directory that was
already on disk. The case says "**With the UI open**, `git pull` new
task directories" — the ordering is reversed.

**Fix:** move the `page.goto` above the directory write, so the pull
happens under a loaded list.

### Gap: XS-2's bound is unasserted anywhere

`STALENESS_WINDOW_MS` is exported from `queryClient.ts` with a comment
saying it exists "so a test asserts the same constant the client is
configured with". Grepping `XS-2\b` across `tests/ui/*.spec.ts`
returns nothing.

So the 60-second staleness contract has no test on either side: no
test pins the bound, and XS-1 — the test that would naturally carry
that assertion — reloads instead. Any refetch interval at all would
pass today.

### The other 18 — healthy

Each went red under a mutation targeting its own named behaviour,
across config re-reading, drift markers, query parity, view
persistence, archive semantics, and unknown-field validation.

---

## The pattern to carry forward

**A test that reloads the page is suspect.** A reload refetches
everything from the server regardless of client state, so it can mask
the deletion of every mechanism the case is about — and it destroys
selection, scroll and in-memory state, quietly skipping any assertion
that depends on them.

This is the same shape as the ERR-2 defect that prompted the sweep:
in both, the test observed something real happening for a reason that
had nothing to do with the behaviour under test.

---

## MSL / VUE / ONB / TSK — 24 of 24 checked, 5 vacuous

Every mutation compiled (`✓ built` confirmed before each run), and
every vacuous verdict was re-confirmed green on unmutated source, so
it is genuinely vacuous rather than broken. Several mutations were
cross-checked against a neighbouring test that *did* go red, proving
the mutation reached the binary.

### VUE-13 — VACUOUS

"A saved view's sort persists as field + direction and applies."

**Mutation:** `SaveViewDialog.tsx:26`, `search.sort !== undefined` →
`false`, so the view is saved with **no sort at all**. Still passed.

The two assertions regex the *whole* `queries.yaml` for
`/field: priority/` and `/direction: desc/` — and both strings already
exist in the shipped default views (`defaults.ts:116-126`). They match
the defaults, never the view just saved. The CLI ordering check also
passes, because with no stored sort the fallback order happens to put
High before Low.

**Fix:** parse the YAML and assert on the `by-priority` entry's own
`sort` array. Seed the CLI check so the fallback order *differs* from
the requested one, so it can tell "the view's sort applied" from "the
default order agreed".

### VUE-15 — VACUOUS

**Mutation:** `builtinFilters.ts:153`, the High-priority built-in
drops its `priority in (...)` clause — it navigates but never narrows.
Still passed. (VUE-3 and VUE-4 went red on this same mutation.)

The test captures a row count and asserts a cold load yields the *same
count*. It never asserts which rows, never that the count changed,
never that the filter applied. "The built-in did nothing" and "the
built-in worked" are indistinguishable to it.

### MSL-7 — VACUOUS

**Mutation:** `useTasks.ts:88`, `"labels"` removed from `FILTER_KEYS`,
dropping the label filter from the request while the URL param and
chips stay intact. Still passed. (MSL-6 and MSL-21 went red.)

Both seeded tasks carry the `bug` label, so the filtered and
unfiltered sets are **identical**. Every other assertion is about the
URL string and the chip count, not the rows.

This is precisely the failure the code's own comment at
`useTasks.ts:98-102` warns about for custom fields.

**Fix:** seed a third task carrying neither label.

### MSL-22 — VACUOUS (styling half only)

**Mutation:** `cells.tsx:220`, hex validation removed so `notahex`
reaches CSS. Still passed.

The check is `expect(bg).not.toBe("rgba(0, 0, 0, 0)")`, but the pill
has no background class — so when the CSS parser drops the invalid
inline value, the pill inherits the table's opaque background and can
never be transparent. The assertion cannot fail for the reason the
case cares about, which is its own stated requirement that an invalid
value must not reach CSS at all.

Its other assertions are real; only the styling half is dead.

### MSL-30 — VACUOUS

Checks URL text and chip count, never rows. Survived **two**
independent mutations: labels dropped from `FILTER_KEYS`, and chips
filtered to resolvable values only.

### ONB — entirely sound

Flagged in the brief as prime vacuity candidates; all six are genuine.
They distinguish P6's four designed states, and ONB-26's 20ms polling
loop catches a real single-frame empty flash rather than producing an
ERR-2-style false pass.

### Healthy (19)

MSL-6/19/21/23/26, VUE-3/4/5/6/7/14, ONB-8/12/24/25/26/33, TSK-1.

---

## The second pattern: asserting the label, not the effect

Four of these five assert on **URL strings, chip counts, or file-wide
regexes** rather than on the row set or the specific entry. That makes
"the filter is displayed" and "the filter is applied"
indistinguishable — and the filter is the part that can break.

Two failure shapes have now been seen repeatedly:

1. **The reload does the work** (XS-1, ERR-2) — a page load or an
   in-flight retry produces the observed recovery, so the mechanism
   under test can be deleted unnoticed.
2. **The label is asserted, not the effect** (MSL-7, MSL-30, VUE-15) —
   the UI's description of what it is doing is checked instead of what
   it did.

A third, narrower: **seeding that cannot discriminate** (MSL-7) —
where every seeded row satisfies the filter, so filtered and
unfiltered results are identical.

---

## SHL — 25 of 25 checked, 3 vacuous (one partial)

### SHL-26 — VACUOUS

"A fresh navigation starts at the top."
`tests/ui/flow-app-shell.spec.ts:193`

**Mutation:** `useMainScrollRestoration.ts:62` forced to
`el.scrollTop = 800` on **every** navigation, re-applied across 1.5s —
the exact opposite of the case. Still passed.

**Why.** A probe found the `/board` pane has
`scrollHeight: 672, clientHeight: 672` — **zero scrollable range**. So
`scrollTop` is pinned at 0 whatever the app does, and
`toBeLessThan(100)` cannot fail.

This is the ERR-2 archetype exactly: the assertion is satisfied by an
environmental accident rather than by the code.

### SHL-6 — VACUOUS

"Each built-in filter's URL reproduces its result set."
`tests/ui/flow-list.spec.ts:5123`

**Mutation:** the filter's URL contribution stripped at
`Sidebar.tsx:438`. Still passed. A probe under the mutation printed
`url=/list rows=3 aria-current=page` — the filter entirely inert, all
three rows showing, and all three assertions holding.

Each assertion is toothless on its own terms:

- `Showing 1–\d+ of \d+` matches any count
- `aria-current` comes from TanStack matching the **path** `/list`, so
  it ignores search params — which is where the filter lives
- the fresh-tab check compares the broken page's row count against a
  tab broken identically. **Self-consistency that holds precisely
  when both sides are wrong.**

### SHL-8 — PARTIALLY VACUOUS

`tests/ui/flow-list.spec.ts:5109`:

```ts
await expect(row).toHaveAttribute("aria-disabled", /true|/);
```

The regex has an **empty alternative**. `/true|/` matches any string
at all — `"false"`, `"banana"`, anything. Verified directly.

The test survives only on its separate `title` assertion, so the
A11Y-31 claim it advertises asserts nothing.

**Swept the suite for the same shape** (`/x|/` in an attribute or text
matcher): this is the only occurrence.

### Healthy (22)

SHL-1 (×2), 2, 4, 5, 7, 9, 11, 15, 16 (×2), 24, 25, 27, 28, 29 (×2),
30, 31, 41, 42, 43.

The group flagged as highest-risk — the shell's degraded states — is
**genuinely solid**. SHL-41 and SHL-11 both went red against the real
ERR-1 conflation (making an unreachable server render "No tracker here
yet"), and SHL-43 caught the same conflation one layer down. SHL-29
went red when the theme script was made non-blocking, so it tests
first paint rather than eventual state.

### Two mutations that were inert, not survived

SHL-30 and SHL-42 each needed a second mutation before going red, and
the agent verified *why* rather than scoring the first attempt as a
pass:

- SHL-30 needed the 404 to auto-redirect, not merely lose its pathname
- SHL-42's root `errorComponent` never fired until the child `/list`
  boundary that caught the throw first was also removed

**This distinction is the sweep's main methodological risk.** An inert
mutation and a survived mutation both look like a green test. The
agent also caught itself checking a stale bundle path on its first
SHL-26 attempt, and re-verified against the minified bundle
thereafter — which is what grounds the SHL-26 and SHL-6 findings.

---

## LST — 24 of 49 checked, 8 vacuous

The group is **49, not 53**: LST-9 and LST-13 have two tests each, and
LST-3, 18, 38 and 43 have no test in the file at all.

This sweep is **partial and says so**. 25 tests were not mutated and
carry no verdict — including several that stayed green under mutations
aimed at other cases, which the agent correctly refused to count as
evidence of health.

### LST-47 — VACUOUS

Unreachable API. Its only positive assertion is that "Loading tasks"
is visible — that is the `context` prop, and it renders regardless.

**Mutation:** the unreachable headline gutted to "Something went
wrong." **and** the Retry button deleted entirely. Still green.

The case's "name the reason" and "retry re-issues the request"
bullets are both unasserted. P-4 requires the reason; this test would
not notice its removal.

### LST-52 — VACUOUS

Asserts a Retry button via `.first()`, which matches the **Sidebar's**
Retry, not the table's. Delete the table's retry control and the test
still finds a button, clicks it, and the resulting refetch revalidates
the table.

It measures the sidebar.

### LST-4, LST-21, LST-27 — VACUOUS (sort bullet)

**Mutation:** the comparator zeroed (`0 * compareTasks(...)`),
disabling all sorting. All three survived.

Each tests "sorting is deterministic" as "two loads agree" — and
insertion order is perfectly deterministic. Determinism is not
sortedness.

### LST-15 — VACUOUS

The `searchable: false` bullet asserts only HTTP 200; the response
body is never inspected. Making every custom field searchable left it
green. Its `has_link` two-argument bullet is not exercised at all.

### LST-33 — VACUOUS, **and the shipped code fails the case**

**Mutation:** deleted-entity chips made to render a blank label —
verbatim the defect the case exists to catch. Still green.

More importantly: production has no "no longer exists" affordance
either. `labelOf` in `FilterBar.tsx:280` falls back to `?? value`, so
a deleted milestone renders as a **raw ULID**. LST-33 requires the
chip to indicate the entity is gone, *distinguishably from a valid
milestone with no tasks*.

**This is a live defect, not only a dead test.** Filed as such.

### LST-1 — VACUOUS (replace-vs-push bullet)

**Mutation:** the redirect changed from replace to a history push. The
assertion `not.toHaveURL(/…\/list/)` after Back is satisfied by
landing on `/` — which **is** the bounce the case forbids.

### LST-22 — weak but healthy

Goes red on an inverted sort, green on a disabled one: its ordering
assertion coincides with seed order. Classified healthy, but it reads
stronger than it is.

### Healthy (18)

LST-6, 8, 10, 16, 19, 20, 23, 24, 25, 26, 30, 31, 34, 39, 45, 46, 49,
50.

### A correction the agent made against itself

Its first LST-16 mutation hit `buildDsl.ts`, which is not the live
path — that green was **off-target, not survived**. Re-mutating the
real path (`useTasks.ts`) turned it red. LST-16 is healthy.

Same distinction as SHL-30/42: an inert mutation and a survived
mutation are indistinguishable from the test result alone. Every
sweep that has run has hit this at least once.

### Second pass — 21 more checked, 4 more vacuous

- **LST-7** — the skeleton replaced with a bare `Loading…` row, which
  is verbatim the "bare centered spinner over empty chrome" the case
  rules out. Green. Its only positive assertion is `tbody tr`
  first-visible, which any row satisfies.
- **LST-29** — the effect that strips an unrecognised sort key from
  the URL disabled. Green. The agent distrusted this green and wrote a
  throwaway probe: unmutated, `?sort=nonexistent_field` corrects to
  bare `/list`; mutated, it persists. The case's third bullet — "does
  **not** silently persist as though it were applied" — is unasserted
  because the test never reads the URL.
- **LST-37 and LST-39** — both refetch triggers disabled
  (`refetchOnWindowFocus`, healthy `refetchInterval`), confirmed in the
  bundle. Both stayed green, because each calls `page.reload()`.
  LST-37's case says the row must go "after refetch — **not only after
  a full page reload**", which is exactly what the test cannot
  distinguish.

### LST-42 — a product gap, not a test defect

Healthy on execution (stripping backslashes from `q` turned it red).
But its bullet "after reload the search box shows the original text"
is **untestable as built: there is no search-box UI.** `q` is only
ever read from the URL; nothing in `apps/web/src/client` binds an
input to it.

### Coverage gap: LST-3, 18, 38, 43 have no test

**LST-3 is the one that matters.** It is a blocker, and its central
bullet is:

> the request carried the sort — asserting only the rendered order
> lets a client-side sort of the current page pass

That is precisely the hole the comparator mutation exposed in LST-4,
LST-21 and LST-27. **The case that would have caught those three was
never written.**

---

## ERR — 16 of 16 checked, 6 vacuous

### The headline finding

**Blanking the error headline is caught by exactly one of sixteen
error tests.**

`ErrorState.tsx:94` renders `headline(error)` — the single sentence
saying what went wrong. Blank it, and only ERR-10 notices. Four tests
assert the `context` label ("Loading tasks") plus a Retry button, and
never the reason.

P-4 requires an error to name *the thing, the reason, and the next
action*. Across this group's read-failure surfaces, **the reason is
unverified**.

### The shared root cause

Five of the six vacuous tests assert on the alert **container** and
assert **absences**.

The container is `role="alert"` at `ErrorState.tsx:90`, and the
`context` label lives *inside* it (line 92), above the headline. So
`toMatch(/tasks/i)` against the alert is satisfied by "Loading tasks"
alone — the context prop, which renders whatever the error is.

And any "container does not contain X" assertion **gets weaker as the
app says less**. The whole cluster is green in the limit where the
error surface is empty.

ERR-42 is the sharpest: its only positive check is `toMatch(/tasks/i)`,
so it is *strictly easier to pass the less the app says*.

This is one structural flaw, not six bugs.

### Vacuous (6)

| Case | Mutation that survived |
|---|---|
| ERR-19, ERR-21, ERR-41, ERR-42 | headline blanked (`ErrorState.tsx:94`) |
| ERR-20 | `Dash` renders blank (`cells.tsx:280`) — the case requires an explicit unknown marker; the test only forbids the string "undefined" |
| ERR-9 | parse error dropped (`ListView.tsx:456`) — the test's own name claims "named with its parse error", and that claim is false under the mutation |

### ERR-2's fix holds

With the recovery poll disabled, **ERR-2 was the only one of sixteen
to fail** — confirming `cc45c2f`'s quiesce genuinely pins the
mechanism rather than passing on backoff.

### Two qualifications the agent raised

**ERR-41 is half-healthy.** A different mutation — making the error
surface render literal empty-state copy — *did* turn it red, so its
non-conflation claim (ERR-1's requirement that a failure and an
absence not look alike) is real. Only its "distinct copy" claim is
vacuous. Recorded as vacuous because the case demands both, but it
should be repaired rather than rewritten.

**ERR-1's offline variant is healthy only by its own admission.** Its
comment states it does not pin the fix — it passes with
`networkMode: "online"` too, and names `ListView.paused.test.tsx` as
the real guard. It is a browser-realism exercise, not a regression
guard, and should not be counted as coverage.

### Healthy (10)

ERR-1 (dead server), ERR-2, ERR-5, ERR-10, and the four bulk tests
ERR-17/30/39/40 all went red appropriately.

---

# What makes a test vacuous — the four shapes found

Five groups swept, 23 vacuous of 109. They are not 23 independent
mistakes; they are four recurring shapes. **Check new tests against
these before writing them.**

## 1. Something other than the app does the work

The test observes a real effect produced by something that is not the
behaviour under test.

- **ERR-2** — the server was restored while retry backoff was still
  sleeping. The pending retries woke and succeeded. Recovery was real;
  the recovery *mechanism* was untested.
- **XS-1** — calls `page.reload()`. A page load refetches from the
  server whatever the client cache says, so `staleTime`,
  `refetchOnWindowFocus` and `refetchInterval` can all be deleted
  unnoticed.
- **SHL-26** — asserts `scrollTop < 100` on a pane whose
  `scrollHeight == clientHeight`. There is no scrollable range, so the
  assertion holds however the app behaves.
- **LST-52** — asserts a Retry button with `.first()`, which matches
  the **sidebar's**. It measures the sidebar.

**Test:** if I delete the mechanism this case names, does anything
else in the environment produce the same observation?

## 2. The label is asserted, not the effect

Assertions on URL text, chip counts, `Showing 1–N of M`, or the
presence of a control — the UI's *description* of what it is doing
rather than what it did. "Filter displayed" and "filter applied"
become indistinguishable, and applying is the half that breaks.

- **MSL-30, VUE-15, SHL-6** — URL and counts, never the rows.
- **LST-4/21/27** — test "sorting is deterministic" as "two loads
  agree". Insertion order is perfectly deterministic. Determinism is
  not sortedness.

**Test:** does this assertion distinguish the feature working from the
feature being a no-op?

## 3. Absence assertions weaken as the app says less

`not.toContainText`, `not.toBe`, "does not look like an empty state" —
all get *easier to pass* the less the surface renders. A cluster of
them is green in the limit where the app says nothing at all.

- **ERR-19/21/41/42** — blanking the error headline is caught by one
  of sixteen ERR tests. ERR-42's only positive check,
  `toMatch(/tasks/i)`, is satisfied by the context label alone.
- **MSL-22** — `bg !== "rgba(0,0,0,0)"` cannot fail: the pill has no
  background class, so a dropped invalid colour inherits an opaque
  background.

**Test:** pair every absence with a positive assertion about what
*should* be there.

## 4. Seeding that cannot discriminate

Every seeded row satisfies the filter, so filtered and unfiltered
results are identical.

- **MSL-7** — both seeded tasks carry the label being filtered on.
- **VUE-13** — regexes the whole `queries.yaml` for strings that
  already exist in the shipped defaults.

**Test:** does the fixture contain at least one row the behaviour must
exclude?

---

# The method's own failure mode

**An inert mutation and a survived mutation are indistinguishable from
the test result alone.** Every sweep hit this at least once:

- LST-16's first mutation hit `buildDsl.ts`, not the live path
- SHL-26's first attempt was absent from the bundle — a stale asset
  path was being read
- SHL-30 and SHL-42 each needed a second mutation before going red

So a green result must be checked twice: **did the build succeed, and
did the change reach the running code?** A mutation that does not
compile is not a mutation, and one on a dead path is not either.

The agents that caught these caught them by probing the mutated
binary rather than trusting the edit. That step is not optional.

---

## BLK — 56 of 56 checked, **zero vacuous**

The count is 56, not 57: one tag (`// @verifies BLK-38, BLK-39`)
covers two cases.

Every BLK test went red under a mutation targeting the exact behaviour
its case requires. 37 mutations applied, 35 valid. Control run both
ways — all 56 green before mutating, all 56 green again after
restoring, `git diff` empty — so every red came from the mutation in
front of it.

**This is the M1.4 group: the only tickets built under the disciplined
loop rather than marked ✅ beforehand.** It is also the only group with
no vacuous tests. That is the clearest evidence the sweep produced
about what the build loop is worth.

Several of these tests defend against this exact failure mode *and say
so in comments*, and every such distinction held under mutation:

- **BLK-10** picks "Set status" for its supersede test *because* it
  does not clear the selection — so Undo must vanish by supersede
  rather than by unmount
- **BLK-9** asserts `"OLD → NEW"` as one string, because two
  `toContainText` calls would pass with the arrow reversed
- **BLK-7/8** force an archived entity into the payload, because
  asserting against the live response would pass whether or not the
  client filters

### Two invalid mutations, caught rather than scored

Both first produced a false "survived":

- **BLK-43** — `setFailure` removed from the `catch` block, but the
  test drives an HTTP 500, handled by an earlier `if (!res.ok)` branch
  with its own `setFailure`. Redone: red.
- **BLK-46** — the `if (def.archived)` throw in `move.ts` disabled,
  test still green. The agent probed the live page rather than
  recording it vacuous, and found the refusal actually originates at
  `packages/core/src/projects/manage.ts:114`. Mutating *that*: red.

The BLK-46 probe surfaced something worth knowing: `menuitem "Ops"`
has count 0 at click time, because `active()` in `BulkBar.tsx` filters
the archived project out of the picker. The test is healthy and does
reach the server guard, but by a more indirect route than its name
suggests — a landmine if it is ever edited.
