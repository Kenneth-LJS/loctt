# 🚦 Milestone 2 gate — round 3

Verdict: **FAIL**
Date: 2026-08-30
Tree: pinned `4f5eedbbf89656c10d6c7304e71d662815026a85`, own worktree at
`.claude/gate-m2r3`, pre-built. **Clean at start and at finish** —
`git status --porcelain` empty both times. No commits, no stashes, no
edits to the main tree. Every mutation restored and the restore
verified.

Worktree identity asserted before trusting any suite result, per the
brief:

```
$ grep -c TASK_DUPLICATE_RE apps/web/src/server/server.ts   → 2
$ grep -c "TSK-20" tests/ui/flow-tasks.spec.ts              → 5
```

**One thing to know about the tree.** At the end of the run `git
rev-parse HEAD` read `43655da`, not the pinned `4f5eedb`. I did not
commit. Another tree advanced the branch and this detached worktree
followed. Checked before trusting anything measured:

```
$ git diff --stat 4f5eedb HEAD
 TEMP-BUILD-PLAN.md | 8 ++++----
 1 file changed, 4 insertions(+), 4 deletions(-)

$ git diff --name-only 4f5eedb HEAD | grep -vE '\.md$' | wc -l   → 0
```

Docs only — the M2.4a/4b/5a/6 SHA backfill — **zero code files
touched**, and both control greps still return 2 and 5 at `HEAD`. Every
measurement in this report stands. Flagged because a gate that silently
moves off its pin is exactly the failure the brief warns about, and the
next round should pin with `git checkout <sha>` rather than relying on
the worktree staying put.

## Findings: 2 blockers, 3 non-blocking. No vacuous tests found.

Round 2's F5 and F7 both have commits against them. **F7 is closed.
F5 is fixed on two of three surfaces and still broken on the one the
case is actually written about** — the web client. That is B1 below,
and it is the same fix landing one layer short for the second round
running.

---

# BLOCKERS

## B1 · REL-49 · An unreadable attachments directory still shows "No attachments on this task yet" in the browser

**The case** (`docs/dev/ui-test-cases/flow-relationships.md:486`,
severity **major**, P4 P6) — all three bullets:

> - The Attachments section shows an error naming the directory and the reason.
> - Relationships, comments, activity, and the meta panel still render.
> - A retry action is offered.

**What the code does.** Round 2's F5 fix (`61da050`) is real and
correct as far as it goes. `buildShowModel` no longer rejects the whole
model on an attachments failure; it returns `attachmentsError`
alongside it, and **the CLI and MCP both render it**. The web *server*
serialises it too. The web **client discards it.**

`AttachmentsPanel` accepts exactly two props:

```
apps/web/src/client/attachments/AttachmentsPanel.tsx:56-61
export function AttachmentsPanel({
  taskRef,
  attachments,
}: {
  readonly taskRef: string;
  readonly attachments: readonly AttachmentResponse[];
}): React.JSX.Element {
```

so when the directory is unreadable and `attachments` is `[]`, it
renders its empty state (line 180-183): **"No attachments on this task
yet."**

### The measurement

Real tracker, real `loctt ui` server, one task carrying one attachment.

**1 — the field reaches the wire and stops there.** `grep` for the
symbol across the client, with a positive control proving the same grep
form finds a sibling field that *is* threaded through:

```
$ grep -rn "attachmentsError" apps/web/src/client/
(no output)

$ grep -rn "lossyConstructs" packages/contracts/src/ apps/web/src/client/
packages/contracts/src/service.ts:167:  readonly lossyConstructs: ...
apps/web/src/client/task/TaskDetail.tsx:509:  lossyConstructs={task.data.lossyConstructs}
apps/web/src/client/editor/BodyEditor.tsx:30: ...
```

`lossyConstructs` was added to the response the same way and *is* read
by the client. `attachmentsError` reaches `packages/contracts/src/service.ts:157`
and is never consumed. It typechecks because it is optional.

**2 — the server is correct.** With `chmod 000` on the attachments dir:

```
BASELINE (readable):
  attachments: [{"name":"drop.txt","size":6,"mime":"text/plain"}]
  attachmentsError: undefined

chmod 000:
  HTTP 200
  attachments: []
  attachmentsError: "EACCES: permission denied, scandir '…/attachments'"
```

Task still 200, error named with the full path. Bullet 2 satisfied,
and the data for bullet 1 is present.

**3 — the CLI is correct** (the third surface, and proof the fix was
plumbed everywhere except the browser):

```
$ loctt show GATE1
GATE1: Attachment host
Status: backlog
Attachments: could not be read — EACCES: permission denied, scandir '…/attachments'
```

**4 — the browser is not.** Same server, same unreadable directory,
page text read out of a real Chromium session:

```
ATTACHMENTS

No attachments on this task yet.

Drag files here, or Upload. Up to 50 MB per file.

ACTIVITY
📎 ATTACHMENT  ken attached drop.txt  9:12 AM
```

The app contradicts itself on one screen: the Attachments section
claims the task has none, and the activity feed three lines below says
a file was attached. This is the exact silent lie core's own comment
says omitting the field would cause —

```
apps/web/src/server/server.ts:2669-2671
// REL-49: an unreadable directory degrades this section, not the
// task. Omitting it would let the client render "no attachments"
// over a directory that may be full.
```

— and the client omits it anyway.

Permissions restored afterwards and the restore verified
(`attachments: [{"name":"drop.txt",…}] err: undefined`).

### Why no test caught it — and would not catch a fix either

REL-49 now carries **four** `@verifies` tags. All four are in
`packages/core/src/task/show.test.ts` (lines 188, 219, 309, 352). The
two new ones (`61da050`) are good tests — the degradation assertion is
paired with a positive so it cannot pass by reporting a failure every
time. But they assert on **`buildShowModel`'s return value**, and
REL-49 is a statement about what a *page* renders.

No test at any layer above core exercises this:

```
$ grep -rn "chmod" tests/ui/*.spec.ts
tests/ui/flow-attachments.spec.ts:665:  // The server refuses. Intercepted rather than chmod'd: …
```

(positive control: `chmod` is used in `packages/core/src/config/unreadable-config.test.ts`
and two other core test files, so the grep form works.)

This is round 2's own F5 lesson — "'the section degrades' is the
assertion; 'the reader throws' is not" — applied to the code and not to
the tag. `cases:coverage` reports REL-49 covered. It is not.

**Fix direction** (not applied): pass `attachmentsError` from
`TaskDetail.tsx:554` into `AttachmentsPanel`, render it in place of the
empty state with the path, the reason, and a Retry. Then move at least
one REL-49 tag onto a UI spec that `chmod`s the directory.

---

## B2 · K2 · The body-write precondition exists only in the web app; the CLI and MCP still clobber silently

**The requirement** is Ken's ruling **K2** (`docs/dev/decisions.md:841`),
not an agent decision, and the M2.3 ticket restates it as an explicit
deliverable (`TEMP-WEB-TICKETS.md:359`):

> - **CLI and MCP get the same guard**, per the layer rule: a
>   precondition only the web app honours protects nothing, because
>   the other two writers are the ones it is protecting against

K2's own text gives the reason: autosave "silently overwrites a
concurrent CLI or MCP edit every 1.5 idle seconds, unattended, which is
exactly what **P1** forbids."

**What the code does.** The web half is built and works. The other two
surfaces have no precondition at all.

```
$ grep -rn "bodyToken\|expectedToken" apps packages tests tools \
    | grep -v node_modules | grep -v '/dist/' | grep -v '\.test\.' \
    | awk -F: '{print $1}' | sort | uniq -c | sort -rn
   9 apps/web/src/server/server.ts
   5 packages/core/src/task/io.ts
   3 packages/contracts/src/service.ts
   3 apps/web/src/client/editor/BodyEditor.tsx
   1 tests/ui/flow-task-body.spec.ts
   1 packages/core/src/index.ts
   1 apps/web/src/client/task/TaskDetail.tsx
```

Zero in `apps/cli/src`, zero in `apps/mcp/src`. Positive control that
this grep form finds CLI/MCP callers of a core symbol:

```
$ grep -rn "duplicateTask" apps/cli/src apps/mcp/src
apps/cli/src/commands/task-crud.ts:10:  duplicateTask,
apps/cli/src/commands/task-crud.ts:402:    const task = await duplicateTask({
apps/mcp/src/tools/task-crud.ts:22:  duplicateTask,
```

Corroborated at both surfaces' own interfaces:

```
$ loctt body --help
Error: unknown option --help. Accepted: --set, --append.
```

```
apps/mcp/src/tools/task-body.ts:28-38
name: "replace_task_body",
inputSchema: { ref: z.string(), body: z.string() },
handler: async ({ locttDir }, args) => {
  const task = await lookupTask(locttDir, args["ref"] as string);
  await writeTaskBody(locttDir, task.frontmatter.id, (args["body"] as string) + "\n");
```

No token parameter, and `writeTaskBody` is called with no options
object — so `BodyWriteOptions.expectedToken` is never passed.

### The measurement — a web edit destroyed, end to end

**Direction 1, web write against a CLI change — correctly refused:**

```
token=a45e6fd24f059ee0
$ loctt body GATE4 --set "CLI WROTE THIS"
POST /api/tasks/GATE4/body  {expectedToken: <stale>}
  → HTTP 409 conflict
    "GATE4 changed since you read it — your text has NOT been saved."
$ loctt show GATE4  →  CLI WROTE THIS
```

The web half honours P1 completely. This is the part that was built.

**Direction 2, CLI write against a web change — silently clobbers:**

```
web write   POST /api/tasks/GATE5/body  "IMPORTANT WEB EDIT"  → HTTP 200
$ loctt body GATE5 --set "CLI CLOBBER"
Updated body for GATE5            ← exit 0, no warning, no conflict

$ sed -n '/^---$/,$p' .loctt/tasks/01M183RYE8YQB0XQXK9Y9V2Z2W/task.md | tail -1
CLI CLOBBER

$ grep -rn "IMPORTANT WEB EDIT" .loctt/ | wc -l   → 0
$ grep -rn "CLI CLOBBER" .loctt/ | wc -l          → 2   (positive control)
```

The web edit is gone from the tracker — not in `task.md`, not in
history, nowhere. The negative grep is paired with a positive so the
zero means "absent", not "grep failed".

**Why this is a blocker and not a gap.** The guard's entire stated
purpose is protection *against the other two writers*. A precondition
only the protected-from party lacks is not a partial feature; it is
inverted. K2 is Ken's ruling and it names this exact deliverable.

**Note on XS-11.** XS-11 is a blocker case and is tagged three times
(`tests/ui/flow-task-body.spec.ts:344`,
`apps/web/src/server/server.body-precondition.test.ts:67`,
`apps/web/src/client/editor/useBodyAutosave.test.ts:205`) — all three on
the web path. The tags are honest about what they test; nothing claims
CLI/MCP coverage. The gap is in the build, not in a false tag.

---

# NON-BLOCKING FINDINGS

## N1 · `cases:coverage` silently drops every ID after the first in a space-separated `@verifies` tag

The scanner's regex requires **commas**:

```
tools/coverage/scan.ts:27
const VERIFIES = /@verifies\s+([A-Z][A-Z0-9]*-C?\d+(?:\s*,\s*[A-Z][A-Z0-9]*-C?\d+)*)/g;
```

Run against the two real tags in the tree:

```
"@verifies CMT-5 CMT-35"   => captured: "CMT-5"
"@verifies CMT-9 CMT-8"    => captured: "CMT-9"
"@verifies CMT-5, CMT-35"  => captured: "CMT-5, CMT-35"   (control)
```

Both occurrences, repo-wide:

```
apps/web/src/client/comments/editors.test.ts:29:   /** @verifies CMT-5 CMT-35 */
apps/web/src/client/comments/renderMarkdown.test.tsx:94: /** @verifies CMT-9 CMT-8 */
```

**CMT-9/CMT-8 is harmless** — both are tagged elsewhere. **CMT-35 is
not**: that tag is its only one, so a **major** case with a real test
standing behind it is reported as untagged. The test at
`editors.test.ts:29` genuinely asserts CMT-35's requirement (it
distinguishes a self-edit's bare marker from `"Edited by Sam"`).

So the honest untagged count for M2 is **23, not 24**, and the tool
fails silently rather than warning — a malformed tag looks identical to
no tag.

Two fixes, both cheap: accept whitespace separators in the regex, or
warn when an `@verifies` line contains a case ID the capture dropped.

## N2 · REL-33's second bullet is unimplemented, and it is not in `known-gaps.md`

REL-33 (minor, P1) bullet 2: "A drag attempt against a stale page is
refused with a message that the kind is no longer ranked."

`reorderRelationship` (`packages/core/src/rank/reorder.ts:56`) never
consults the relationship kind's `ranked` flag. Its guard chain checks
only that the link and both anchors exist; every `ranked` occurrence in
that file (lines 207-364) is a local variable, not the config field. So
a rerank on a kind switched to `ranked: false` is accepted and writes a
rank.

The M2.5a run-log row states this ("`reorderRelationship` never reads
`ranked`, and a rerank on a kind switched to `ranked: false` answers
200 and writes a rank"), so it was **found and reported honestly**. But
`TEMP-BUILD-PLAN.md` is working state that is deleted when the build
lands, and `CLAUDE.md` requires a defect found-but-not-fixed to go in
`known-gaps.md`. It is not there:

```
$ grep -n "REL-33\|reorderRelationship" docs/dev/known-gaps.md
(no output)
```

Non-blocking because the case is minor and its other two bullets are
covered and tested. Worth a `known-gaps.md` entry before the plan file
is deleted, or the finding dies with it.

*(By contrast the M2.5b attachment case-folding defect **is** properly
recorded — `docs/dev/known-gaps.md:1153`. I initially missed it with a
too-narrow grep and correct myself here.)*

## N3 · CMT-10's timing margin is one second, and it is the suite's only red

Detailed under **Suites** below. In short: `refocus()` waits 31s
against a `staleTime` of 30s, so the mechanism the test depends on has
a 1-second margin on a machine with documented background load. It
failed once in the full suite and passed three times in isolation.

Non-blocking — the test is *substantively* one of M2's better ones (it
is the repaired version of a previously-vacuous test and asserts the
stored bytes before the rendered chip). The defect is in the margin,
not the assertion. But a 1s margin will keep producing one-off reds
that are indistinguishable from a real regression, which is a slow tax
on every future gate.

---

# VACUOUS TESTS

**None found in M2's own tests.**

This is a real and reportable result rather than an absence of effort,
and it is the second group after M1.4's BLK to come out clean. The
static sweeps for all four shapes from
`docs/dev/gates/M1-vacuity-sweep.md`:

| Shape | Sweep | Result in M2 |
|---|---|---|
| 3 · absence assertions that weaken as the app says less | scripted brace-matched scan of every `test(` block in the eight M2 spec files, flagging any whose expectations are *all* `.not.` / `toHaveCount(0)` | **0 hits** |
| 2 · the label asserted, not the effect | `/x\|/`-style empty-alternative matchers | 1 hit, `flow-list.spec.ts:5203` — **M1's known SHL-8**, already recorded, not M2 |
| 1 · something else does the work | `page.reload()` counts per M2 spec file (2/0/5/3/1/4/5/2) | all reviewed; in M2 the reloads are persistence checks that assert the far end *off disk*, which is the opposite of the XS-1 shape |
| 4 · seeding that cannot discriminate | read of the M2.6 and CMT-10 fixtures | fixtures discriminate — see below |

The two tests I read line-by-line as the highest-risk candidates both
turned out to be strong, and specifically defended against the shapes
that caught M1:

- **TSK-20** (`tests/ui/flow-tasks.spec.ts:306`) — the brief's named
  trap is "a test asserting 'a new task appeared' passes whether or not
  the copy is correct." This test does not fall into it. It reads both
  files off disk, pairs the `key_history` absence with a positive
  assertion that the copy carries the new key (so an unreadable file
  cannot satisfy the absence), asserts the source is **byte-identical**
  to a pre-capture, and defeats the substring trap explicitly —
  `"Duplicable task"` has count 2 and `"Duplicable task (copy)"` count
  1, because the former is a substring of the latter.

- **CMT-10** (`tests/ui/flow-comments.spec.ts:821`) — was vacuous in an
  earlier round via `page.reload()`, and the repair is genuine. It now
  asserts the stored bytes are unchanged *first* (so an implementation
  that rewrote comment bodies on rename would fail), then drives a real
  hidden→visible transition instead of a reload. The comment list is
  never refetched, so the chip's new text can only come from re-resolving
  the stored id.

I did **not** run a full mutation sweep of M2's 334 UI tests — see
"What I did not check".

---

# SUITES

Run strictly one at a time, never concurrently. Exit code captured
immediately, never inferred from grepping output.

| Command | Exit | Count |
|---|---|---|
| `npm run typecheck` | **0** | — |
| `npm run lint` | **0** | 20-byte log, real completion, no OOM |
| `npm run test` | **0** | **2557** (147 + 1605 + 82 + 61 + 643 + 19) |
| `npm run test:integration` | **0** | **427** |
| `npm run test:e2e` | **0** | **21** |
| `npx playwright test --workers=1` | **1** → flake | **333 passed, 1 failed** of 334 |
| `npm run cases:coverage --require <172 M2 cases>` | **1** | 24 untagged (23 real — see N1) |
| `npm run cases:check` | **0** | 937 cases, index up to date |

Unit matches the M2.6 run-log's stated 2557 exactly. Integration is
427 against round 2's 426: +1, consistent with M2.6's duplicate route.

## The one UI failure is the known ambient flake — but it has a specific, fixable cause

`flow-comments.spec.ts:821 › CMT-10` failed at 37.9s on
`expect(page.getByTestId("mention-chip")).toHaveText("@Ana Ruiz")`,
having resolved the locator six times and seen `"@Ana Lopez"` each
time — i.e. **the refetch never fired**, rather than the chip rendering
something wrong.

**Three isolated re-runs, all green** (35.1s, 36.3s, 36.4s), on an
unchanged tree. Four passes against one failure ⇒ recorded as the
documented ambient flake, not a finding.

**But it is not arbitrary flake, and this is worth fixing.** The
test's helper hardcodes a wait one second longer than the constant it
is racing:

```
tests/ui/flow-comments.spec.ts:203-204
async function refocus(page: Page): Promise<void> {
  await page.waitForTimeout(31_000);
```

```
apps/web/src/client/api/queryClient.ts:129
        staleTime: 30_000,
```

A **1-second margin**. The helper's own comment says "waits out the 30s
staleness window — the wait is the mechanism", so the fragility is
structural: under the machine's documented background load, 31s of
wall-clock is not reliably 31s of timer progress, the query is still
fresh, `refetchOnWindowFocus` no-ops, and the chip never updates. That
is exactly the observed failure.

Note also that `queryClient.ts` exports `STALENESS_WINDOW_MS = 60_000`
— a *different* constant from the `staleTime: 30_000` this test
actually races. A reader checking the margin against the exported
constant would conclude the test waits 31s against 60s and is simply
broken; it is not, but the two-constant arrangement makes the real
margin easy to misread.

**Fix direction** (not applied): import `staleTime` as a named constant
and wait `staleTime + a real margin`, or drive the clock forward rather
than sleeping against it. A 1s margin on a 30s timer will keep
producing one-off reds indistinguishable from a regression.

---

# WHAT I CHECKED AND FOUND CORRECT

Recorded so round 4 does not re-verify these.

- **F5's core and server halves — genuinely fixed.** `buildShowModel`
  no longer rejects the model on an attachments failure; the comment
  explaining why relationships still reject (a task whose own links
  cannot resolve has no honest page) is sound. Server returns 200 with
  the error named and the full path. The CLI renders it correctly. Only
  the browser is wrong (B1).
- **F7 — closed.** Commit `7878aa0`.
- **CMT-37 — holds.** A corrupt `_history.yaml` returns a named
  `io_failed` with the full path *and* the YAML parse position
  ("Flow sequence in block collection must be sufficiently indented …
  at line 2, column 1"), while `GET /api/tasks/GATE1` stays **200**. The
  section degrades alone. Restored and re-verified 200 afterwards.
- **K2's web half — holds completely.** 409 with `data_state:
  not_saved`, the user's text preserved, the other writer's content
  intact on disk. Measured, not read. (Its absence on CLI/MCP is B2.)
- **XS-10** (major, untagged) — the *behaviour* is implemented.
  `useSetField.ts` snapshots, applies optimistically, rolls back in
  `onError`, and invalidates in `onSettled` (lines 120-140), so the
  settled value comes from the server. No `Date.now()`/`new Date()` on
  the path, so the footer's `updated_at` cannot come from the browser
  clock. This is a **tagging gap, not a build gap** — worth recording,
  because round 1 got exactly this distinction wrong in the other
  direction.
- **A24** (the `(copy)` suffix) — read in full. Correctly reasoned, the
  premise is verified against `duplicateTask`'s actual source rather
  than inherited from the ticket brief (which was wrong), and it has a
  one-argument revert path. Settled; not relitigated.
- **M2.5b's attachment case-folding defect** — properly recorded at
  `docs/dev/known-gaps.md:1153`.
- **CMT-10's repair from vacuous is genuine**, verified by reading and
  by three isolated runs. It asserts `after == before` on the stored
  comment bytes *before* looking at the chip, so an implementation that
  rewrote comment bodies on rename would fail regardless of what
  renders. The reload that made it vacuous is gone.
- **Six of seven suites green**, exit codes captured directly:
  typecheck 0, lint 0, unit 0 (2557), integration 0 (427), e2e 0 (21),
  `cases:check` 0 (937, index current). UI 333/334 with the one red
  resolved as flake by four-to-one.
- **No leaked processes.** `pgrep -fc 'dist/index.js ui'` → 0 after
  teardown; `git status --porcelain` → 0 lines at start and finish.

---

# WHAT I DID NOT CHECK, AND WHY

A truthful partial gate.

- **A full mutation sweep of M2's 334 UI tests was not run.** The
  brief's own rules make each mutation expensive: a full `npm run build`
  (not the client-only web build), confirmation the change reached
  `apps/cli/dist/index.js`, a suite run, then a restore and a control
  run. The UI suite alone is ~15 min. I chose depth on two structural
  findings plus scripted static sweeps for all four vacuity shapes over
  a handful of individually-mutated tests. **The "0 vacuous" result
  above is therefore weaker evidence than M1's BLK sweep**, which
  mutated all 56. It is "no vacuity found by four targeted static
  sweeps and two close readings", not "56 of 56 went red".
- **The 23 genuinely-untagged M2 cases were not individually probed.**
  I probed XS-10 (major) and confirmed the behaviour exists, and
  resolved CMT-35 via N1. The remaining 21 I did not classify — round 2
  probed four of them (TSK-20/21/43/51) and TSK-20 has since been built
  under M2.6. Whether the other 21 are built-but-untagged or genuinely
  absent is **unestablished**, and round 2's own classification of them
  rested on the same weak evidence (absence of a reference in `tests/`).
- **MCP's exposure to B1 and B2 is a code reading, not an observation.**
  I read `apps/mcp/src/tools/task-body.ts` and
  `apps/mcp/src/tools/task-crud.ts:91-97` but did not drive the MCP
  server over stdio.
- **Scroll position on Back: not measured.** The same limit as rounds 1
  and 2, for the same verified reason — the panes have
  `scrollHeight == clientHeight`, so any scroll assertion would be
  satisfied by the environment rather than the app (the SHL-26
  archetype). I made none rather than make a vacuous one.
- **One anomaly I could not reproduce and am therefore not filing.**
  Early on, `GET /api/tasks/GATE2` returned **404** while the same
  server's `/api/tasks` list returned that key and `GET
  /api/tasks/<its-ULID>` returned 200. It cleared on server restart. My
  first hypothesis — a stale key index for tasks created after boot —
  was **wrong**: a task created after boot resolved 200 immediately.
  Three further create+`body --set`+fetch cycles all returned 200. Per
  the brief's stop-after-two rule I stopped and record it as
  unreproduced rather than as a finding. Flagged only so round 4
  recognises it if it recurs.
