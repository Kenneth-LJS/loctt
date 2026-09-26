# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B32 · Zero lint warnings (K135) — **todo**

Fix all 65 warnings (hook dependencies, non-null assertions) without
changing behaviour.

## B34 · Release blockers (K136) — **in progress**

- **RR-B4:** every published package installs and runs on its own:
  `loctt ui` from `@loctt/cli` serves the UI; `@loctt/web` declares the
  libraries it loads (yaml, ulid, proper-lockfile, sharp); CLI and MCP
  get `prepublishOnly`; a test packs each package, installs it outside
  the monorepo and runs it. The `@loctt/mcp` shape waits on Ken.
- **RR-B1:** a manifest check (license, version, bins, declared deps
  cover the bundle) as a case + test.
- **RR-B2:** fix SECURITY.md's dead README anchor; security posture
  (incl. Host guard and CSP, A206/A207) as a case + test.
- **DR-A1:** the image lightbox traps focus, blocks the page behind it,
  and opens from the keyboard; the K71 trap test actually presses Tab.
- **DR-A2:** the bulk-bar pickers use `ui/Menu` (arrow keys, Escape,
  initial focus).

## B35 · Fast-follows that now gate release (K136, light pass) — **in progress**

- **DR-A3:** loading regions are announced; a case + `@verifies` test on
  `LoadingState`.
- **RR-H1:** a light corruption-coverage pass against the corruption
  guide; fix what it finds.
- **RR-H2:** record Ken's "git sync is stable" ruling (§ 9) and close
  the item.
- **RR-H3:** CONTRIBUTING, CODE_OF_CONDUCT, issue templates; CHANGELOG
  brought up to date.
- Correct the stale content in `release-readiness.md` and
  `design-review.md` (B4 "DONE", H3 "not started", A1 heading, retired
  DR-C1, superseded B4/B5/B6 notes, C2 px counts) and K71's old path.

