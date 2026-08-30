# Visual nested query builder — proposal

**Status:** awaiting Ken's approval. Nothing built.
**Ruling that prompted it:** "visual nested builder. should have intuitive ui"

## What exists already (measured, not assumed)

- **Core's DSL is complete.** `AND`, `OR`, `NOT`, parenthesised nesting.
  Verified against a real tracker:
  `(labels = X and labels = Y) or labels = Z` returned exactly `XY` and
  `Zonly`, correctly excluding `Xonly` and `None`. **No core work needed.**
- **`validateQuery` is built and unwired** (`packages/core/src/query/validate.ts:162`).
  It walks and/or/not/comparison. The builder is its missing caller.
- **The server already AND-combines** a raw `query` param with chips
  (`server.ts:743`, `buildStructuredQuery`).
- **Today's chips are OR within a field** (`field in (a,b)`) and AND
  across fields. Deliberate and documented at `server.ts:715`.

## What MSL-7 actually requires

Not AND. It requires: *"The combining semantics (AND vs OR) are visible
in the chip UI, not left to guesswork."* Today's defect is that OR is
**invisible**, not that it is OR. The builder satisfies this by
construction — the operator is on screen.

## The hard constraint: P2 — the URL is the view

Any view reachable by clicking must be reachable by pasting a URL, with
back/forward working. A nested expression must round-trip.

**Proposed:** serialize to the DSL text itself in the existing `q` param.
No new URL format, no second source of truth, and `q` already round-trips
(LST-42 covers quotes and escapes). The builder is a *view over `q`*, not
a parallel state.

Consequence to accept: a user can type DSL that the builder must render.
Anything `parser.ts` accepts, the builder must display or degrade
honestly (see Open question 1).

## Composition with existing chips (LST-40)

LST-40 requires chips and `q` to intersect, both in the URL, chips
removable without destroying `q`. Two coherent readings:

- **(a) Builder replaces the chip bar.** One surface, one mental model.
  Cost: LST-40/41 rewritten; the two-clicks-to-filter case gets slower.
- **(b) Builder is an "Advanced" affordance beside the chips.** Chips stay
  for the common case. Cost: two constraint sources, which is exactly the
  confusion LST-40 exists to police.

**Recommendation: (b)**, because the common case is one or two chips and
making that harder to serve a rarer case is a bad trade. But it needs
your ruling — it changes what "intuitive" means here.

## Shape of the UI

Rows of conditions, each `[field] [operator] [value]`, grouped in boxes.
Each group has one operator (All / Any) applied to its members. Groups
nest. `(X and Y) or Z` renders as:

    ┌ Any of ────────────────┐
    │ ┌ All of ───────────┐  │
    │ │ Label is X        │  │
    │ │ Label is Y        │  │
    │ └───────────────────┘  │
    │ Label is Z             │
    └────────────────────────┘

Rationale: All/Any beats AND/OR in the user's vocabulary (P3), and the
box makes precedence visual rather than something to reason about.

## Scope

**In:** the builder; wiring `validateQuery`; live result count; the DSL
text visible and editable; parse errors with position (LST-44/45 want
this and currently get a generic 500).

**Out (say if you disagree):** `NOT` in v1 — the DSL has it, but
negation with nesting is where these UIs get confusing; saved views
storing builder state separately from `q`.

## Open questions — I need these answered before building

1. **DSL the builder can't render.** If a user types something exotic,
   does the builder (a) refuse to open, showing the text box only,
   (b) render best-effort and warn, or (c) offer to rewrite it?
   **My recommendation: (a)** — honest, and never silently changes a
   query a user wrote. But it is the least "intuitive" of the three.
2. **Chips: replace or coexist?** See above. Recommendation: coexist.
3. **Which milestone?** This is a week-scale component with its own
   cases. It does not belong inside a bug fix. Recommendation: its own
   ticket after M4, as ruled for CSV export.

## Cost

Roughly a week: the recursive component, URL round-trip, `validateQuery`
wiring, error surfacing, plus new cases in `flow-list.md` and amendments
to MSL-7 and LST-40. The nesting is what makes it a week rather than a
day — flat conditions would be ~2 days.

## Honest note

You asked for the nested builder over the two cheaper options. Worth
stating plainly: the *reported bug* — "clicking a second label widens the
results" — is fixed by a per-field All/Any toggle in about a day. The
builder is a larger, genuinely more capable feature that also happens to
fix it. If the aim was to fix the bug, the toggle is the proportionate
change; if the aim is the capability, the builder is right. I have built
neither pending your answer.
