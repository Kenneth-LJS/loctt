# Upgrading and format versions

Upgrading LocTT is an ordinary package update:

```bash
npm install -g loctt
```

LocTT used to be published as `@loctt/cli` and `@loctt/mcp`. It is now
one package, `loctt`, that includes the CLI, the web UI (`loctt ui`) and
the MCP server (`loctt mcp`). If you installed the old packages, remove
them first, since `@loctt/cli` also provides a `loctt` command:

```bash
npm uninstall -g @loctt/cli @loctt/mcp
npm install -g loctt
```

If your MCP client config runs `npx -y @loctt/mcp`, change it to `loctt`
with the argument `mcp` (or `npx -y loctt mcp`). See the
[MCP reference](../mcp/reference.md).

Most upgrades need nothing more. Occasionally a new version changes the
on-disk format of `.loctt/`. When the change is safe to make on its own,
LocTT makes it the first time you use the tracker; when it is not, it asks
you to run `loctt migrate`.

## Format versions

Your tracker records the format it was written in, in
`.loctt/.schema-version`. The format version is the `loctt` release that
introduced that format: `0.1.0` is the first format, `0.3.0` the one where
every link keeps its order. A `loctt` release reads and writes the newest
format at or below its own version, so `loctt` 0.3.x writes `0.3.0`.

A tracker in a newer format than your `loctt` reads is refused on every
command, naming the release to install:

```
Error: This tracker needs loctt 0.4.0 or newer.
```

Update `loctt`; a newer format cannot be moved back.

### Trackers made before 0.3.0: edit `.schema-version` once

`loctt` 0.2.x and earlier wrote a plain number, `1`, in
`.loctt/.schema-version`. From 0.3.0 the file must hold a format version,
and `1` is refused with a message saying what the file must contain.
Change it once, by hand, to `0.1.0`:

```bash
printf '0.1.0\n' > .loctt/.schema-version
```

The next command then upgrades the tracker to `0.3.0` as described below.
Do the same on every machine and every clone of the tracker.

## Automatic upgrades

When your tracker is older than your `loctt` and every step of the upgrade
is safe, the first command that opens it upgrades it and then runs as
normal. That is any CLI command (except `init`, `migrate`, `doctor` and
`info`, which describe the tracker without changing it), the first MCP
tool call (except `init` and `migrate_schema`), or the first request the
web UI makes. It:

1. backs up your whole `.loctt/` to a sibling directory, named like
   `.loctt.backup-v0.1.0-<timestamp>-<id>/`;
2. runs the upgrade steps;
3. says so in one line:

```
Upgraded this tracker from 0.1.0 to 0.3.0 (backup: /path/to/.loctt.backup-v0.1.0-…).
```

The CLI prints the line on stderr, so `--format json` output stays clean.
MCP adds it after the tool's own result (and to the server's log). The web
UI shows it above the app until you dismiss it.

If two commands open the tracker at the same moment, it is upgraded once;
the other waits for it and carries on.

### The 0.1.0 → 0.3.0 upgrade

This upgrade gives every link a stored position (a rank), in the order the
tracker shows it today, so nothing moves: children, blockers and related
tasks list exactly as before. It also removes the `ranked:` lines from
`workflow.yaml`'s relationships, a setting that no longer does anything
because every kind of link is now ordered. Task files change only in their
`relationships`; `updated_at` and the task history are left alone.

## Upgrades that need `loctt migrate`

A step that could lose or reshape data in a way you should see first is
marked risky, and is never run automatically. Every command then refuses
and points you to:

```bash
loctt migrate
```

Preview first — this changes nothing on disk:

```bash
loctt migrate --dry-run
```

It prints your current version, the target version, and each step that
would run (a risky step is tagged). A real `loctt migrate` then prompts
before applying, unless you pass `--yes`. You can also run `loctt migrate`
yourself for a safe upgrade, to see the plan before it happens.

## The safety model

**An upgrade backs up your whole `.loctt/` before it changes anything**,
automatic or not. The backup is a complete copy in a sibling directory
next to your tracker, named like `.loctt.backup-v0.1.0-<timestamp>-<id>/`.
LocTT never deletes it; you remove it yourself once you've confirmed the
upgrade is good.

**Upgrades move forward only.** There is no down-migration command. If you
need to go back, restore that backup directory in place of `.loctt/` and
run the `loctt` you had before. That is the rollback.

**If an upgrade is interrupted** (a crash or a kill mid-run), the tracker
is left partly upgraded and marked in-progress
(`.loctt/.schema-migration-in-progress`, which names the backup), and every
command refuses to run rather than guess at a half-applied state. Recover
by restoring the backup directory over `.loctt/` and removing that file;
the next command then upgrades the clean copy again.

So the discipline is simple: **let it back up, keep that backup until
you're sure, and it is your undo.**

## Upgrades and a shared tracker

In [git-backed mode](git-sync.md), the format version travels on the sync
branch, and LocTT keeps the two sides from corrupting each other:

- If a **teammate on an older `loctt`** tries to sync a branch that a newer
  `loctt` already upgraded, the sync is **refused**, naming the release to
  install, and nothing is written.
- Upgrades happen on each machine, never through a sync. A branch whose
  `.schema-version` is not a format version is refused and nothing is
  written. For a branch holding the old `1`, change `.schema-version` on
  that branch to `0.1.0` and commit it, then sync again (publishing never
  writes that file on the branch). Links a sync brings in without a rank
  are ranked as it applies them, after the ranked links of their kind.
  From a branch whose `.schema-version` is older than `0.3.0`, every link
  it brings is ranked in the order that branch showed it.

The rule: **everyone on a shared tracker upgrades `loctt` on their own
machine** (editing `.schema-version` from `1` to `0.1.0` first when coming
from 0.2.x). The sync moves tasks, not format changes.
