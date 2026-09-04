# LocTT — North Star

> Written from Ken's stated answers, 2026-09-04. Ken owns this file;
> an agent proposes changes, it does not rewrite it.

## Vision

LocTT is a task tracker that is online and moves across devices with you
as you develop.

The alternatives charge a tax LocTT does not:

- Free tools that move across devices are limited; the ones without
  limits cost money.
- Online trackers require setup — API keys for MCP, auth, and other
  overhead — which is overkill for a one-weekend job that could still
  benefit from a task tracker.

LocTT moves with your project, scales for more members on a team, and
scales to more projects.

Reducing friction is a driver, in more forms than the ones named above.

As a bonus: because tasks are plain files, it is easy to write scripts
to port them to a mature solution later. For smaller or beginner
projects this can be a frictionless way to start being productive.

### Design target

The solo or small-team developer on a small-to-medium project.

The three surfaces sit over one core:

- **CLI** — power users.
- **MCP** — AI-assisted development.
- **UI** — people who still write tasks by hand and need something
  simple.

AI-assistance is supported as one surface, not a core requirement.

### Hard boundary

Not SaaS, not cloud. No hosted backend, no accounts, no billing, no
server that holds the user's data.

"Moves across devices" is git. If the user has a git remote, LocTT
publishes/syncs through it; if not, living in local git is good enough.
LocTT smooths over the git mechanics — the user thinks "sync", not
push/pull/merge — but never runs a server of its own.

## Operating principles

Consistent with `invariants.md` (hard constraints) and `decisions.md`
(precedent).

1. **Never lose or silently corrupt data.** The one unforgivable
   failure — chosen by Ken as the thing that would make LocTT broken
   even if everything else worked.

2. **Predictable over clever.** Default to predictable behaviour. There
   is no standing licence for an agent to choose a "smart" behaviour; if
   one seems to exist, it is case-by-case and goes to Ken.
   (Precedent: K19.)

3. **Core is the product; strict parity.** A capability lives in `core`
   and the CLI, MCP and UI all expose it, or it is not done. A
   capability on one surface only is drift to fix.

   Exception: some capabilities are surface-specific. UI-only: the
   cropper and profile pictures (K18). CLI-only (maybe also MCP, not
   UI): `--json` output. Parity binds everything else.

4. **Safe defaults, power-user overrides.** Safe by default;
   a `--force`/flag lets a user who knows what they are doing skip the
   guardrail. (Precedent: K15, K17.)

5. **Files are a canonical, hand-editable store; the tools are the
   supported path.** You can hand-edit and LocTT tries its best to
   recover, with no guarantee.

   - If recovery is not possible, warn the user.
   - If some data is invalid, render what is supported (CRUD for the
     supported parts) and mark the unsupported parts read-only, rather
     than failing the whole view. Ken's example: subtasks under a task
     where one is invalid — the list can be reordered including the
     invalid one, but the invalid one cannot be opened or edited.

6. **Partial actions over a set.** The dividing line is not
   reversible-vs-destructive. It is: **are these items expected to move
   together, or are they independent?**

   - **Independent items** → partial success is fine. Do what you can,
     and report the ones you could not do and why. Every bulk operation
     that exists today is independent — `bulkSetFields`, `bulkArchive`
     / unarchive, `bulkLink`, and `bulkDelete`
     (`packages/core/src/task/bulk.ts`). One task failing is no reason
     to block the others, delete included.
   - **All-or-nothing items** → if one or two cannot be done, the rest
     must not move either. **None exist today.** The test to apply to
     any future multi-item action: *would we expect these to be updated
     together?* If yes, refuse the whole set on any failure.

7. **Missing vs corrupted, per item.** These are different failures.

   - **Missing** (the task file is gone): report it as unsuccessful,
     with the reason — but still finish the items that succeeded. A
     missing member does not block the batch.
   - **Corrupted** (the file exists; some fields are bad, but the
     fields *relevant to this operation* are intact — e.g. the id):
     **do the operation if it is still safe.** "Safe" means the
     operation can touch what it needs without interpreting or
     rewriting the corrupted parts.
     - bulkSetFields on a corrupted task: **set the target field**
       (even if it was absent), and **leave every other field exactly
       as it was on disk** — expected, unexpected, or wrong-typed,
       byte-preserved. The operation must never make corruption worse,
       and a field LocTT does not understand survives untouched. Only
       the field being set changes.
     - But if the thing the operation needs is *structurally* broken —
       e.g. `relationships` is an object where an array is expected and
       the operation is a link — **stop and warn.** Do not attempt the
       modification.

     This serves principle 1 (never lose or silently corrupt data):
     preserve what you cannot safely change rather than rewrite it.

   **This generalizes to every edit, on every object — not just bulk,
   not just tasks.** An edit touches only the fields it targets and
   leaves the rest exactly as they were on disk. So on an object with a
   good `status` and a corrupted `due_date`, setting `status` writes
   `status` and does not touch `due_date`. But a *validated incoming
   write to the corrupted field itself* overrides it — set `due_date`
   from the CLI or MCP with a value that passes validation, and the
   corrupt one is replaced. Corruption is not sticky; it is only never
   *silently* rewritten by an operation aimed elsewhere.

   In the UI, a corrupted field is shown as corrupted, with a
   stringified view of its raw value, and the user may edit it to
   replace. (Per-field degradation — the object-level form of
   principle 5.)

8. **Support solo and multiple users.**

## How decisions escalate

Ken controls when the PM is in play. The chain:

1. **Default: an implementing agent brings issues to Ken.** Product and
   UX decisions surface to Ken during implementation.

2. **When there are too many, the agent may ask Ken to consult the PM.**
   This is a request Ken approves — the PM is not a first responder
   agents route to on their own.

3. **Once Ken approves, the PM makes the obvious / smaller decisions**
   and returns to Ken when it **cannot decide** — in particular when a
   decision is **unclear or load-bearing**.

4. **Or Ken pre-authorises at the start** — "the PM can make the call on
   the smaller decisions" — which activates the PM without a mid-stream
   request.

A PM decision that is made is recorded in `decisions.md` § 8 with a
revert path, citing the principle applied. Anything unclear,
load-bearing, that sets a new principle, that changes a default
governing destructiveness or storage, that requires rewording a case, or
that touches the vision, goes to Ken.
