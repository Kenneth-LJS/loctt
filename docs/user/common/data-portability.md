# Your data, and getting it out

LocTT's promise is that your tasks are yours. This page is the proof: what
the files are, how to read them without LocTT, and how to take a complete,
faithful copy with you.

## A task is a plain text file

Every task is one file: `.loctt/tasks/<id>/task.md`, in the most ordinary
format there is — YAML frontmatter for the metadata, a markdown body for
the description:

```markdown
---
key: WEB-1
title: Fix login crash
status: in_progress
priority: high
---
Steps to reproduce…
```

There is no database, no proprietary encoding, and no binary blob. Stored
values are plain strings (a status is the config key `in_progress`, not an
opaque id). You can `cat` a task, `grep` across all of them, open one in
any editor, or read them from a script — with or without LocTT installed.

The rest of `.loctt/` is the same: `config/*.yaml` for your workflow and
saved views, `state.yaml` for key allocation, `_comments.yaml` and
`_history.yaml` beside each task. All YAML, all readable.

> If LocTT development ever stopped, nothing about your tracker would
> break. It is a folder of markdown and YAML on your disk. You would keep
> reading, grepping, and editing it exactly as before — the tool is a
> convenience over the files, not a gate in front of them.

## A complete, faithful copy

For a full snapshot you can restore from — not just read — use a backup:

```bash
loctt backup tracker-backup.jsonl
```

A backup is a JSONL file (one JSON record per line, starting with a
header). It captures the whole tracker:

- every task's `task.md`, comments, and history;
- attachments and user avatars (inlined);
- all of `config/`, the users, and `state.yaml` (the key counters).

Restoring it reproduces your tasks, bodies, comments, history,
attachments, relationships, and past keys faithfully. See
[`loctt backup` / `loctt restore`](../cli/reference.md#backup-and-restore)
for the modes and flags.

### What a backup deliberately leaves out

A few things are **machine-local** and are not part of a backup, by design:

- per-user display settings and your "recently viewed" list;
- the sync configuration for *this* machine;
- derived caches (the key-lookup index, which is rebuilt on restore).

These describe *this* machine's use of the tracker, not the tracker
itself, so they don't travel. Restoring onto a fresh machine gives you all
your tasks and config; you re-point sync and re-set personal preferences
there.

### Backup is the lossless copy; export is a report

`loctt export` (and the `export_tasks` MCP tool) produces CSV or JSON for
a spreadsheet or another tool. It is a **report**, not a backup — it cannot
restore a tracker and does not carry history, comments, or attachments.
When you want a copy you can *restore from*, use `loctt backup`; when you
want to hand data to something that isn't LocTT, use `loctt export`.

The web UI does not offer this export. Backup and restore are on all three
surfaces; the filtered spreadsheet report is a CLI/MCP feature.

## Keys keep resolving

If you move a task to another project or change a project's prefix, the
task's key changes — but the old key still resolves. `loctt show OLD-KEY`
keeps working, because the old key is recorded in the task's `key_history`.
(The one exception: if you rename a key by hand-editing frontmatter,
LocTT can't see it until you run `loctt doctor --rebuild-index`.)
