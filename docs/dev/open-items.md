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

**Status:** OPEN — needs a read to decide if anything is unactioned.

A point-in-time case audit. Most such artifacts from the v1 run have been
deleted; this one sits at the root. **To resolve:** confirm every finding
in it is either already reflected in the flow docs / known-gaps or is
genuinely spent, migrate anything still live, then delete it.

## 3. `QUERY-BUILDER-PROPOSAL.md` (repo root)

**Status:** OPEN — is this a live feature idea or a spent proposal?

A proposal for a query-builder. **To resolve:** decide whether it is a
real future feature (if so, move it to `docs/dev/` as a proposal and,
when built, back it with query-DSL cases + tests) or already
landed/abandoned (delete it).

## 4. `temp-ui-mockups/` (repo root)

**Status:** OPEN — keep as a visual reference, or delete as superseded?

Pre-build static HTML mockups. The real web UI now exists in `apps/web`,
and the design system lives as code in `apps/web/src/client/ui/`. The
mockups' own README frames them as a visual reference where "the spec
wins on conflict". Referenced only by one comment in
`apps/web/src/client/styles/tokens.css`. **To resolve:** keep them as a
cheap layout/vocabulary reference, or delete them (and fix that one
tokens.css comment).

---

*Created during the 2026-09-09 repo sweep, when the v1 build scaffolding
was cleaned up. These four items were the ones that needed a real
decision rather than a mechanical cleanup.*
