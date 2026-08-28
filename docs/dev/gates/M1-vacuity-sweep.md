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
| BLK | — | — | — |
| LST | — | — | — |
| SHL | — | — | — |
| ERR | — | — | — |
| MSL/VUE/ONB/TSK | — | — | — |

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
