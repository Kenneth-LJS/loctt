# Upgrading and schema migrations

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
on-disk format of `.loctt/`, and then it asks you to run a **migration**
before it will operate on your tracker.

## What a migration is

Your tracker records the format version it was written in (`.loctt/.schema-version`).
When a newer CLI expects a newer format than your tracker has, every
command except a few safe ones (`init`, `migrate`, `doctor`, `info`, and
launching the UI or MCP server) refuses to run and points you to:

```bash
loctt migrate
```

Preview first — this changes nothing on disk:

```bash
loctt migrate --dry-run
```

It prints your current version, the target version, and each step that
would run (a step that is risky or removes something is tagged). A real
`loctt migrate` then prompts before applying, unless you pass `--yes`.

## The safety model

**A migration backs up your whole `.loctt/` before it changes anything.**
The backup is a complete copy in a sibling directory next to your tracker,
named like `.loctt.backup-v1-<timestamp>-<id>/`. LocTT never deletes it —
you remove it yourself once you've confirmed the upgrade is good.

**Migrations move forward only.** There is no down-migration command. If
you need to go back — you upgraded, migrated, and want the old state — you
restore that backup directory in place of `.loctt/`. That is the rollback.

**If a migration is interrupted** (a crash or a kill mid-run), the tracker
is left partly migrated and marked in-progress, and every command refuses
to run rather than guess at a half-applied state. Recover by restoring the
backup directory over `.loctt/`, then run the migration again on the clean
copy. Because the backup is taken before the first step, it is always the
pre-migration state.

So the discipline is simple: **let it back up, keep that backup until you're
sure, and it is your undo.**

## Migrations and a shared tracker

In [git-backed mode](git-sync.md), the format version travels on the sync
branch, and LocTT keeps the two sides from corrupting each other:

- If a **teammate on an older CLI** tries to sync a branch that a newer CLI
  already migrated, the sync is **refused** — they're told to upgrade
  LocTT (not to migrate), and nothing is written.
- Schema alignment happens through `loctt migrate` on each machine, never
  automatically through a sync. A newer CLI pulling an older branch brings
  the content across but does not migrate it for you; run `loctt migrate`
  locally if it asks.

The rule: **everyone on a shared tracker upgrades LocTT and migrates on
their own machine.** The sync moves tasks, not schema changes.
