# Concepts

A mental model for how LocTT works. If you've used Git, most of this will feel familiar — LocTT borrows the same instincts about local-first data and explicit sync.

## Where your data lives

When you run `loctt init`, LocTT creates a `.loctt/` directory in your project. **That directory is your tracker.** Everything LocTT knows about your tasks, workflow, users, sprints, and so on lives there.

If you delete `.loctt/`, you delete your tracker. If you copy it to another machine, you've copied your tracker. If you commit it to Git, you've versioned your tracker. There is no cloud account and no hosted database holding a "real" copy somewhere else. The directory on disk is the source of truth.

This has practical consequences:

- **It's all yours.** No one can shut down your tracker, change its pricing, lose your data, or hold it hostage behind an export feature.
- **It moves with the project.** Clone the repo, get the tasks. Move the repo, the tasks come too.
- **Standard tools work on it.** `grep`, `find`, `rg`, your editor — anything that reads files reads your tasks.

The CLI, the web UI, and the MCP server are all just three different ways of reading and writing the same `.loctt/` directory. Open all three at once if you like — they stay in sync because they share the same files.

## What gets shared, and how

A local-first tool has to answer one question: **what happens when more than one machine is involved?**

LocTT doesn't push your tasks anywhere by default. If you want your tasks on a second machine, or in a teammate's hands, you have to choose how to share them. There are three reasonable approaches.

**Not sure which?** Commit `.loctt/` to your repo — approach 1. It's the simplest, needs no extra setup, and is the right default for most solo and small-team projects. Reach for the others only when task-churn commits on your main branch bother you (approach 2) or you want tasks to stay off Git entirely (approach 3).

### Approach 1: Commit `.loctt/` to your repo

The simplest option. Treat `.loctt/` like any other folder in your project — `git add`, `git commit`, `git push`. Your tasks travel with your code, show up in pull requests, get reviewed alongside the changes that motivated them.

Good for:
- Solo projects where tasks and code naturally evolve together
- Small teams that want tasks in the main branch's history
- Projects where "what was I thinking when I wrote this?" should include the task that caused the change

The downside: every task update is a commit on your main branch. If you reorder a sprint or move a few cards around, that's noise in `git log`. For some projects that's fine. For others it's annoying.

### Approach 2: Git sync (opt-in)

LocTT can sync your tasks through Git **without** putting them on your main branch. You run `loctt git enable`, and from then on:

- `loctt git publish` pushes your task state to a dedicated `loctt` branch in the same repo
- `loctt git sync` pulls task state from that branch into your working copy
- Your main branch stays clean — `.loctt/` is gitignored in normal day-to-day work

Think of the `loctt` branch like GitHub Pages' `gh-pages` branch: same repo, parallel history, separate purpose. Your code lives on `main`; your tasks live on `loctt`. They share infrastructure but not commit history.

Good for:
- Teams who want shared tasks without polluting code history
- Anyone who finds task-churn commits noisy
- Setups where tasks should follow the repo but not gate code review

When two machines change the same field on the same task between syncs, LocTT does a 3-way merge: it compares your local state, the remote state, and the last common baseline. Non-overlapping changes merge automatically. Real conflicts (you both edited the same field to different values) pause for you to resolve.

See [git-sync.md](git-sync.md) for the operational details.

### Approach 3: Don't share at all

Perfectly valid. Add `.loctt/` to `.gitignore` and use LocTT as a purely local tracker. Your tasks never leave your machine. This is the right answer for plenty of personal projects.

## Why publish/sync is its own step

`loctt git publish` and `loctt git sync` exist because **the data you work with locally and the data that gets shared are different things**:

- Your local `.loctt/` includes machine-specific state — which user you're acting as, whether git sync is enabled on _this_ machine, which commit you last synced from. None of that should be shared.
- The shared `loctt` branch contains only the tracker's public state — tasks, config, users.
- Publish and sync decide what crosses that boundary, handle key collisions (two people creating `T-42` at once), and run the 3-way merge.

Raw Git can do this too; the publish/sync commands make it routine instead of fiddly.

## Identity: `id` vs `key`

Every task has two names.

**`id`** is a ULID — a long, ugly, unique-forever string like `01HK2X7N3Q...`. You almost never see it. It exists so that LocTT can identify a task unambiguously no matter what else changes.

**`key`** is the short, human-friendly handle: `T-1`, `T-42`, `BACKEND-7`. It's what you type, what you see, what you share.

Why two? Because keys can change. If two people working on different machines both create a new task while disconnected, they might both call it `T-42`. When they sync, one task keeps `T-42` and the other gets reassigned to `T-43`. The reassignment is harmless because internally each task is still identified by its ULID — the rename only affects the display label. Links between tasks survive. History survives. The old key is remembered so searches for `T-42` still find both tasks.

Practically: **use keys for everything day-to-day**. The ULIDs are there so the system stays coherent when things move around.

## What's configurable, and where

LocTT ships with sensible defaults, but almost everything is customizable:

- **Workflow** (`.loctt/config/workflow.yaml`) — statuses, priorities, task types, relationship kinds, custom fields. Want a `blocked_by_external` status or a `severity` field? Add it here.
- **Saved views** (`.loctt/config/queries.yaml`) — frequently-used filters with names.
- **Calendar** — timezone, working days, holidays.
- **Projects** — multiple projects in one tracker, each with its own key prefix (`BACKEND-`, `WEB-`, etc.) and counter.

The configurability matters because LocTT isn't trying to impose someone else's workflow on you. The vocabulary is yours.

## Where to go next

- [Quick Start](../quickstart.md) — install and first steps
- [Configuration](configuration.md) — customizing the workflow
- [Git Sync](git-sync.md) — details of the sync model
- [Query Language](query-language.md) — filtering tasks
- [Recovery & health](recovery.md) — undo, lost tasks, hand-editing, `doctor`
- [Data portability](data-portability.md) — reading and exporting your data
- [Upgrading & migrations](upgrading.md) — updating safely
