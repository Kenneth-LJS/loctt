# Corruption-handling framework — brief for the Phase 7 proposal

> Ken's framing, 2026-09-04. This is the **input to a Fable-agent
> proposal**, not the framework itself. The order is: spike one cell →
> Fable reviews the spike and proposes the framework below → Ken
> approves → the audit runs against the approved framework. Do not
> start the audit before the framework is approved — the audit measures
> against it.

The north star (principles 5–7) states the *values*. This framework is
the *system* that makes them concrete and repeatable, so broken-field
handling is not re-invented per object and per surface.

## What the proposal must define

### 1. A taxonomy of corruption kinds

Comprehensive, not ad hoc. Ken's starting set — the proposal extends it:

- **Internal** — a field exists but is the wrong format / type.
- **Missing** — a field is absent. Split further: a **critical** field
  missing (may make the object unusable) vs an **optional** field
  simply unspecified (normal, not corruption).
- **Extra** — an unrecognised field. Still rendered, but as a
  read-only string of its contents.
- **External** — a reference to something outside this object (e.g. a
  relationship to another ticket) where the target does not exist, or
  is itself corrupt in the fields this object needs from it.
- **…** — the proposal must argue the set is complete, or say what it
  deliberately excludes.

### 2. Behaviour per corruption kind × per surface

For each kind, what CLI, MCP and UI each do. And the **repair surface**:

- Setting *over* a broken field (validated write overrides — north star
  principle 7).
- **Removing** a broken field — is there an "X"? Can you remove a
  broken *relationship*? Which corruption kinds are removable vs
  fixable-only?

### 3. Extractable, repeatable logic

An abstraction so broken-field load/save is written once, not copied
into every object's read/write path. The proposal identifies what that
abstraction is and where it lives (core, per strict parity).

### 4. Field-level "meta" in the UI

A per-field state, driven by the classification:

- An **unrecognised** field → shown as string, with an "X" to remove it.
- A **recognised but wrong-typed** field → shown as string, but its "X"
  reverts it to the proper field entry mode (not a removal).
- The proposal defines this as a small per-field state machine and how
  it maps from the core classification.

### 5. Severity — object-fatal vs field-local  [Ken confirmed]

Not all corruption is equal. A corrupt **id** (or whatever a given
operation needs to address the object) may make the whole object
unusable — read-only, or unaddressable. A corrupt `due_date` is one bad
field and everything else works. The framework classifies each
corruption as **object-fatal** (whole object degrades) vs **field-local**
(only that field degrades). This is the general form of Ken's subtask
example: the list reorders including the invalid subtask, but the
invalid one cannot be opened or edited.

### 6. Cross-surface consistency  [Ken confirmed]

The classification lives in **core**, computed once — not
re-implemented per surface. A field the UI shows as corrupt-and-editable
is the same field CLI/MCP report as corrupt. Otherwise the three
surfaces disagree about what is broken. (North star principle 3.)

## Open questions the proposal must answer (Ken left these to it)

- **Detection — when is corruption found?** Lazily at read/load, a
  `doctor`-style scan, both, or something else. The proposal decides
  and justifies.
- **Repair provenance — is a repair recorded?** When a user sets over
  or removes a corrupt field, does that appear in history/activity as a
  distinct event, as an ordinary edit, or not at all. The proposal
  decides and justifies, consistent with "never silently change data".

## Method

1. **Spike one cell** end to end: one object × one corruption kind,
   core → CLI/MCP → UI, including the repair surface. Suggested first
   cell: `bulkSetFields` on a task with a wrong-typed `due_date`,
   setting `status` — it exercises preserve-others, override-on-direct-
   write, and the UI field-meta, across all three surfaces.
2. **Fable agent reviews the spike** and proposes the framework above.
3. **Ken approves** the framework.
4. **The audit** then classifies every CRUD op × every corruption kind
   against the approved framework: each cell handled / defect /
   unspecified, with fixes flowing from it.

## Reconcile against shipped code

Principles 5–7 were written 2026-09-04, after code shipped this session
(PRU partial-remap, bulk results, BAK restore). The spike and audit
must check whether shipped behaviour matches the framework, and record
any gap as a `known-gaps.md` entry rather than assuming alignment.
