# Handover — Phase 5, as of 2026-08-30

Written because the session that produced this is running out of
context. **`TEMP-BUILD-PLAN.md`'s Status table is still the source of
truth**; this file is the "what you need in the first five minutes"
version.

## Where the run is

| | |
|---|---|
| Phase 5 | **M1 through its gate** (round 8). **All of M2 built.** |
| M2 gate | **Round 2: FAIL.** F5 and F7 fixed; **F6 is now ticket M2.6**. |
| **Next action** | **Build M2.6 (Duplicate), then re-gate M2 (round 3).** |
| Coverage | **454 / 937** |
| Suites | unit 2551 · integration 427 · e2e 21 · UI **332/332** |
| Branch | `main`, clean, 76 commits this session |

## The immediate next step

**M2.6 · Task detail — Duplicate**, in `TEMP-WEB-TICKETS.md`. One
case: **TSK-20**, a blocker that was declared in M2.1 and never built.

Core is ready — `duplicateTask` is exported, and both the CLI
(`apps/cli/src/commands/task-crud.ts`) and MCP call it. **Only the web
layer does not.** The ticket says what is owed and names the trap.

After it lands: **re-gate M2 (round 3)**, fresh agent, own worktree,
pinned SHA. Round 2's report is `docs/dev/gates/M2-round2.md`.

## What must not be lost

**Ken's rulings are in `decisions.md` § 9 (K1–K7)** and are *not*
revertible by an agent. § 8 (A7–A23) are agent-made, each with a
revert path, and the round-2 gate upheld all seventeen.

**The four stop conditions** are in `TEMP-RUN-WORKFLOW.md`. K7 is the
worked example of one firing correctly: a declared blocker found
unbuilt is scope, not a fix.

## Traps that cost hours, all recorded

- **A mutation that does not compile is not a mutation**, and one on a
  dead path is not either. Round 1's REL-20 mutation hit the wrong one
  of **two** `nosniff` sites in `server.ts` and survived.
- **`cases:coverage` cannot tell an untagged case from an unbuilt
  one.** That is how TSK-20 survived a whole milestone.
- **A test asserting the reader throws is not a test that a caller
  survives.** REL-49 was "covered" that way while the app violated
  every bullet and the suite sat green.
- **The UI suite flakes at ambient load** — a real-time antivirus runs
  at ~90% CPU scanning fixture files. *A different failing set each
  run is the signature.* Check `ps aux | sort -k3 -rn | head` first.
- **Leaked `loctt ui` servers are ours.** Put the `pkill` in the same
  command that starts the server; three ran 3–7 hours and cost real
  time.
- **Copy a gate report out of its worktree before removing it.** M2's
  round-1 report was lost that way and had to be reconstructed.

## The pattern worth carrying into M3

**Probe before building, starting in core.** Six capabilities were
found already built with no caller — `bodyToken`, `unarchiveView`,
`validateQuery`, `archiveView`, the whole `MarkdownEditor`, and
`duplicateTask`. Each would otherwise have been rebuilt from scratch
or reported as a missing feature.

Four "missing features" also dissolved on reading the case in full:
REL-40 (not a batch endpoint), the retracted `bulk_op_id` finding,
CMT-8's mention handling, and CMT-37's second bullet.

## Still open, and Ken's

- **F4 / coverage** — 25 M2 cases untagged. Three are known
  (CMT-18, CMT-10 b4, REL-33 b2); the rest are mostly mistagging
  between subsections, but *check each* rather than tagging: round 2
  proved four of six "untagged" cases had no test at all.
- **The macOS attachment case-aliasing defect** — `DELETE …/DROP.TXT`
  deletes `drop.txt` and logs a name that never existed. Recorded in
  `known-gaps.md`, unfixed: no case covers case-folding and the fix
  changes what the CLI and MCP accept.
