# Known gaps

Defects that are real, understood, and not yet fixed. Each says what is
wrong, how to reproduce it, and what (if anything) Ken has to decide
before it can be built.

**Check here before reporting a defect as new.** Delete an entry the
moment it is fixed. Nothing here is "deferred" (K117): an item stays
open until it is fixed or Ken rules on it. Fixed and accepted items live
in `decisions.md` and git history, not here. Process lessons live in
`docs/dev/process/build-loop.md`.

---

### Schema-failure messages missing the file name (5 sites remain; 3 fixed under B20)

`formatZodIssues(prefix, err)` (`packages/core/src/config/zod-error.ts`)
renders a field path plus a plain-English cause, but names the file
only through its `prefix` argument, and only when an issue has no
field path (an empty-object or wrong-type-at-the-root failure). B20
wrapped the three sites with a fixed, statically-known filename in the
same `` `${file} is not valid: ...` `` template their 9 config-loader
siblings already use: `state/reconcile.ts:25` (`reconcile.yaml`),
`state/sync.ts:29` (`sync.yaml`), `projects/prefix.ts:76`
(`prefix-rename.yaml`).

**Still open — 5 sites**, all in files that parse a specific entity's
own file (a user, or a task) rather than one fixed config path, so the
identifying filename isn't known inside the parse function itself —
fixing these means threading the file path (or user/task id) into
`parseUserProfile`/frontmatter's parse functions from their callers,
which is a signature change, not a wording trim:
`users/profile.ts:96`, `users/profile.ts:158`, `users/profile.ts:170`,
`task/frontmatter.ts:249`, `task/frontmatter.ts:268`.

**Repro.** Hand-edit a user's `profile.yaml` (or a task's frontmatter)
into an object-fatal shape (e.g. delete the `id` field entirely) and
trigger a read. The thrown `UserProfileError`/`TaskParseError`'s
message never names which user or task file is broken — contrast with
`sync.yaml`, which now opens with `sync.yaml is not valid: ...` after
this fix. Graded lower severity than the three fixed sites because both
files already carry per-field tolerant-degrade paths (a corrupt single
field degrades into `health` rather than going object-fatal in the
common case), so this defect only bites the object-fatal branches —
but those branches exist precisely for the more severe corruption
cases, which is exactly when naming the file matters most.

**What Ken needs to decide.** Whether it's worth threading an
identifying path/id parameter through `parseUserProfile` and the
frontmatter parse functions (and updating every caller) to close the
remaining 5 sites, or whether the callers should catch and re-wrap with
the id they already have in scope (cheaper, no signature change to the
parse functions themselves).

### Dead validation branches in `task/update.ts` assume a reachable non-string `updated_at`

`setFieldLocked` (`update.ts:~498`) and `setFieldsLocked`'s per-change
loop (`update.ts:~945`) each throw `"updated_at must be a string"` (now
worded `` `${field} must be a string` `` after the K129 pass's
mechanical trim was NOT applied here, since this is dead code, not a
wording site) if `updated_at` is set to a non-string. Tracing both
public entry points shows this can never fire: `setField` intercepts
`opts.field === "updated_at"` and throws `UPDATED_AT_REFUSAL` before
ever reaching `setFieldLocked`; `setFields`/`bulkSetFields` both call
`assertChangesWritable`, which throws `UPDATED_AT_REFUSAL` for any
change naming `updated_at` before `setFieldsLocked`'s loop sees it.

**What Ken needs to decide.** Whether to delete these two branches, or
convert them to an internal assertion (`throw new Error("unreachable:
...")`) matching the pattern `git/publish-sync.ts`'s "unreachable
through findMigrationPath" guard uses elsewhere. Left as-is for now —
harmless (never fires) but could mislead a future reader into thinking
it is reachable, user-facing validation.
