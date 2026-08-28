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
| BLK | — | — | — |
| LST | — | — | — |
| ERR | — | — | — |

**9 vacuous of 69 checked so far.**

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
