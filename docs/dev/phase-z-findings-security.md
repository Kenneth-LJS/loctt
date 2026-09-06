# Phase Z Batch 2 — Security review findings

Scope: LocTT (local task tracker — CLI + MCP + a localhost web server).
Threat model calibrated to a local tool: the real risks are a
hand-crafted task/config/**backup** file escaping `.loctt` or writing
arbitrary paths, the git shell-out surface, YAML/markdown parsing, and
the localhost web server's bind/CSRF posture. Review was read-only;
no source or test was edited.

Repro scripts were run against the built `packages/core/dist`. The two
HIGH findings are demonstrated end-to-end (files written outside
`.loctt`), not inferred.

---

## Findings

### SEC-1 (HIGH) — Backup restore: attachment/avatar name is a zip-slip; writes arbitrary paths outside `.loctt`

**File:** `packages/core/src/backup/restore.ts:669` (attachments) and
`:676` (user avatar). Root schema gap: `packages/core/src/backup/format.ts:74-78`
(`BackupAttachmentSchema.name = z.string().min(1)` — no basename check).

**Exploit path:**
- Input: a crafted `.jsonl` backup file passed to `loctt backup restore`
  (CLI) / the restore core path. A `task` record carries
  `attachments: [{ name: "<../ traversal>", bytes: "<base64>" }]`.
- Flow: `loadBackup` → `readBackupPart` validates each record against
  `BackupRecordSchema`, but `BackupAttachmentSchema.name` is only
  `z.string().min(1)` — traversal tokens pass validation. In
  `restoreBackup` the attachment loop does:
  ```js
  const path = join(getAttachmentsDir(locttDir, id), att.name);   // att.name UNCHECKED
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(att.bytes, "base64"));
  ```
  `getAttachmentsDir` calls `assertSafeBasename(id)` on the **task id**
  but nothing validates `att.name`. A name like
  `../../../../../PWNED_OUTSIDE_LOCTT.txt` resolves outside `.loctt`.
- Achieves: **arbitrary file write** (create or overwrite) at any path
  the process can write, with attacker-controlled content. e.g.
  `~/.ssh/authorized_keys`, a shell rc file, a git hook, another
  project's files.
- The user avatar loop (`:676`,
  `join(getUserDir(locttDir, id), record.avatar.name)`) has the identical
  gap via `BackupUserSchema.avatar` → same `BackupAttachmentSchema.name`.

**Repro (run, confirmed):** built a backup whose sole attachment name was
a `path.relative(...)` traversal to a sibling of the project dir; after
`restoreBackup(locttDir, [bk], { mode: "bare" })` the file
`PWNED_OUTSIDE_LOCTT.txt` existed outside `.loctt` with content
`OWNED-attachment`. Report returned `created=1`, no error.

**Fix direction:** add `name` to `BackupAttachmentSchema` as a validated
basename (or `assertSafeBasename(att.name)` / `assertSafeBasename(record.avatar.name)`
in restore before the `join`). Note `getAttachmentPath` already applies
`assertSafeBasename` — restore bypasses it by building the path with a
bare `join`.

---

### SEC-2 (HIGH) — Backup restore: config record `path` is not confined to `.loctt`; arbitrary-path write

**File:** `packages/core/src/backup/restore.ts:552-561` (config
"travel as-is" loop) → the written path reaches
`stagedSwap` at `:561` as `join(locttDir, path)`. Root schema gap:
`packages/core/src/backup/format.ts:131-136`
(`BackupConfigSchema.path = z.string().min(1)`).

**Exploit path:**
- Input: same crafted backup, with a `config` record
  `{ kind: "config", path: "../../../../PWNED_CONFIG.txt", content: "owned" }`.
- Flow: config records not otherwise remapped are copied verbatim:
  ```js
  for (const [path, content] of loaded.configs) {
    ...
    configOut.set(path, content);
  }
  for (const [path, content] of configOut) {
    writes.push({ path: join(locttDir, path), content });   // path UNCHECKED, multi-segment by design
  }
  ```
  `path` is a relative-to-`.loctt` path *by design* (e.g.
  `config/workflow.yaml`), so `assertSafeBasename` is not (and cannot be)
  applied to it — but there is **no containment check** that the resolved
  path stays under `locttDir`. `stagedSwap` then `mkdir`s and `rename`s
  the staged file to that dest with no boundary check either
  (`state/staged-swap.ts:160-163`).
- Achieves: **arbitrary file write** with attacker-controlled content,
  same impact as SEC-1, reached through the atomic swap path.

**Repro (run, confirmed):** a config record with a `path` computed as
`path.relative(locttDir, <sandbox>/PWNED_CONFIG.txt)` produced
`PWNED_CONFIG.txt` outside `.loctt` with content `owned-config` after a
successful `bare` restore.

**Fix direction:** after computing each destination, verify
`resolve(locttDir, path)` is still within `resolve(locttDir)` (prefix
check with a trailing separator) and refuse the whole restore otherwise;
or validate every config `path` segment. Consider doing the same guard
inside `stagedSwap` as defense-in-depth, since it accepts absolute dest
paths from any caller.

---

### Notes on severity calibration

SEC-1/SEC-2 are HIGH, not CRITICAL, under the local-tool model: they
require the user to obtain and restore a malicious backup file (social
step). But restore is exactly the operation where a user knowingly
imports a file from elsewhere (another machine, a colleague, a shared
drive), so a booby-trapped backup is a realistic delivery vector, and the
payoff is arbitrary-path write with arbitrary content — a foothold for
code execution (git hook, shell rc, `authorized_keys`). The export side
never emits such names; the risk is entirely hand-crafted/tampered input,
which is in scope per the task brief.

---

## Checked, safe

- **Path builders apply `assertSafeBasename` on every path-forming id.**
  `packages/core/src/paths/index.ts`: `getTaskDir`, `getTaskFilePath`,
  `getHistoryFilePath`, `getCommentsFilePath`, `getAttachmentsDir`,
  `getAttachmentPath` (validates **both** taskId and name), `getUserDir`,
  `getUserProfilePath`, `getUserSettingsPath` all call
  `assertSafeBasename`. The guard rejects empty, null byte, `/`, `\`,
  `.`/`..`, and embedded `..` segments. An absolute POSIX path is caught
  (leading `/`). The gap is only where restore bypasses these builders
  with a bare `join` (SEC-1/SEC-2).

- **Git shell-out is argv, never a shell string.** All git calls use
  `spawnSync("git", args, { ... })` with no `shell: true`
  (`git/publish-sync.ts`, `git/git-mode.ts`, `git/three-way.ts`,
  `git/reconcile-session.ts`). No branch/remote/path is interpolated into
  a shell command. `; rm`, `$(...)`, backticks in a branch name are inert.

- **Git argument-injection (leading-dash) surface is contained.** `push`
  and `fetch` embed the branch in a `${branch}:${branch}` refspec (cannot
  be read as an option) to a `remote` that is first verified by
  `remoteExists` against `git remote` output, so it must be a configured
  remote name — not an arbitrary `--upload-pack=`/`--exec=` flag. Both set
  `GIT_TERMINAL_PROMPT=0` (no credential prompt hang/leak). `branch`/`remote`
  originate from local `sync.yaml` / defaults (`origin`, `loctt`), not from
  task/backup content.

- **Git worktree temp dirs** use `randomBytes(4)` suffixes under
  `.loctt/local/`, are pruned/removed, and `state.remote_commit` is passed
  as argv (`git/reconcile-session.ts:73-107`). No shell, no traversal.

- **YAML is parsed with the safe `yaml` package `parse()`** (eemeli/yaml),
  which does not instantiate arbitrary types. No `yaml.load` (js-yaml
  unsafe loader), no `eval`, no `new Function`, no dynamic `require` on
  file content anywhere in `packages/**` or `apps/**` (grep clean).

- **Web server binds to loopback only:** `server.listen(port, "127.0.0.1", ...)`
  (`apps/web/src/server/server.ts:4947`); startup banner confirms
  `http://127.0.0.1` (`main.ts:48`). Not `0.0.0.0`.

- **CSRF: mutating methods require an `X-Loctt-Client` custom header**
  (`server.ts:1170-1191`) and the server sets **no** `Access-Control-Allow-*`
  headers, so a cross-site request cannot pass the preflight — adequate
  for a localhost JSON API.

- **Attachment upload** takes `basename(filename)` (busboy,
  `apps/web/src/server/multipart.ts:84`) and enforces a 50 MB cap; the core
  add path re-validates via `assertSafeBasename`. Uploaded bytes cannot
  escape the task's attachments dir or overwrite a sibling by name.

- **Attachment download** validates the name via `getAttachmentPath`
  (→ `assertSafeBasename`) before reading (`server.ts:4446`), and serves
  with `Content-Type: application/octet-stream`, `X-Content-Type-Options:
  nosniff`, and `Content-Disposition: attachment` — a stored HTML/SVG
  upload cannot execute as markup. Delete-attachment also asserts
  (`server.ts:4500`). Avatar path asserts (`server.ts:2567`).

- **Content-Disposition header injection** is defended:
  `content-disposition.ts` strips CR/LF/controls/quote/backslash from the
  legacy `filename` and percent-encodes `filename*` per RFC 5987.

- **No secret logging.** No token/password/credential is logged or
  serialized. The `bodyToken`/`token` in `server.ts:2671` is an
  optimistic-concurrency version token for edit-conflict detection, not a
  credential. Git remote auth is delegated to git itself
  (`GIT_TERMINAL_PROMPT=0`); LocTT never handles remote credentials.

- **Restore path-forming ids are safe.** Task `id` (→ `getTaskFilePath`,
  `getAttachmentsDir`) and user `id` (→ `getUserDir`) are validated by
  `assertSafeBasename`. Only the *leaf name* (`att.name`, `avatar.name`)
  and the *config path* are unvalidated — that is SEC-1/SEC-2.

- **`stagedSwap`** refuses to replace a destination that is not a regular
  file and journals for atomic rollback; it does not, however, confine
  dest paths (relevant to SEC-2 as a defense-in-depth spot).
