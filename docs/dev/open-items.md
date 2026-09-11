# Open items — to review and resolve

Working items that still need a decision or follow-through. Unlike
`known-gaps.md` (understood defects) and `decisions.md` (settled calls),
this is the **to-do list**: things nobody has ruled on yet.

**The bar for closing an item:** a decision alone is not "done". Where an
item changes behaviour, its resolution is codified the way everything
else in this repo is — a case in `docs/dev/ui-test-cases/` or
`docs/dev/surface-test-cases/`, a test tagged `@verifies`, and the call
recorded in `decisions.md`. Delete the item here only once that has
landed (or once it is decided the item needs no code).

---

## 1. `PROPOSED-UI-CASES.md` — flow-doc contradictions and proposed cases

**Status:** OPEN — awaiting Ken's accept / reject / reword per item.
The specification proper is `docs/dev/ui-test-cases/*.md` + `case-index.json`
(1039 cases), which the tests tag `@verifies` against; `PROPOSED-UI-CASES.md`
is the pending-changes queue against that spec, part applied, part open.
**In progress (2026-09-11):** an audit is classifying each item as
already-applied / decided-not-applied / genuinely-open so the still-open
set can be put in front of Ken rather than the whole 30-item file.

The repo-root file `PROPOSED-UI-CASES.md` collects, from the v1 audit,
three kinds of item against the 18 UI flow docs: (1) contradictions
between two existing cases, (2) cases that fail as written, (3) proposed
new cases. **Some items are already DECIDED** (see `decisions.md` § 9,
2026-08-29: the SET-3/SET-6 contradiction, the body-save question,
project URL slugs, BLK-30's threshold, the CSV export) — those sections
are kept only for their reasoning.

**To resolve:**
- Go through the still-open items and rule on each.
- For every ruling that changes behaviour: append/reword the case in the
  relevant `docs/dev/ui-test-cases/*.md` (never renumber), run
  `npm run cases:index`, write a test tagged `@verifies`, and record the
  call in `decisions.md`.
- Then delete `PROPOSED-UI-CASES.md` — its contents will live in the flow
  docs and the decision log, which is where the specification belongs.

## 2. `CASE-AUDIT.md` (repo root)

**Ken's ruling (2026-09-11):** action the audit — anything unresolved goes
to `TEMP-TODO.md`, then delete the file. **In progress:** each finding is
being checked for resolved-vs-open against current code / known-gaps /
decisions; the open ones land in TEMP-TODO and the file is then removed.

## 3. `QUERY-BUILDER-PROPOSAL.md` (repo root) — ✅ RESOLVED 2026-09-11

Ken's ruling: a live feature idea, not yet built → tracked in
`TEMP-TODO.md` (the visual nested query builder under Features, with its
three open rulings under "Needs a ruling"). The root proposal file was
deleted; its substance is preserved in TEMP-TODO.

## 4. `temp-ui-mockups/` (repo root) — ✅ RESOLVED 2026-09-11

Ken's ruling: delete. The real web UI and its design-system primitives
(`apps/web/src/client/ui/`) supersede the pre-build mockups. Deleted, and
the two stale references fixed (the `tokens.css` header comment and the
`tools/coverage/scan.ts` skip-dir entry).

---

*Created during the 2026-09-09 repo sweep, when the v1 build scaffolding
was cleaned up. These four items were the ones that needed a real
decision rather than a mechanical cleanup.*
