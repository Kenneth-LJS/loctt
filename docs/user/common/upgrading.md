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
on-disk format of `.loctt/`. LocTT never makes that change on its own:
every surface stops and tells you, and you upgrade the tracker when you
choose (`loctt migrate`, the **Upgrade** button in the web UI, or by
asking your agent to). A backup is made first.

## Format versions

Your tracker records the format it was written in, in
`.loctt/.schema-version`. The format version is the `loctt` release that
introduced that format: `0.1.0` is the first format, `0.3.0` the one where
every link keeps its order, `0.4.0` the one where sidebar settings use the
one Views section. A `loctt` release reads and writes the newest format at
or below its own version, so `loctt` 0.3.x writes `0.3.0` and 0.4.x writes
`0.4.0`.

A tracker in a newer format than your `loctt` reads is refused on every
command, naming the release to install:

```
Error: This tracker needs loctt 0.5.0 or newer.
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

Then upgrade it as described below (`loctt migrate`). Do the
same on every machine and every clone of the tracker.

## Upgrading a tracker

When your tracker is older than your `loctt`, every command, tool call and
web request refuses to run and changes nothing:

```
Error: This tracker needs upgrading from 0.3.0 to 0.4.0. Run `loctt migrate` (a backup is made first).
```

Upgrading is always your decision, on every surface. On a tracker shared
through git, whoever upgrades first moves everyone to the new format, so
it is worth agreeing when to do it.

`loctt doctor` and `loctt info` still run, and say the same thing
(`needs upgrading from 0.3.0 to 0.4.0`). Neither writes anything while an
upgrade is pending: doctor's repairs (`--fix`, `--rebuild-index`,
`--repair-relationships`) are skipped and say why.

### From the terminal: `loctt migrate`

```bash
loctt migrate
```

It shows what it will do, then asks:

```
This tracker needs upgrading from 0.1.0 to 0.4.0.

Steps:
  1. 0.1.0 → 0.3.0  Save the order of every task's links
     Each task's links keep the order they are shown in today, and that order is saved so you can rearrange them. …
  2. 0.3.0 → 0.4.0  Move sidebar settings to the Views layout
     Each person's sidebar settings are saved in the one Views section: …

Before any step runs, .loctt/ is copied to a backup beside it:
  /path/to/.loctt.backup-v0.1.0-<date and time>

Upgrade this tracker now? [y/N]
```

- `loctt migrate --dry-run` shows the same preview and changes nothing.
- `loctt migrate --yes` skips the question, for scripts. Without a
  terminal and without `--yes`, it refuses (exit 2) and names the flag.
- A step that could reshape data in a way you should look at first is
  tagged `[risky]` in the preview. It is upgraded the same way.

### In the web UI: the Upgrade button

`loctt ui` on an older tracker shows one screen and nothing else: the
versions, "A backup is made first.", the steps (under **What changes**),
and an **Upgrade** button. It backs up, upgrades and reloads the app. If
an upgrade stops part-way, the screen shows the backup to restore from.

### From an agent: MCP

Every tool returns the same message as the CLI. LocTT tells agents not to
call `migrate_schema` unless you asked them to upgrade the tracker, but to
tell you it needs upgrading and ask. When you agree, the agent previews
the plan (`migrate_schema` without `confirm`), shows it to you, and then
runs it (`confirm: true`). MCP `info` and `doctor` report the pending
upgrade without writing.

If two upgrades start at once (two terminals, or the web button and a
terminal), the tracker is upgraded once; the other says it is already
current, or that another process is upgrading it.

An older tracker runs every step between its format and the current one,
in order, in one upgrade and after one backup: a `0.1.0` tracker goes
through `0.3.0` to `0.4.0`.

### Restoring a backup taken at an older format

A backup records the format of the tracker it was taken from. Restoring
one taken at an older format (`loctt restore`, MCP `restore`, or
Settings → Backup & restore) upgrades the restored data as part of the
restore, with the same steps as `loctt migrate`. You don't run
`loctt migrate` afterwards, and your tracker's own format doesn't change.

The preview (`loctt restore <file> --dry-run`, MCP `restore` with
`dry_run`, or **Preview (dry run)** in the web UI) says so and lists the
steps with what each changes:

```
The restored data will be upgraded from format 0.1.0 to 0.4.0:
  1. 0.1.0 → 0.3.0  Save the order of every task's links
     …
  2. 0.3.0 → 0.4.0  Move sidebar settings to the Views layout
     …
```

The steps run on a copy of the backup's data, before anything is written
to your tracker, and see only what the backup carries: links are ordered
as the tracker that took the backup showed them, and your tracker's own
tasks are left alone. If a step fails, nothing is restored and your
tracker is exactly as it was. The backup file is never changed.

A backup from a newer format is refused, naming the release to install.
A backup written by `loctt` 0.2.x or earlier records its format as `1`.
Change `"schema_version":1` in its first line to
`"schema_version":"0.1.0"`, then restore it.

### The 0.1.0 → 0.3.0 upgrade

This upgrade gives every link a stored position (a rank), in the order the
tracker shows it today, so nothing moves: children, blockers and related
tasks list exactly as before. It also removes the `ranked:` lines from
`workflow.yaml`'s relationships, a setting that no longer does anything
because every kind of link is now ordered. Task files change only in their
`relationships`; `updated_at` and the task history are left alone.

### The 0.3.0 → 0.4.0 upgrade

This upgrade rewrites each person's sidebar settings
(`.loctt/users/<id>/settings.yaml`) for the one **Views** section, which
holds the built-in views (Assigned to me, Overdue, …) and your saved views
together, so the sidebar looks as it did:

- Views sits where the earlier of the old **Filters** and **Saved views**
  sections sat, and lists their views in the order they showed.
- What you hid stays hidden: a hidden section's views are each hidden, and
  Views itself is hidden only if both old sections were.
- Pinned views lead your saved views, in pin order. Pinned views are
  retired, so the pinned-views setting (`sidebar_pins`) is removed. A
  person who pinned views but never customized the sidebar gets a layout
  with the pinned views first.
- The List / Board / Timeline switcher keeps its place and is now called
  **Layouts** in Settings → Customize sidebar.
- Every other setting (theme, editor mode, card layout, …) is left as it
  is. A settings file with neither sidebar setting is not touched.

A settings file LocTT cannot read, or whose sidebar setting is damaged, is
left exactly as it is, and `loctt doctor` names it after the upgrade. The
settings files are per machine (they are not synced through git), so each
machine's upgrade converts its own.

After the upgrade LocTT reads only the new layout. An old-style sidebar
setting that turns up later (a hand edit, a restored copy) is ignored: the
sidebar shows the default layout and `loctt doctor` names the file. Reset
the layout (Settings → Customize sidebar → **Reset to default**, or
`loctt user sidebar-groups --reset`), or, if the tracker itself is older,
run `loctt migrate`.

## The safety model

**An upgrade backs up your whole `.loctt/` before it changes anything**,
from any surface. The backup is a complete copy in a sibling directory
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
by restoring the backup directory over `.loctt/` and removing that file,
then run `loctt migrate` again on the clean copy.

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
- Personal settings (`users/<id>/settings.yaml`) are never synced, so the
  `0.4.0` upgrade converts them on each machine when that machine
  upgrades.

The rule: **everyone on a shared tracker upgrades `loctt` on their own
machine** (editing `.schema-version` from `1` to `0.1.0` first when coming
from 0.2.x), and runs `loctt migrate` when the team agrees. The sync moves
tasks, not format changes.
