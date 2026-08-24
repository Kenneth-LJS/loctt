# Known gaps

Defects and documentation holes that are real, understood, and not yet
fixed. Each says what is wrong and where the fix belongs, so it can be
picked up without rediscovering it.

This file is not a backlog for features — that is
[`TEMP-WEB-TICKETS.md`](../../TEMP-WEB-TICKETS.md) — and not a place for
things that merely might be wrong. Delete an entry when it is fixed.

## Code

### ERR-11 / ERR-12 have a client half that is not built

The server side is done: `FsAccessError` names permission and disk-full
failures, and the web API returns them as `io_failed` with a
`not_saved` claim and a retry control.

What remains is client-side and needs the body editor: both cases require
the user's typed content to **stay in the editor** when a save fails, so
they can copy it out. Nothing may clear the buffer on failure.

**They are not both M2.** The spec tags **ERR-12 as M2** (blocker, disk
full) and **ERR-11 as M4** (major, read-only or wrong-ownership
`.loctt/`). An earlier version of this entry said both landed with M2.3;
that contradicted the flow doc, which is the specification. ERR-12 lands
with M2.3; ERR-11 lands in M4.

Cases: ERR-11, ERR-12 in
[`ui-test-cases/flow-error-handling.md`](ui-test-cases/flow-error-handling.md).

## Tests

### The integration suite is flaky under parallel load

**Observed 2026-08-17.** A full `npm run test:integration` reported
5 failures across `git/with-remote.test.ts` and
`mcp/list-truncation.test.ts`. Both files passed in isolation, and **four**
consecutive full runs afterwards were green (392/392 each) — so the failures are
contention, not a defect in the code under test.

Both files do real subprocess work: `with-remote` runs git against a
bare remote, `list-truncation` spawns the MCP server over stdio.

**The cause is not established.** This entry originally blamed vitest's
5-second default, which is wrong: the integration runner has carried a
15-second timeout since the harness was written
(`tests/vitest.integration.config.ts:8`). So either those runs genuinely
exceeded 15s under load, or the failures were not timeouts at all. The
failure output was not captured at the time, so nobody knows which.

The same *shape* was hit and fixed once in `apps/web`, whose two
git-error tests passed alone and timed out inside the full web run; they
now carry explicit 30s timeouts. That may or may not be the same
problem.

**Why this matters more than an ordinary flake:** a timeout renders as
`FAIL` in the summary line, indistinguishable from a real regression.
Anyone running the suite after a change will read it as their fault.
**Attempted reproduction, 2026-08-17: could not.** Three consecutive
full runs, then a fourth with four CPU-saturating processes running
alongside. All four were 419/419 with zero failures. Combined with the
four green runs recorded at the time of the original observation, that
is eight clean runs against one bad one.

**No fix has been applied**, and none should be until the cause is
known — raising a timeout that may not be the problem would just hide
whatever is. Capture the failure output on the next occurrence; one
real failure message settles it.

**The practical risk today is misreading, not breakage.** A timeout
renders as `FAIL` identically to a regression, so someone will think
they broke something. That is the reason this entry stays.

**Before believing an integration failure: re-run the named file alone.**

## `rekeyCollisions` skip path — reachable, correct, low value to change

Investigated 2026-08-17 after the GIT-C2 fixture fix, because I had
claimed the sort produced wrong behaviour on real syncs. **It does not.**

**Two things I got wrong, corrected here so nobody re-derives them:**

- `state.yaml` **is** mirrored by sync. `NEVER_MIRROR` holds only
  `local/` and `.git`. I had extended the invariant about
  `.loctt/local/` to `state.yaml`, which is not what it says. Counters
  therefore propagate, and a synced task's project normally has one.
- Two tasks in **different** projects cannot collide. Prefixes are
  unique per project (`ProjectsConfigSchema.superRefine`), so `T1` and
  `M1` are different strings. Only same-project tasks collide, and they
  share a counter, so both sides are rekeyable.

**Verified against two real clones:** both created `T1` offline → sync →
one became `T2`. Two projects independently created with the same
prefix `X`, both tasks `X1` → sync → one became `X21`. Both resolved,
`unresolvedKeys` empty.

**The skip path is reachable, but only by hand-editing the branch** to
add a task whose `project` exists nowhere. When it fires it behaves as
GIT-C2 specifies: stderr warning naming task and reason, `unresolvedKeys`
populated, non-zero exit, and `doctor` reporting the dangling project.

**The one real wrinkle, left alone deliberately.** When the unrekeyable
task sorts *second* (later `created_at`), the collision stays
unresolved — two tasks keep the same key. Sorting rekeyability first
would always resolve it, but that contradicts GIT-C2's stated rule
("the task with the earlier `created_at` keeps the key"), and the input
only arises from a hand-edited branch, which P-12 already classes as
unsupported. Not worth a spec change on that evidence.
