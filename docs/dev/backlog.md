# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B20 · Apply the message audit (K123, K126, K127, K129, K130) — **todo**

Ken approved the audited wordings (*"rest of the 'needs your call'
looks okay"*, then *"be sure to implement everything, including the
messages"*). Source of truth: the before/after tables in the session
scratchpad (`app-message-trim-A.md`, `-B.md`, `-C.md`,
`error-text-trim.md` § "Settings rows to re-edit under K129"),
published as "App messages: proposed trims".

- Web client messages (batches A and B), with K129's patterns applied
  everywhere: delete confirms say "Deleting is irreversible.
  Continue?" with no archive suggestion; empty states "No {things}
  found."; save failures "{Thing} not saved."; no sentence repeating
  what the screen shows; plain button labels; "Restart it to
  continue."
- Shared core messages (batch C): change once in core, so CLI, MCP and
  web agree; update every test that pins a string.
- C110: the 8 schema-failure messages name their file ("{file} is not
  valid: {field} {problem}.").
- C112: `SwapRollbackError` says the next command retries the undo.
- K130 wordings: A-102 network-folder banner, B-57 "File size limit is
  50 MB.", A-100 archived-user lines removed.
- `ui/ErrorState.tsx` unknown-outcome copy → K127's wording.
- Amend every case that pins old wording (BLK-11, TSK-22, TSK-23 for
  the archive alternative, and the rest found while applying).

## B21 · Saved-view names must be unique (K129) — **todo**

*"if you save a view, and the name already matches, then we should
just error. 'Another view with that name already exists.' do not allow
merging, do not allow keeping."* Enforced in core so CLI and MCP refuse
too; renaming to a taken name is refused; views that already share a
name keep loading. Replaces `list/viewNameCollision.ts`'s warn-and-keep
path. Cases, CLI and MCP reference docs updated.

## B22 · Setup proceeds silently over an empty `.loctt` folder (K129) — **todo**

*"just ignore, proceed with steps. dont even show this to the user,
dont show the messages, dont show warning, dont even stop with this
extra confirmation step."* The init wizard's empty-folder message and
confirmation step are removed; setup fills the folder in.

## B23 · Sprints: no process policing (K130, P11) — **todo**

- Remove the Sprints board's active-but-out-of-dates hint (SPR-20).
- Remove the sprint state-transition guard and its `force` override in
  core, CLI (`--force`) and MCP (`force`); state moves freely.
- Keep refusing end date before start date, with a plain message.
- Amend SPR-20 and every case or doc that describes the guard; CLI and
  MCP reference docs updated.
