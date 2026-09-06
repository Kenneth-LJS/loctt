# Phase Z — correctness findings: `packages/core/src/task/`

Read-only review of `core/task` (~6.7k LOC). Each finding below cleared the
concrete-repro bar: a specific input → wrong output, reproduced against the
current source, plus the analysis of why the existing suite misses it.

Summary: **1 blocker, 1 major, 0 minor.**

---

## 1. (blocker) `moveTaskToProject` / `bulkMoveTasksToProject` silently drop a health-only field, bypassing the write guard

**File:** `packages/core/src/task/move.ts:93-102` (`performMove`), written to disk
at `move.ts:147` (`moveTaskToProject`) and `move.ts:207`
(`bulkMoveTasksToProject`).

**The code path.** `performMove` rebuilds the moved task as:

```ts
const updated: Task = {
  frontmatter: { ...source.frontmatter, project, key, key_history, updated_at: now },
  body: source.body,
};   // <- source.health is NOT carried
```

`source` comes from `lookupTask`, i.e. the tolerant `readTask`, so a field-local
corruption (an unrecognised top-level key, or a wrong-typed known field) has been
lifted off `frontmatter` into `source.health`. Because `updated` omits `health`,
`assembleTaskFile` (which re-emits degraded/unrecognised fields *from* `health`)
has nothing to re-emit, and the raw value is gone.

This is exactly the silent-loss the write guard's rule 2 exists to catch —
except both write calls invoke `writeTask(locttDir, id, task)` with **no
`touched` argument**, so it defaults to `ALL_FIELDS_TOUCHED` (`io.ts:160`,
sentinel `["*"]`). `assertWriteSafe` treats `*` as "universal / whole-record
author" and skips rule 2 entirely (`io.ts:101,126`). A move is a
preserve-others edit — it touches only `project`/`key`/`key_history`/`updated_at`
— but it is written as if it owned the whole record, so the guard waves the
drop through.

**Concrete failing scenario (reproduced).** Seed a hand-edited task in the
default project carrying an unrecognised key:

```
---
id: 01MOVE...001
key: TASK-999
title: T
project: <p0>
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
status: todo
jira_id: ABC-1
---
Body.
```

`readTask` lifts `jira_id` into `health` (verified: the health entry is
present). Then:

```ts
const alt = await createProject(locttDir, { name: "Alt", prefix: "ALT-" });
await moveTaskToProject({ locttDir, taskRef: "01MOVE...001", targetProjectId: alt.id });
```

On-disk result — `jira_id: ABC-1` is gone:

```
---
id: 01MOVE...001
key: ALT-1
title: T
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-09-06T...Z
project: <alt>
status: todo
key_history:
  - TASK-999
---
Body.
```

The same holds for a wrong-typed known field (e.g. `due_date: 42`) and for the
bulk form `bulkMoveTasksToProject`, which shares `performMove` and the same
untouched `writeTask` call. Move is exposed on all three surfaces
(`apps/cli/src/commands/task-crud.ts`, `apps/mcp/src/tools/task-crud.ts`,
`apps/web/src/server/server.ts`), so this is a live user path.

**Why P-5/P-7 make this a blocker.** A referenced-elsewhere key
(`jira_id`, a plugin field) vanishes with no warning and no history entry —
"leniency means keeping, never destroying" (P-11), and the corruption proposal's
own preserve-others guarantee (§ 13.1 B1) is defeated on this path. The write
guard was built to make this class impossible; here it is inert because the
caller mislabels the write as whole-record.

**Why the tests miss it.**
- `move.test.ts` has **zero** health/corrupt-task cases (`grep -c health` → 0):
  every fixture is a clean `createTask` task, which has no `health`, so dropping
  `health` is invisible.
- `corruption-audit.test.ts` — the file that *does* assert preserve-others across
  writes — enumerates `setField`, `unsetField`, `bulkSetFields`, `bulkArchive`,
  `archive`/`unarchive`, `linkTask`/`unlinkTask`, and the guard directly, but
  **never `moveTaskToProject`**. The audit matrix simply has no move column, so
  the one operation that writes with a universal `touched` and hand-rebuilds the
  frontmatter is the one operation not checked for preservation.
- The `assembleTaskFile` doc comment claims the compiler "flags every one of the
  six writers that would otherwise assemble `{frontmatter, body}` without
  `health`". It does not: `health` is optional on `Task`, so
  `{ frontmatter, body }` type-checks and `performMove` compiles clean.

**Suggested fix direction (not applied):** carry `source.health` onto `updated`
in `performMove`, and pass an explicit `touched` set
(`{project, key, key_history, updated_at}`) to both `writeTask` calls so rule 2
is actually enforced on this path.

---

## 2. (major) `setFields` / `bulkSetFields` cannot unset a health-only field that `unsetField` can — parity break

**File:** `packages/core/src/task/update.ts:869-882` (`setFieldsLocked`, custom-field
branch) vs `update.ts:611-657` (`unsetFieldLocked`, which has a dedicated
health-only branch at :634).

**The divergence.** `unsetFieldLocked` special-cases a field whose value lives
only in `health` (an unrecognised top-level key, or a wrong-typed non-builtin) —
`update.ts:634`:

```ts
} else if (healthForField.length > 0 && !(field in (task.frontmatter.fields ?? {}))) {
  // Health-only field... dropping the health entry below is the removal.
```

`setFieldsLocked` has **no such branch**. An unset (`value === undefined`) of a
non-builtin, non-auto-managed field falls straight into the custom-field `else`
(`update.ts:869`), which reads `existingFields = task.frontmatter.fields ?? {}`
and throws when the field is not there (`update.ts:872-873`):

```ts
if (!(field in existingFields)) {
  throw new TaskUpdateError(`custom field "${field}" is not set`);
}
```

But a health-only field is by definition **not** in `frontmatter.fields` (it was
lifted off `frontmatter` at parse time), so it always throws — even though the
raw value is right there and `unsetField` removes it happily.

**Concrete failing scenario (reproduced).** Task with an unrecognised top-level
key `jira_id: ABC-1`:

```ts
// This succeeds — jira_id removed, health cleared:
await unsetField(locttDir, ID, "jira_id");

// This throws TaskUpdateError: custom field "jira_id" is not set
await setFields({ locttDir, taskId: ID, changes: [{ field: "jira_id", value: undefined }] });
```

Ran both against current source: the first passes, the second throws at
`update.ts:873`. `bulkSetFields` delegates to `setFieldsLocked`
(`bulk.ts:101`), so the same unset fails in bulk and is reported per-task in
`failed[]`. (Note: a *wrong-typed known builtin* like `due_date: 42` unsets fine
via `setFields`, because builtins take the `delete patch[field]` branch at
`update.ts:846` — only the health-only/non-builtin case diverges.)

**Why it matters.** CLAUDE.md and the code's own doc comment
(`assertUnsettable`, `assertChangesWritable`) make "the single-task and bulk/
multi paths must not drift on what may be written" an explicit invariant — the
comment at `update.ts:770-779` even lists three past drifts this sharing was
meant to end. This is a fourth: a repair a user can do one field at a time
(`loctt unset T-1 jira_id`) fails the moment it is part of a multi-field or bulk
edit, with a misleading "not set" message about a field that *is* present (in
health). It is a functionality/consistency defect, not silent data loss, hence
major rather than blocker.

**Why the tests miss it.**
- `corruption-audit.test.ts` covers `unsetField` of a health-only unrecognised
  key (`:190`, "unset an unrecognised top-level key removes it") and of a
  wrong-typed known field (`:199`), but its bulk section
  (`:257-275`) only exercises `bulkSetFields(status)` and `bulkArchive` —
  **never a bulk/multi *unset* of a health-only field**. So the one path the
  divergence lives on is untested.
- `update.test.ts` and `bulk.test.ts` contain no `value: undefined` unset of an
  unrecognised/health-only field (`grep` → none). Every `setFields` unset case
  targets a real `fields:` custom field or a builtin, both of which happen to
  work.

**Suggested fix direction (not applied):** give `setFieldsLocked` the same
health-only branch `unsetFieldLocked` has — when `value === undefined`, the
field is not in `frontmatter.fields`, and `task.health` has an entry for it,
treat it as a removal (the entry is already dropped by the `carryHealth` loop at
`update.ts:927-929`) rather than throwing.

---

## Also checked, no finding survived the bar

- **Write guard (`assertWriteSafe`, `io.ts`).** Rule 1 / rule 2 logic, the
  `declaredSet` exemption, the on-disk `before` re-read, and the `*` universal
  exemption are internally sound. The only way to defeat rule 2 is to pass the
  universal `touched` on a preserve-others write — which is precisely finding #1;
  the guard itself is correct, the *caller* mislabels the write.
- **`carryHealth` / `carryRelHealth` / `bulkArchive` health carry.** All three
  correctly drop only the written field's entries and preserve the rest;
  `serializeFrontmatter`'s re-emit + override-on-direct-write round-trips
  verified against the audit fixtures.
- **`parseFrontmatter` object-fatal vs field-local split** (`FATAL_IDENTITY_FIELDS`
  = `{id,key}`, degradable required = `{title,created_at,updated_at}`): matches
  the audit's HANDLED/DEFECT matrix; no misclassification found.
- **`computeProgress` / `milestoneProgressDetailed`** (K28 aggregate half):
  discarded excluded from `total`, unknown status counts toward `total` not
  `done`, unreadable tasks reported at tracker level rather than folded into a
  denominator — all correct per the doc contract.
- **`loadAllTasksDetailed` ordering:** `tasks` preserves input order via
  `mapWithLimit`; `unreadable` is in completion order, but nothing downstream
  depends on unreadable ordering, so not a correctness defect.
- **`resolveEntityRef` name→id resolution** on both `setField` and
  `setFieldsLocked` paths (the MSL-C1 reopening the comment warns about):
  present and symmetric on both.
