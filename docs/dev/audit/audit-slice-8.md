# Audit slice 8 — `apps/cli/src/` (all non-test `.ts`)

Phase 4, report-only. No file was edited.

**Files read completely (31 of 31, ~3,035 lines):**
`index.ts`, `usage.ts`,
`runtime/args.ts`, `runtime/errors.ts`, `runtime/confirm.ts`, `runtime/schema-guard.ts`, `runtime/workflow-assert.ts`,
`format/value.ts`, `format/history.ts`,
`commands/`: `calendar.ts`, `comments.ts`, `config.ts`, `doctor.ts`, `git.ts`, `info.ts`, `init.ts`, `label.ts`, `mcp.ts`, `migrate.ts`, `milestone.ts`, `project.ts`, `schema.ts`, `sprint.ts`, `task-archive.ts`, `task-crud.ts`, `task-files.ts`, `task-links.ts`, `task-rank.ts`, `ui.ts`, `user.ts`, `views.ts`.
(`cli.test.ts` excluded per "non-test".)

Everything below marked "reproduced" was run against a fresh `mktemp -d` tracker via `node apps/cli/dist/index.js`. The repo working tree was verified clean afterwards (`git status --porcelain` empty).

---

### `list --project <name>` silently returns zero tasks — and so does a nonexistent project

- **File**: `apps/cli/src/commands/task-crud.ts:98` (and 108)
- **Category**: bug
- **What is wrong**: `list` reads `--project` with `getArg` and passes the raw string straight into `listTasks({ options: { project } })`. It never calls `resolveProjectIdForUser` / `resolveProjectIdFromInput`. The query layer matches `frontmatter.project`, which per **P-2** is a ULID — so a project *name* can never match. Reproduced:

  ```
  project create Beta --prefix B-      → id 01M031BXDGPGMBKV8PY4XFHD93
  create "in beta" --project Beta      → Created B-1
  list                                 → B-1  in beta [backlog]
  list --project Beta                  → "No tasks found."   exit 0
  list --project 01M031BXDG…           → B-1  in beta        exit 0
  list --project TOTALGARBAGE          → "No tasks found."   exit 0
  ```

  Two distinct defects in one line: (a) the documented name form does not work, and (b) an unresolvable project is indistinguishable from an empty result — both print "No tasks found." and exit 0.
- **Why it matters**: Directly violates **P-3** ("CLI and MCP accept a project **name** (erroring on ambiguity) or a ULID"). It is worse than the `duplicate` defect below because it fails *silently and successfully*: `duplicate` at least errors. A script doing `loctt list --project web --query 'status = done'` gets a confidently empty answer and exit 0. `docs/user/cli/reference.md:394` documents `--project <key>` as "Shorthand for adding `project = <key>` to the query", and `:410`/`:736` show `--project web` — a name. The doc describes behaviour the code does not have.
- **Blast radius**: `create` (task-crud.ts:49) and `move` (task-crud.ts:226) both resolve correctly, so the fix is to make `list` match its own neighbours. Adding resolution changes `list` from never-erroring to able-to-exit-1 on an unknown/ambiguous project — that is the intended P-3 behaviour but it *is* an exit-code change for any script currently relying on the silent empty. `--project` also composes with `--query` (reference.md:396), so the composed filter changes meaning. `apps/web` and `apps/mcp` have their own project-filter paths and should be checked for the same shape.
- **Size**: S (the change) / M (with the behaviour-change review)
- **Auto-fixable**: no — it is a behaviour change with an exit-code consequence
- **Confidence**: high (reproduced)

### `duplicate --project <name>` bypasses P-3 resolution and surfaces a raw core error

- **File**: `apps/cli/src/commands/task-crud.ts:191`
- **Category**: bug
- **What is wrong**: The prior agent's claim is **confirmed**. `const project = getArg(args, "--project")` is passed unresolved into `duplicateTask`'s `overrides.project`, unlike `create` (line 49, `resolveProjectIdForUser`) and `move` (line 226, `resolveProjectIdForUser`) in the same file. Reproduced:

  ```
  duplicate T-1 --project Beta
  → Error: no key allocation state for entity type "Beta"     exit 1
  move T-1 Beta                                               → Moved T-1 → B-1, exit 0
  ```
- **Why it matters**: **P-3** violation, plus the error message is a raw `allocateKey` internal — "no key allocation state for entity type" names neither the flag the user typed, nor the fact that a project name was expected, nor what to do. A user reading it has no path to "pass the ULID" or "the project does not exist". The three sibling handlers in one 429-line file disagree about the same flag.
- **Blast radius**: Fixing it means `duplicate --project` starts accepting names and starts erroring with `ProjectError` (exit 1, clean message) on unknown/ambiguous. Note `duplicate` is also **entirely absent from `usage.ts`** (see below), so its discoverability is already zero. `apps/mcp`'s duplicate tool should be checked for the same omission.
- **Size**: S
- **Auto-fixable**: no — behaviour change (though the change itself is one line mirroring line 49)
- **Confidence**: high (reproduced)

### Unknown-flag rejection exists, is correct, and is wired into exactly one command

- **File**: `apps/cli/src/runtime/args.ts:114` (`rejectUnknownFlags`), called only at `apps/cli/src/commands/init.ts:19`
- **Category**: bug
- **What is wrong**: *(root-cause analysis of the known defect — not a re-report of the bare fact)*. There is no parser divergence and no second code path. `getArg`/`hasFlag` are **pure extractors**: they scan argv for the flags a handler asks about and are structurally incapable of noticing a flag nobody asked about. Rejection is a separate, opt-in, correctly-implemented function — `grep -rn rejectUnknownFlags` over `apps`/`packages`/`tests` returns exactly three hits: the definition, the import in `init.ts`, and the single call. Every other command in the CLI simply never calls it. The doc comment at `args.ts:111-113` states the design intent explicitly ("Opt-in per command rather than global — some commands take pass-through arguments that must not be validated here"), so this is a deliberate opt-in mechanism with 1 of ~30 adopters, not a broken guard.

  **What a correct fix would touch.** The mechanism needs no change; the work is enumerating an allow-list per command. `rejectUnknownFlags` already whitelists `cwd` and already stops at `--`, so the global flag and pass-through tails are handled.

  - **Task commands (safe, and where the risk is)** — `create` (`project,status,priority,type`), `list` (`query,view,limit,archived,project`), `show` (none), `set`/`unset` (none), `body` (`set,append`), `log` (`limit`), `duplicate` (`title,project`), `move` (none), `archive`/`unarchive` (none), `delete` (`yes`), `attach` (`force`), `detach` (none), `link`/`unlink` (none), `rerank`/`board-rerank` (`before,after`). These are the irreversible ones and should go first.
  - **Entity dispatchers** — `project`, `user`, `label`, `milestone`, `sprint` need a **per-subcommand** allow-list, not one per command: `sprint create` takes `--start/--end/--state/--goal` while `sprint burndown` takes `--format`, and a union list would let `sprint burndown --goal x` through. This is the bulk of the work and the reason a single sweep is not a small change.
  - **Must NOT be added**: `mcp` and `ui` — `ui` forwards to `@loctt/web` and `mcp` to the SDK; both are the "pass-through arguments" the comment warns about. `migrate`/`config`/`git`/`doctor` are lower-risk but should still be enumerated.

  **What would break.** Three named things, all currently green:
  1. `tests/e2e/03-cli-full-lifecycle.test.ts:55` passes `--hard` to `delete`. That call starts exiting 2. Per `CLAUDE.md`, that test was asserting the bug and the commit must say so.
  2. `tests/e2e/10-error-paths.test.ts:39` is built around the same `--hard`.
  3. Any user script carrying a flag removed in an earlier release — which is precisely the failure mode `args.ts:106-110` says the function exists to catch, so surfacing them is the point.

  Also worth noting: `hasFlag` *already* throws `UsageError` on a malformed **value** (`--archived=ture` → exit 2, reproduced). So the CLI today rejects a typo'd flag *value* while accepting a typo'd flag *name*. That inconsistency is internal to the same file.
- **Why it matters**: `delete --yes --frce` currently deletes. The guard to prevent it is written, tested, and connected to one command.
- **Blast radius**: ~30 call sites across 12 command files; two e2e tests; any user script.
- **Size**: L
- **Auto-fixable**: no
- **Confidence**: high (grep-verified single call site; `--archived=ture` reproduced)

### A `UsageError` thrown inside an unwrapped command exits 1 instead of 2

- **File**: `apps/cli/src/index.ts:91-94`, `117-135`
- **Category**: bug
- **What is wrong**: Eleven commands are dispatched *without* `runCommand`: `info`, `doctor`, `views`, `schema`, `mcp`, `ui`, `project`, `user`, `label`, `milestone`, `sprint`, `calendar`, `git`, `config`, `migrate`. Their throws fall to the top-level `catch` at `index.ts:151`, which unconditionally sets `EXIT.RUNTIME` (1) — it has no `UsageError` arm. Since `hasFlag` and `getArg` can throw `UsageError` from *any* command, the same user mistake gets different exit codes depending on which command it was made in. Reproduced:

  ```
  list   --archived=ture        → exit 2   (wrapped)
  doctor --rebuild-index=ture   → exit 1   (unwrapped)
  migrate --dry-run=ture        → exit 1   (unwrapped)
  ```

  Identical error text, identical error class, different exit code. The entity dispatchers dodge this only because they wrap each *subcommand* body individually in `runCommand` and hand-roll the outer `USAGE` exits (e.g. `project.ts:93`, `user.ts:133`) — that hand-rolling is why they look correct.
- **Why it matters**: The CLI's contract is exit-code-based and `errors.ts:7-16` documents 2 as "the user typed the command wrong" precisely so scripts can distinguish it. A wrapper class that scripts cannot rely on is worse than none. The comment at `index.ts:86-89` acknowledges the gap ("The neighbours below are not wrapped because they throw no UsageError today") — that premise is false for `doctor` and `migrate`, which reach `hasFlag`, which throws `UsageError`.
- **Blast radius**: The minimal fix is a `UsageError` arm in the top-level catch (`index.ts:151`), which fixes all eleven at once and touches no command. The larger fix — wrapping the remaining dispatchers in `runCommand` — additionally changes how their *domain* errors are reported, and the entity dispatchers' hand-rolled exit codes would then be redundant.
- **Size**: S (top-level arm) / M (full wrap)
- **Auto-fixable**: yes for the top-level `UsageError` arm — it is provably a strict improvement and changes 1→2 only for a class already documented as 2. Tagged `auto-fixable`, but note it changes observed exit codes, so it needs the Phase 3 net.
- **Confidence**: high (reproduced)

### `label edit --label <new>` reports success and changes nothing

- **File**: `apps/cli/src/commands/label.ts:68` vs `docs/user/cli/reference.md:223-224,241-242`
- **Category**: bug
- **What is wrong**: The reference documents `loctt label create <key> [--label <label>]` and `loctt label edit <key> [--label <label>]`. The code reads `--name` (`label.ts:68`) and takes the label name as **positional** `args[2]` (`label.ts:41`). Because no command validates unknown flags, `--label` is silently dropped, and `editLabel` is called with an empty patch — which succeeds. Reproduced verbatim from the doc's own example:

  ```
  label create blocker --label "Blocker" --color "#cc0000"
  → Created label "blocker"     (name is "blocker", NOT "Blocker")
  label edit blocker --label "Renamed"
  → Updated label blocker       exit 0
  label list
  → blocker  #cc0000            (unchanged)
  ```

  The doc also calls the positional a `<key>`; labels have no key — `label.ts` resolves by name or ULID.
- **Why it matters**: Copy-pasting the documented example produces a label named `blocker` instead of `Blocker`, and a rename that reports success while doing nothing. This is doc↔code drift *and* a silent no-op — the confirmation message is affirmatively wrong. It is a direct consequence of the unknown-flag defect, which is what makes that defect's blast radius concrete rather than hypothetical. `docs/dev/autonomous-plan.md:143` states "The CLI reference documents no `loctt label` command at all" — that is itself stale: the section exists at `reference.md:217`, it is just wrong.
- **Blast radius**: Fixing `rejectUnknownFlags` on `label` turns these documented commands into hard errors, which is correct but will look like a regression to anyone following the doc. The doc region (`reference.md:217-244`) needs correcting in the same change. Per the plan, an agent must not edit the reference docs — this is a report.
- **Size**: S (code) — the doc correction is the real work
- **Auto-fixable**: no
- **Confidence**: high (reproduced)

### Six commands are dispatched but absent from `usage()`

- **File**: `apps/cli/src/usage.ts:18-65`
- **Category**: bug
- **What is wrong**: `usage()` is printed for `help`, `--help`, `-h`, and every unrecognized command — it is the CLI's only self-description. Reproduced by grepping its output: `duplicate`, `move`, `comment`, `comments`, `comment-edit`, `comment-delete` are all live cases in `index.ts:103-108` and none appear. `project set-prefix` is also missing from the `project` line at `usage.ts:27` (which lists `list|create|edit|archive|unarchive|delete|set-default`) even though `project.ts:87` implements it and its own error text at `project.ts:92` advertises it.
- **Why it matters**: `usage.ts:5-8` states the file's whole purpose is that adding a command means touching it. Six commands — including `move`, which reallocates keys under **P-7**, and the entire comment surface, whose own doc comment at `comments.ts:21-22` says comments were previously "documented as shipped and unreachable in practice" — are undiscoverable. A user with no other reference cannot learn they exist.
- **Blast radius**: `usage.ts` only; no behaviour change. Should be cross-checked against `docs/user/cli/reference.md` section headings (49 of them) so the two agree.
- **Size**: S
- **Auto-fixable**: yes — additive text, no behaviour change
- **Confidence**: high (reproduced)

### `loctt comment <task> <body>` silently drops any body word beginning with `--`

- **File**: `apps/cli/src/commands/comments.ts:35` and `:79`
- **Category**: bug
- **What is wrong**: `args.slice(2).filter(a => !a.startsWith("--")).join(" ")` strips flag-looking tokens from the comment body rather than using `--` as the end-of-flags separator (which `getArg`/`hasFlag`/`rejectUnknownFlags` all honour). Reproduced:

  ```
  comment T-1 "--important note"
  → Error: missing args        exit 2
  ```

  The body was `--important note`; the filter removed `--important`, leaving `note`… except the whole quoted string is one argv token starting with `--`, so it is removed entirely and the body becomes empty. A body like `see --force flag` would be silently stored as `see flag` with no warning and exit 0 — worse, because it succeeds.
- **Why it matters**: A comment is free text. Markdown, shell snippets, and flag names in a bug report all legitimately start with `--`. Silent, unannounced content mutation on a write path is the bad case; the `exit 2` above is the visible tip. `comment-edit` (`:79`) has the identical line. Note the confusing error: the user *did* supply a body, and is told "missing args".
- **Blast radius**: `comments.ts` only (two lines). The correct shape is to split at the first `--` and treat the remainder as body, matching the convention `args.ts:12-14` documents for the rest of the CLI. Neither `comment` nor `comment-edit` accepts any flag today, so there is nothing to filter *for* — the filter has no positive purpose.
- **Size**: S
- **Auto-fixable**: no — changes stored content for bodies containing `--`
- **Confidence**: high (reproduced)

### `user current` prints its failure to stdout while exiting 1

- **File**: `apps/cli/src/commands/user.ts:46-49`
- **Category**: bug
- **What is wrong**: When no user is registered, `console.log("(no users registered)")` goes to **stdout**, then `process.exitCode = EXIT.RUNTIME`. Reproduced (users dir removed from a fresh tracker): `exit=1`, text on stdout. Every other error path in the slice uses `console.error`.
- **Why it matters**: `user current` is the natural thing to capture in a shell variable — `USER=$(loctt user current)`. On failure the variable gets the literal string `(no users registered)` rather than being empty, so a script that checks `[ -z "$USER" ]` before checking `$?` silently proceeds with a garbage user. The stdout/stderr split is the CLI's other machine-readable contract alongside exit codes, and `task-crud.ts:118` shows the codebase knows this ("stderr keeps the task list on stdout pipeable").
- **Blast radius**: One line. Anything parsing `user current` stdout.
- **Size**: S
- **Auto-fixable**: yes — moving an error message to stderr on a path that already exits non-zero
- **Confidence**: high (reproduced)

### `user edit` with no field flags reports success and changes nothing

- **File**: `apps/cli/src/commands/user.ts:90-112`
- **Category**: bug
- **What is wrong**: `user edit <ref>` with no `--name`/`--email`/`--timezone`/`--avatar` builds an empty patch, calls `updateUser`, and prints `Updated user <id>`. Reproduced: `user edit ken` → `Updated user 01M031…`, exit 0. Its direct sibling `project edit` guards this explicitly (`project.ts:77-79`: `throw new UsageError("nothing to update; pass --name")` → exit 2, reproduced). `milestone edit`, `sprint edit`, and `label edit` share the `user` shape, not the `project` shape.
- **Why it matters**: A false success. Combined with the unknown-flag defect this is how `label edit --label X` (above) reports a rename it did not do — the two defects compose into a confirmed-but-false confirmation. `project.ts` proves the intended behaviour is known; four of five entity `edit` handlers just don't do it.
- **Blast radius**: `user.ts`, `label.ts`, `milestone.ts`, `sprint.ts` — four handlers adopting the `project.ts:77-79` pattern. Turns a current exit 0 into exit 2 for the empty-patch case.
- **Size**: S
- **Auto-fixable**: no — exit-code change
- **Confidence**: high (reproduced)

### `ui --port <garbage>` silently falls back to a random port

- **File**: `apps/cli/src/commands/ui.ts:16`
- **Category**: bug
- **What is wrong**: `Number(getArg(args, "--port")) || undefined`. `Number("abc")` is `NaN`, `NaN || undefined` is `undefined`, so an unparseable port is discarded and the server binds wherever `@loctt/web` defaults. `--port 0` collapses the same way (`0 || undefined`), as does `--port ""`. No validation, no message. Compare `list`/`log`, which validate `--limit` properly (`task-crud.ts:87-92`, `:409-414`) and throw a `UsageError`.
- **Why it matters**: The user asked for a specific port, generally because something else expects it there. The URL is printed, so it is recoverable — which is why this ranks below the silent-data defects — but "I typed the port and it ignored me" is exactly the class the CLI validates everywhere else. The `||` idiom also conflates "absent", "zero", and "invalid" into one branch.
- **Blast radius**: `ui.ts` only. Adding a `UsageError` gives `ui` its first `UsageError` — which, because `ui` is dispatched unwrapped (`index.ts:118`), would exit **1, not 2**, per the finding above. The two should be fixed together or the port fix will land with the wrong exit code.
- **Size**: S
- **Auto-fixable**: no — introduces a new error path
- **Confidence**: high (read; `Number("abc") || undefined` is unambiguous)

### `--cwd` swallowing its own successor produces a misleading error

- **File**: `apps/cli/src/runtime/args.ts:49` and `:83`, consumed at `index.ts:45-49`
- **Category**: bug
- **What is wrong**: `getArg` refuses a value starting with `-`, so `--cwd -weird` yields `undefined` and `root` silently becomes `process.cwd()`. `stripCwdArg` then also declines to consume `-weird`, leaving it as `args[0]` — the subcommand. Reproduced:

  ```
  --cwd -weird info    → "Unknown command: -weird" + full usage, exit 2
  --cwd --prefix info  → "Unknown command: --prefix" + full usage, exit 2
  ```

  Exit 2 is right, but the message blames the wrong token: the user's error was a bad `--cwd` value, and they are told their *command* is unknown while `info` — the command they actually typed — goes unmentioned. The two helpers agree with each other (as `args.ts:64-66` intends), so this is a gap in the shared rule, not a divergence.
- **Why it matters**: `--cwd` is the one global flag and the one that decides *which tracker gets written to*. A silent fallback to `process.cwd()` on a malformed value is the dangerous shape — it is only saved here by the leftover token failing command dispatch. If the stray token had happened to be a valid command name, the command would have run against the wrong tracker. That near-miss is the finding.
- **Blast radius**: `index.ts:45-49` could compare `getArg`'s result against the raw presence of `--cwd` in argv and raise a `UsageError` naming the flag. Contained; `--cwd` values legitimately starting with `-` are not a real case (paths use `./-x`), and the `--cwd=<value>` form already handles anything.
- **Size**: S
- **Auto-fixable**: no — new error path
- **Confidence**: high (reproduced)

### `info` reaches past `getTrackerInfo` to re-read config itself

- **File**: `apps/cli/src/commands/info.ts:24-41`
- **Category**: layering
- **What is wrong**: `info` calls core's `getTrackerInfo(root)` for its summary, then independently calls `resolveLocttDir(root)` + `loadProjectsConfig`, joins projects against `info.state.keys` in the command, and hand-rolls an `ENOENT`-swallowing try/catch (`:40`) to tolerate a fresh tracker. Deciding that a missing `projects.yaml` is normal-but-a-parse-error-is-not is a core policy judgement, and the CLI is making it with a raw `NodeJS.ErrnoException` code check.
- **Why it matters**: The CLI's job is parse → call core → format. The per-project counter join is a *view model*, and it is the only one in the slice built in the command layer rather than by core — `show` correctly delegates to `buildShowModel` (`task-crud.ts:139`), and `list` to `buildListContext`/`listTasks`. `apps/web` and `apps/mcp` presenting the same "projects and their next key" block would each re-derive this join and each get to decide independently what a missing file means. The `errno` check also duplicates knowledge that core's own loaders already encapsulate.
- **Blast radius**: Moving the join into `getTrackerInfo`'s return (as an optional `projects` field) touches core plus this one call site; the printed output need not change. Check whether `apps/web` already has a parallel implementation before choosing the shape.
- **Size**: M
- **Auto-fixable**: no
- **Confidence**: medium — the layering call is a judgement, and the defensive `ENOENT` swallow is deliberate and commented. Reported because the *location* of the policy is wrong, not because the behaviour is.

### Five entity dispatchers repeat an identical delete-confirm-and-remap block

- **File**: `label.ts:80-109`, `milestone.ts:101-130`, `sprint.ts:99-128`, `project.ts:140-168`, `user.ts:128-182`
- **Category**: duplication
- **What is wrong**: The `delete` arm of each entity dispatcher is the same fourteen-line shape: missing-ref → hand-written `console.error` pair + `EXIT.USAGE`; read `--remap-to`; `confirmHardDelete`; the identical `if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }` line; then a `runCommand` that loads config, resolves both refs, hard-deletes, and reports an affected count. `label`, `milestone`, and `sprint` are near-textually identical, differing only in the noun, the loader, and the resolver.
- **Why it matters**: The outcome→exit-code line appears **six** times verbatim (five entity deletes plus `project set-prefix` at `project.ts:130`) and encodes the contract `confirm.ts:8-15` documents. Six copies of an exit-code mapping is six places to drift, and the exit-code contract is the one thing this CLI most needs to hold. The `archive`/`unarchive` arms are similarly near-identical across all five files.
- **Blast radius**: **Checked before recommending.** The three near-twins are genuinely collapsible — a helper parameterised by `{noun, loadConfig, resolveId, remove}` would cover `label`/`milestone`/`sprint`. But `project` and `user` are **not**: `project delete` has no affected-count message shape in common (it reports `remappedTaskCount` with different prose) and `user delete` additionally carries the `--remap-to`/`--unassign` mutex (`user.ts:138-142`) and pre-resolves the ref to name it in the prompt (`user.ts:147-157`). Both differences are load-bearing. The safe extraction is narrow: pull out **only** the outcome→exit-code mapping (a three-line `applyConfirmOutcome(outcome): boolean`) into `confirm.ts`, where its contract is already documented, and leave the five bodies alone. That is the recommendation; collapsing the three twins is a larger judgement call worth its own discussion.
- **Size**: S (the exit-code helper) / L (full collapse, not recommended)
- **Auto-fixable**: no
- **Confidence**: high (for the duplication); the *narrow* fix is the considered one

### `list --limit` validation is duplicated verbatim in the same file

- **File**: `apps/cli/src/commands/task-crud.ts:86-92` and `:408-414`
- **Category**: duplication
- **What is wrong**: `list` and `log` contain byte-identical seven-line blocks parsing and validating `--limit`, down to the error string `"--limit must be a non-negative integer"`.
- **Why it matters**: Minor, but it is the one piece of *correct* numeric flag validation in the CLI, and `ui.ts:16` needed exactly it and did not have it (see the `--port` finding). Extracted as `getIntArg(args, "--limit")` in `runtime/args.ts`, it would sit next to `getArg`/`hasFlag` where the next command needing a numeric flag would find it. Reproduced that both behave identically: `list --limit abc` and `list --limit=-3` both exit 2 with that message.
- **Blast radius**: `args.ts` gains one export; two call sites in `task-crud.ts` shrink; `ui.ts` becomes a candidate adopter. No behaviour change if the message is preserved.
- **Size**: S
- **Auto-fixable**: yes — pure extraction, identical text, no behaviour change
- **Confidence**: high

### `KNOWN_DOMAIN_ERRORS` omits `RelationshipError` by comment rather than by fact

- **File**: `apps/cli/src/runtime/errors.ts:95-97`
- **Category**: comment
- **What is wrong**: The comment says "RelationshipError surfaces from link/unlink; not currently imported here because the existing handlers let it bubble. Add it when a future command catches it." The premise is confused: nothing in `KNOWN_DOMAIN_ERRORS` is about a *command* catching anything — the list exists so `runCommand` (the shared wrapper) recognises the class. `link`/`unlink` **are** wrapped (`index.ts:114-115`), so a `RelationshipError` from them falls through `runCommand`'s loop, re-throws (`errors.ts:133`), and is caught by the top-level handler at `index.ts:151`. It reaches the same exit 1 with the same `Error: <message>` formatting — so the user-visible outcome is currently identical, which is why nothing surfaced it.
- **Why it matters**: The comment tells the next maintainer that the omission is conditional on a future refactor that is not required. Meanwhile the class is genuinely outside the "known kind of failure" set the file's own doc comment (`:69-73`) says the list represents, so `link` and `unlink` are the only wrapped task commands whose primary domain error is unclassified. If a future change ever makes the top-level catch behave differently from `runCommand` (e.g. the `UsageError` arm proposed above), this silently diverges.
- **Blast radius**: One import + one array entry in `errors.ts`. No observable behaviour change today — verified by reasoning through both paths, and `link T-1 frobnicates T-1` was reproduced exiting 2 via the *pre-flight* `UsageError` at `task-links.ts:21`, which is the path that masks this in practice.
- **Size**: S
- **Auto-fixable**: yes — adding the class is behaviour-neutral today
- **Confidence**: medium — no reproducible symptom; the finding is that the stated reason is wrong

### `index.ts`'s comment justifies the unwrapped dispatch with a false premise

- **File**: `apps/cli/src/index.ts:86-89`
- **Category**: comment
- **What is wrong**: "The neighbours below are not wrapped because they throw no UsageError today; wrapping them is a separate change with its own exit-code implications." `doctor` calls `hasFlag` (`doctor.ts:15`) and `migrate` calls it twice (`migrate.ts:17-18`); `hasFlag` throws `UsageError` on a malformed value (`args.ts:158`). Both therefore throw `UsageError` today, and both exit 1 rather than 2 as a result — reproduced above.
- **Why it matters**: This is the comment a maintainer reads when deciding whether the unwrapped dispatch is safe, and it says the risk does not exist. It is the load-bearing justification for the exit-code inconsistency finding above, which is why it is recorded separately: fixing the code without fixing this comment leaves the next reader with a reason to undo it.
- **Blast radius**: Comment only, but it should be corrected in the same change as the exit-code fix.
- **Size**: S
- **Auto-fixable**: yes (once the code position is decided)
- **Confidence**: high (reproduced)

---

## Checked and found sound

Things I traced and disproved, recorded so the next reader does not re-derive them.

- **Bulk partial-failure exit codes.** `reportBulk` (`task-crud.ts:305`) and the bulk arm of `move` (`:236`) set `EXIT.RUNTIME` on any failure, and it survives the normal return. Reproduced: `set T-1,T-99 status done` → succeeds on T-1, lists `T-99: task not found`, **exit 1**; `move T-1,T-99 P2` likewise. Failures go to stderr, successes to stdout. Correct, and the `runCommand` doc comment (`errors.ts:110-112`) explicitly sanctions a body setting `process.exitCode` itself.
- **The confirm three-state mapping.** `no` → 0, `refused` → 2 is applied consistently at all six sites and matches `confirm.ts:8-15`. The *duplication* is a finding above; the *logic* is right everywhere I checked.
- **`getArg` last-wins / `--` handling / empty-string preservation.** The three helpers in `args.ts` agree with each other and with their documented contract, including `stripCwdArg` deliberately mirroring `getArg`'s dash rule (`args.ts:64-66`). The `--cwd` finding above is a gap in that shared rule, not a disagreement between the two.
- **`hasFlag` rejects malformed values.** `--archived=ture` throws rather than being read as truthy. Reproduced (exit 2 from a wrapped command). This is better than most CLIs and worth not breaking.
- **`unarchive` / `archive` on tasks.** `task-archive.ts` is 27 lines, delegates entirely, and has no logic to get wrong.
- **`schema`, `views`, `mcp` ignore their args by signature** (`_args`). Deliberate and correctly spelled — `schema --bogus` exiting 0 is the unknown-flag defect, not a separate one, and these are read-only.
- **`attach` re-wrapping `AttachmentExistsError`** (`task-files.ts:41-48`) to add "use --force to overwrite" looked like a layering violation. It is not: the comment explains the hint is CLI-specific because MCP passes `force: true` unconditionally. Adding a CLI-flag hint to a core error message is the CLI's job. Reproduced clean domain errors from both `attach` (missing source) and `detach` (missing attachment), both exit 1.
- **`detach`'s basename check** (`task-files.ts:62`) duplicates core's `assertSafeBasename`. The comment names it as a deliberate defence-in-depth second layer on a path-traversal boundary. Correct call; not a finding.
- **`migrate`'s refusal → exit 0.** Deliberate and commented (`migrate.ts:52-54`) so scripts don't false-alarm. Consistent with `confirmHardDelete`'s `no` → SUCCESS.
- **`doctor` exits 1 on `error` but 0 on `warn`.** Documented at `doctor.ts:11-12` and deliberate.
- **The boot guard's recovery-error path** (`index.ts:73-78`) reports to stderr and **proceeds** rather than throwing. This is exactly the invariant "Resumable recovery never throws out of the boot hook… Failure is reported and the command proceeds" (`invariants.md:46`), including the reason — so `doctor` stays usable. Correct.
- **`ui`/`mcp` exemption from the schema guard** (`schema-guard.ts:29-38`). They run their own per-request guard per the comment. Not the fatal-sentinel case: `.schema-migration-in-progress` is enforced in core's `requireSupportedSchema`, not in this exempt list, so exemption here does not bypass the fatal sentinel. I did not verify core's side — out of slice.
- **`formatValue` / `formatHistoryEntry` / `readLinkMeta`.** `readLinkMeta` type-guards rather than casting and returns visible `(unknown)` sentinels instead of rendering `undefined → undefined`; the `default` arm degrades to `{ts} {kind}` and its comment honestly calls that "wrong-but-not-broken". Sound.
- **`create --project` resolution.** Reproduced correct for both name (`Beta` → `B-1`) and unknown (`NoSuchProj` → `Error: unknown project: NoSuchProj`, exit 1). P-3 compliant. This is the contrast that makes `list` and `duplicate` findings rather than a shared design.
- **Entity dispatcher `default:` arms** all print usage to stderr and exit 2. Reproduced for `project`, `user`, `label`, `milestone`, `sprint`, `git`, `calendar`, plus bare `calendar`. Consistent.
- **`list --view nosuchview` and `list --query 'status ='`** surface clean, specific core errors (`unknown view "nosuchview"`, `unexpected end of query at position 7`) at exit 1. Good messages; no raw exception leaked.
- **`list`'s `onWarning` → stderr** (`task-crud.ts:119-121`) so the task list stays pipeable on stdout. Correct, and the reasoning is written down.
