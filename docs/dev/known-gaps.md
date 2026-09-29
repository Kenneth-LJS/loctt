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

(G1–G7, found by the B42 runthrough, were fixed by B44.)

(G8, unranked links from a git sync, was fixed by B46: sync ranks them as
it applies the branch, K151. G9, the git specs' sync waits sitting on
Playwright's 5 s default, was fixed by `SYNC_SETTLE_MS` in
`tests/ui/fixtures/git-tracker.ts`, A365.)

## G11 · A 0.3.0 backup is refused by 0.4.0, though nothing in it changed

Found by B54 (K160). Restore refuses any backup taken at an older format
(`backup/restore.ts`, an agent-made call: the migration framework works on
a `.loctt/` directory, not a backup file). The 0.3.0 → 0.4.0 step rewrites
only `users/*/settings.yaml`, which a backup never carries (Q22), so a
0.3.0 backup's contents are already valid 0.4.0 data, yet
`loctt restore` says to restore it with the release that took it and
upgrade from there. The message also still says "open the tracker with
this loctt to upgrade it", which K154 made untrue (upgrading is
`loctt migrate`).

Reproduce: with `loctt` 0.4.0, `loctt backup` a tracker, change the first
line's `"schema_version":"0.4.0"` to `"0.3.0"`, then
`loctt restore <file>` into an empty tracker: refused, "this backup was
taken at format 0.3.0 and this loctt reads format 0.4.0".

Needs Ken: whether restore may accept a backup whose format differs only
by steps that change nothing a backup carries (each step would declare
it), or keep refusing every older backup.

## G12 · An unparseable `settings.yaml` stops that user's settings loading

`loadUserSettings` degrades a wrong-typed key but throws when the file is
not YAML at all, so every settings read for that user fails (web settings
panels, CLI `loctt user settings`/`sidebar-groups`, MCP
`get_user_settings`). Since B54, `loctt doctor` names the file
(`collectUnreadableSettings`) and the 0.3.0 → 0.4.0 step leaves it as it
is, but loading still does not degrade to `{}`.

Reproduce: write `theme: [dark` to `.loctt/users/<id>/settings.yaml`, then
`loctt user sidebar-groups`: a YAML parse error.
