# Milestones and labels

Milestone CRUD and progress, label CRUD and assignment.

Gaps only. See [README.md](README.md) for conventions.

---

### MSL-C1 · blocker · P9 · CLI MCP
**Milestone progress exists and its denominator is honest.** Nothing named
`progress`, `computeProgress`, or `referenceCount` exists anywhere in
`packages` or `apps` — grep returns zero hits. Ten cases in
`../ui-test-cases/flow-milestones-labels.md` are unbacked, including the
rule that discarded tasks are excluded from the denominator.

- A milestone reports completed and total counts on every surface that
  shows it.
- Tasks whose status category is `discarded` are excluded from the
  denominator, per the shared core helper.
- Archived tasks are handled deliberately — included or excluded by a
  stated rule, not by accident.
- The denominator equals the number of tasks actually referencing the
  milestone; a filtered view never reports a total larger than its own
  result set (P9).
- The CLI, MCP, and web report the same numbers for the same milestone.

**Given** a milestone with 4 tasks, one of them `discarded`, **when**
progress is read on each surface, **then** all three report the same
completed/total pair with the discarded task excluded from the total.

### MSL-C2 · major · P10 · CLI MCP
**Label and milestone archive round-trips on every surface.** Labels have
no web archive route and `editLabel` will not accept an `archived`
parameter; milestones are reachable only through a divergent
`PUT {archived}` rather than a dedicated route. Users already have proper
archive/unarchive routes in the same file, so the pattern exists and was
not applied.

- Archiving then unarchiving a label round-trips the flag on CLI, MCP, and
  web.
- The same holds for milestones, through a route shaped like the others.
- Archiving blocks *new* references while tolerating existing ones — the
  stated archived-guard policy.
- A label archived while still assigned to tasks leaves those assignments
  intact and visible, with the label marked archived (P7).

**Given** a label assigned to two tasks, **when** it is archived, **then**
both tasks keep the assignment, the label is marked archived, and assigning
it to a third task is refused.

### MSL-C3 · minor · P10 · CLI
**Documented invocations for labels, milestones, and sprints actually
run.** `docs/dev/reference/schema-reference.md:446-540` and
`docs/user/cli/reference.md:186-293` are stale key-era spec: they document
`key`/`--label` where the code has `id`/`--name`, so every worked example
in them fails or silently misbehaves.

- Each example in the reference's Labels, Milestones, and Sprints sections
  executes without a usage error.
- `--name` is the flag that renames; if `--label` is retained it is an
  accepted alias, not silently dropped.
- `loctt label create X --label "Y"` does not produce a label named `X`
  with `Y` discarded.
- The docs and `--help` agree on `<name|id>` versus `<key>`.

**Given** the worked example
`loctt label create blocker --label "Blocker" --color "#cc0000"`, **when**
it is run against a fresh tracker, **then** it either fails loudly naming
the unknown flag or creates a label displayed as `Blocker` — never a label
named `blocker` with the flag ignored.
