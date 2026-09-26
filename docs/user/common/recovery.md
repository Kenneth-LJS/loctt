# Recovery and health

What to do when something looks wrong: a task you can't find, a file you
edited by hand, a change you regret, or a warning from `loctt doctor`.

## Undoing a change

There is **no undo command.** A task's history (`loctt log <task>`, or the
Activity tab in the UI) is a record of what happened — you can read it, but
LocTT does not replay it to revert a change.

The real safety net is a backup. Take one before anything risky (a big
`restore`, a migration, deleting a project), and if a change goes wrong,
[`loctt restore`](../cli/reference.md#loctt-restore-file) brings the
tracker back:

```bash
loctt backup before-cleanup.jsonl     # take one first
# …something goes wrong…
loctt restore before-cleanup.jsonl --overwrite --dry-run   # preview
```

For a single task, prefer **archive over delete** — archiving is
reversible (`loctt unarchive`), deleting is not.

## Finding a task you can't see

- **Archived tasks** are hidden from lists by default. Pass
  `--archived archived` on the CLI (`loctt list --archived archived`), open
  **Settings → Archived** in the UI, or pass `archived: "archived"` from an
  agent.
- **A task whose key changed** (after a `move` or a prefix change) still
  answers to its old key — `loctt show OLD-KEY` works, because the old key
  is kept in the task's history.

## Editing files by hand

LocTT's data is just files, and reading or editing them directly is fine —
that's the point. Two edits need a follow-up:

- **Changing a task's `key`** (or its `key_history`) by hand leaves the
  key-lookup cache pointing at the old key. The task still reads and still
  lists; only lookup by the new key drifts. Fix it with:

  ```bash
  loctt doctor --rebuild-index
  ```

- **Setting a status, priority, or type to a value your workflow doesn't
  define** leaves the task readable but flagged as *workflow drift* by
  `doctor`. Set it back to a defined value (or add the value to
  `workflow.yaml`).

Everything else — the title, the body, assignee, dates, estimate — you can
edit in place and LocTT simply reads the new value.

## Corrupt data degrades, it doesn't crash

If a single field in a `task.md` becomes unreadable (a bad hand-edit,
another tool), LocTT keeps the task and sets the bad field aside rather than
failing. The task still shows up — marked with a `⚠` in `loctt list` and a
"Needs attention" note in `loctt show` — so you can see what to fix. A task
whose *identity* is unreadable (its `id` or `key`) can't be shown as a
normal row; the CLI names it on stderr so a missing task is never silent.

## `loctt doctor`

`loctt doctor` checks the whole tracker and reports what it finds:

```bash
loctt doctor
```

It verifies the directory structure and config files, looks for dangling
references (a task pointing at a deleted milestone, sprint, or label),
workflow drift, relationship cycles, an out-of-date key index, and
unreadable files.

- **Errors** (exit code 1) are the blocking problems — a missing or
  unparseable config file, a schema mismatch, an interrupted migration,
  workflow drift, or an unreadable file.
- **Warnings** (exit code 0) are recoverable — dangling references,
  cycles, a stale key index, a saved view whose query no longer parses.

Two repair options:

- **`loctt doctor --rebuild-index`** rebuilds the key-lookup cache — the
  fix for the hand-edited-key case above.
- **`loctt init --repair`** restores missing config files and directories
  from defaults without touching the ones that survive — for a tracker
  that lost, say, its `calendar.yaml`. Run `doctor --rebuild-index`
  afterward so existing keys aren't reissued.
