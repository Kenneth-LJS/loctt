# Degradation / corruption test inventory

Ground-truth extraction of every distinct data-degradation / corruption
behavior the LocTT codebase currently **tests**, for authoring canonical
user-story cases. Read-only inventory: no code was changed.

- **Vocabulary** comes from `corruption-framework-proposal.md`,
  `corruption-coverage-map.md`, and decisions K21/K22/K23/K25/K26/K27,
  A135/A136/A137/A137.1/A138/A139.
- **Scope scanned:** the ~39 degradation-touching test files named in the
  brief, PLUS the CLI/MCP integration test files (`apps/cli/src/cli.test.ts`,
  `apps/cli/src/format/history.test.ts`, `apps/mcp/src/mcp.test.ts`) which
  are where any CLI/MCP-layer corruption rendering would live — they matter
  for the parity analysis.
- Every row is grounded in a real `file:testname` that was read. Test names
  are quoted verbatim (the `it(...)`/`test(...)` description). Parameterized
  loops are noted where they expand into many generated cases.
- "KIND" uses the framework taxonomy: **wrong_type** (schema-known field,
  bad value), **missing_required**, **unrecognised** (undeclared key),
  **dangling** (ref to a non-existent target), **invalid_value** (workflow
  drift: right type, config doesn't define it), **malformed_history**
  (sibling `_history.yaml`/`_comments.yaml` rows), **broken_config_entry**
  (per-entry config degradation → `BrokenEntry`), **object_fatal**
  (unreadable/unparseable or bad identity).

---

## 1. Full row table

### 1.1 Core — task frontmatter parse/serialize (`packages/core/src/task/frontmatter.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 1 | task frontmatter (core) | object_fatal (missing id) | refuse — throws "id is required" | frontmatter.test.ts: throws on missing required id (object-fatal — id addresses the task) | K26 |
| 2 | task frontmatter (core) | object_fatal (missing key) | refuse — throws "key is required" | frontmatter.test.ts: throws on missing required key (object-fatal — key addresses the task) | K26 |
| 3 | task frontmatter (core) | missing_required (title) | degrade → health kind `missing_required`, repair `set` | frontmatter.test.ts: degrades a missing title into health rather than throwing (K26) | K26 |
| 4 | task frontmatter (core) | wrong_type (due_date:42) | degrade — off frontmatter, health `wrong_type`, raw+rawText preserved, repair `set_or_remove` | frontmatter.test.ts: degrades a wrong-typed due_date into health, lifting it off frontmatter | K27 |
| 5 | task frontmatter (core) | unrecognised (jira_id) | degrade — off frontmatter, health `unrecognised`, raw preserved, repair `remove` | frontmatter.test.ts: moves an unrecognised top-level key into health (kind unrecognised) | A135.1 |
| 6 | task frontmatter (core) | mixed field-local + object_fatal id | refuse (fail closed) — whole parse throws, not half-degrade | frontmatter.test.ts: fails closed when a fault mixes with an object-fatal id fault | K26 |
| 7 | task frontmatter (core) | object_fatal (id:~ / key:~ null) | refuse — throws, message names the field (×2) | frontmatter.test.ts: reports id: ~ as a type error mentioning the field / reports key: ~ … | K26 |
| 8 | task frontmatter (core) | missing_required (title/created_at/updated_at :~ null) | degrade → health `missing_required` (×3) | frontmatter.test.ts: degrades title: ~ … / created_at: ~ … / updated_at: ~ into a missing_required health finding (K26) | K26 |
| 9 | task frontmatter (core) | unrecognised (round-trip) | preserve — serializeFrontmatter(fm,health) re-emits unknown keys value-stable | frontmatter.test.ts: preserves unknown frontmatter keys across parse → serialize (via health) | K27, A136 |
| 10 | task frontmatter (core) | unrecognised (drop-guard) | drop — without health threaded the key is dropped; with health it re-emits | frontmatter.test.ts: does NOT emit an unrecognised key when health is not passed (it is off frontmatter) | A136.2 |
| 11 | task frontmatter (core) | unrecognised (ordering) | preserve — unknown keys emitted after canonical known fields | frontmatter.test.ts: emits unknown keys after the canonical known fields | — |
| 12 | task frontmatter (core) | wrong_type (override) | preserve raw unless overwritten; healthy fm value supersedes health raw | frontmatter.test.ts: re-emits a preserved corrupt value unless the field is overwritten | K27 |
| 13 | task frontmatter (core) | wrong_type + unrecognised (via Task) | preserve — assembleTaskFile re-emits due_date:42 + jira_id through the Task's health | frontmatter.test.ts: re-emits health raw values through the Task it takes (§ 13.2 B2) | A136.2 |

### 1.2 Core — corruption audit matrix (`packages/core/src/task/corruption-audit.test.ts`)

Table-driven; read loops iterate **9 field-local columns** (due_date, priority,
labels, relationships, fields, board_rank, key_history, title, jira_id).

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 14 | lookupById (core) | wrong_type / missing_required / unrecognised (×9 cols) | degrade & open with health, not UnreadableTaskError | corruption-audit.test.ts: lookupById HANDLED: opens \<col\> with health, not UnreadableTaskError | K26, A135.3 |
| 15 | lookupByKey (core) | field-local (×9 cols) | degrade — resolves by key (index folds a corrupt task) | corruption-audit.test.ts: lookupByKey HANDLED: \<col\> resolves by key (index folds a corrupt task) | — |
| 16 | loadAllTasks (core) | field-local (×9 cols) | degrade — appears in list with health | corruption-audit.test.ts: loadAllTasks HANDLED: \<col\> appears in the list with health | — |
| 17 | read/lookupById (core) | object_fatal (no id) | refuse — UnreadableTaskError, blocks nothing else | corruption-audit.test.ts: object-fatal (no id) stays UnreadableTaskError (blocks nothing else) | K26 |
| 18 | read/lookupById (core) | object_fatal (YAML syntax) | refuse — UnreadableTaskError | corruption-audit.test.ts: object-fatal (YAML syntax) stays UnreadableTaskError | — |
| 19 | setField (core) | wrong_type/unrecognised (×3 cols) | preserve — writing another field keeps the corrupt one byte-for-byte | corruption-audit.test.ts: HANDLED: set status, \<col\> raw survives byte-for-byte | K27 |
| 20 | setField (core) | wrong_type (due_date) | override — a valid due_date clears the wrong_type finding | corruption-audit.test.ts: HANDLED: setting a valid due_date clears the wrong_type finding | K27 |
| 21 | unsetField (core) | unrecognised (jira_id) | drop — unset removes it from health and disk | corruption-audit.test.ts: HANDLED: unset an unrecognised top-level key removes it | A135.1 |
| 22 | unsetField (core) | wrong_type (due_date) | drop — unset removes it from health and disk | corruption-audit.test.ts: HANDLED: unset a wrong-typed known field removes it | — |
| 23 | linkTask (core) | wrong_type (relationships, source) | refuse — rejects /relationships/ (op must read the field) | corruption-audit.test.ts: HANDLED: linkTask refuses over a wrong-typed relationships (source) | A135.4 |
| 24 | unlinkTask (core) | wrong_type (relationships, source) | refuse — rejects /relationships/ | corruption-audit.test.ts: HANDLED: unlinkTask refuses over a wrong-typed relationships (source) | A135.4 |
| 25 | archiveTask (core) | wrong_type (archived) | override/repair — proceeds, sets archived=true, clears finding | corruption-audit.test.ts: HANDLED: archive proceeds and repairs a wrong-typed archived | §13.3 |
| 26 | unarchiveTask (core) | wrong_type (archived) | no-op-or-repair — never persists the corrupt value | corruption-audit.test.ts: HANDLED: unarchive over a wrong-typed archived is a correct no-op-or-repair | §13.3 |
| 27 | bulkSetFields (core) | wrong_type (due_date) | preserve — succeeds, due_date:42 survives on disk | corruption-audit.test.ts: HANDLED: bulkSetFields(status) on a task with a bad due_date preserves it | — |
| 28 | bulkArchive (core) | unrecognised (jira_id) | preserve — succeeds, jira_id survives on disk | corruption-audit.test.ts: HANDLED: bulkArchive on a task with an unrecognised key preserves it | — |
| 29 | writeTask guard (core) | wrong_type (new finding start_date:99) | refuse — CorruptWriteError, nothing written | corruption-audit.test.ts: HANDLED (rule 1): a write that introduces a new finding is refused | A136.1 |
| 30 | writeTask guard (core) | wrong_type (drop untouched due_date) | refuse — CorruptWriteError; corrupt value survives | corruption-audit.test.ts: HANDLED (rule 2): a write that DROPS an untouched corrupt field is refused | §13.1 B1 |
| 31 | writeTask guard (core) | whole-record write (touched='*') | allow — a whole-record write may author freely | corruption-audit.test.ts: HANDLED (rule 2 exemption): a whole-record write (touched='*') may author freely | A136.2 |

### 1.3 Core — lifecycle idempotency (`packages/core/src/task/lifecycle.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 32 | archiveTask (core) | monotonic-write (double archive) | no-op success — no throw, no new history, no archived_at bump | lifecycle.test.ts: is idempotent: archiving an already-archived task is a no-op success (K25) | K25 |
| 33 | unarchiveTask (core) | monotonic-write (unarchive non-archived) | no-op success — returns unarchived state, no new history | lifecycle.test.ts: is idempotent: unarchiving a task that is not archived is a no-op success (K25) | K25 |

### 1.4 Core — show model / relationships / attachments (`packages/core/src/task/show.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 34 | discoverAttachments (core) | object_fatal (EACCES dir) | refuse — throws (unreadable ≠ empty) instead of returning [] | show.test.ts: reports an unreadable attachments directory rather than an empty one | REL-49 |
| 35 | discoverAttachments (core) | absent dir | no-op — returns [] when dir does not exist | show.test.ts: still returns [] when the directory does not exist | — |
| 36 | buildShowModel rel (core) | dangling + object_fatal (unparseable target) | degrade — edge missing:true rather than failing the page | show.test.ts: marks a link to an unparseable task as missing rather than failing the page | A139 |
| 37 | buildShowModel rel (core) | wrong_type (target title) | degrade — edge targetCorrupt:true, missing:false, keeps resolvedKey | show.test.ts: marks a resolved-but-corrupt target as corrupt, not missing | A139 |
| 38 | buildShowModel rel (core) | object_fatal (unreadable target) | degrade — edge missing:true AND targetCorrupt:true (exists-but-unreadable, not deleted) | show.test.ts: marks an unreadable (object-fatal) target as missing AND corrupt | A139 |
| 39 | buildShowModel rel (core) | dangling (absent target) | degrade — missing:true, targetCorrupt undefined (absent ≠ unreadable) | show.test.ts: leaves a genuinely-absent target missing but not corrupt | A139 |
| 40 | buildShowModel rel (core) | healthy control | no-op — healthy target resolves (missing:false, resolvedKey set) | show.test.ts: still resolves a healthy link target | A139 |
| 41 | buildShowModel (core) | object_fatal (attachments dir EACCES) | degrade only the section — task survives, attachments:[], attachmentsError set | show.test.ts: degrades only the attachments section when the directory is unreadable | REL-49 |
| 42 | buildShowModel (core) | error-attribution control | no-op — no attachmentsError when dir reads fine | show.test.ts: carries no attachmentsError when the directory reads fine | — |
| 43 | buildShowModel rel (core) | dangling (target gone) | degrade — edge missing:true | show.test.ts: marks relationship targets as missing when the task is gone | — |

### 1.5 Core — state.yaml (`packages/core/src/state/state.test.ts`)

state.yaml is **object-fatal by nature** (key-counter integrity); the guarantee is a well-attributed throw.

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 44 | state.yaml (core) | missing_required (keys root) | refuse — StateError "keys is required (expected record)" | state.test.ts: throws on missing keys object | — |
| 45 | state.yaml (core) | invalid_value (non-positive next_number) | refuse — "keys.task.next_number must be >= 1" | state.test.ts: throws on non-positive next_number | — |
| 46 | state.yaml (core) | missing_required (prefix) | refuse — "keys.task.prefix is required (expected string)" | state.test.ts: throws on missing prefix | — |
| 47 | state.yaml (core) | object_fatal (non-object root) | refuse — StateError | state.test.ts: throws on non-object root | — |
| 48 | state.yaml (core) | object_fatal (attribution) | refuse & name the file ("state.yaml is not valid:") | state.test.ts: names the file in the message so the user knows what to fix | — |
| 49 | state.yaml (core) | object_fatal (error attribution) | refuse code `config_invalid` + dataState `not_saved`, not a 500 fallback | state.test.ts: carries the config_invalid code, not the unknown/500 fallback | — |
| 50 | state.yaml (core) | object_fatal (malformed YAML) | refuse — wraps parser error as config_invalid naming state.yaml | state.test.ts: attributes malformed YAML instead of leaking a raw parser error | — |

### 1.6 Core — user profile (`packages/core/src/users/profile.test.ts`)

Only `id` is object-fatal; everything else degrades into `health`.

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 51 | user profile (core) | object_fatal (missing id) | refuse — throws "id is required" | profile.test.ts: rejects a missing id (object-fatal) | — |
| 52 | user profile (core) | object_fatal (blank id) | refuse — UserProfileError | profile.test.ts: rejects a blank id (object-fatal) | — |
| 53 | user profile (core) | object_fatal (non-object payload) | refuse — throws (no record to degrade) | profile.test.ts: rejects a non-object payload (no record to degrade around) | — |
| 54 | user profile (core) | wrong_type (unknown timezone) | degrade → health `wrong_type`, raw preserved | profile.test.ts: degrades an unknown timezone into health, keeping the user loadable | — |
| 55 | user profile (core) | wrong_type (invalid email) | degrade → health `wrong_type`, raw preserved | profile.test.ts: degrades an invalid email into health | — |
| 56 | user profile (core) | missing_required (empty name) | degrade → health, raw "" preserved | profile.test.ts: degrades an empty name into health (missing_required semantics) | — |
| 57 | user profile (core) | missing_required (absent timezone) | degrade → health `missing_required` | profile.test.ts: degrades an absent required field (timezone) as missing_required | — |
| 58 | user profile (core) | unrecognised (phone) | degrade → health `unrecognised`, value preserved | profile.test.ts: degrades an unknown key into health (unrecognised), preserving its value | — |
| 59 | user profile (core) | wrong_type (path-traversal avatar) | degrade → health `wrong_type`, raw verbatim | profile.test.ts: degrades a path-traversal avatar into health rather than fatalling | — |
| 60 | user profile (core) | preserve (round-trip: corrupt tz + unknown key) | preserve — load→save re-emits raw values, both survive | profile.test.ts: re-emits a corrupt field's raw value so a load → save does not drop it | — |

### 1.7 Core — user settings (`packages/core/src/users/settings.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 61 | user settings (core) | wrong_type (theme:42) | degrade — drop bad key to default, keep rest loadable | settings.test.ts: degrades a wrong-typed known key (theme: 42) to default, keeping the rest | — |
| 62 | user settings (core) | wrong_type (card_layout) | degrade — drop bad key, no throw, sibling survives | settings.test.ts: degrades a wrong-typed card_layout without throwing | — |
| 63 | user settings (core) | preserve (passthrough + corrupt known key) | preserve — unknown keys survive even when a known key is corrupt | settings.test.ts: preserves unknown passthrough keys even when a known key is corrupt | — |
| 64 | user settings (core) | preserve (all-healthy passthrough) | preserve — unknown key passes through | settings.test.ts: preserves an unknown key when everything typed is healthy | — |

### 1.8 Core — config loaders (per-entry `BrokenEntry` degradation)

Files: `projects.test.ts`, `labels.test.ts`, `milestones.test.ts`, `sprints.test.ts`,
`calendar.test.ts`, `list-view.test.ts`, `workflow.test.ts`, `queries.test.ts`,
`health.test.ts`. Pattern (A138): a corrupt **entry** degrades to `broken`, the
rest loads; **object-fatal shape** (non-array root, bad YAML, unknown top-level
key, cross-entry duplicate ids) still refuses; `broken` is omitted (not `[]`)
when clean.

#### projects.yaml (`packages/core/src/config/projects.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 65 | unrecognised (top-level `extra:`) | refuse — /unrecognized key/ | projects.test.ts: rejects unknown top-level keys | — |
| 66 | unrecognised (per-entry key) | degrade → BrokenEntry; rest load | projects.test.ts: degrades a project with an unknown key to a broken entry (was object-fatal) | A138 |
| 67 | missing_required (empty prefix) | degrade → broken; projects empty, broken names it | projects.test.ts: degrades a project with an empty prefix to a broken entry | A138 |
| 68 | missing_required (empty id) | degrade → broken | projects.test.ts: degrades a project with an empty id to a broken entry | A138 |
| 69 | missing_required (empty name) | degrade → broken | projects.test.ts: degrades a project with an empty name to a broken entry | A138 |
| 70 | dangling (ghost default) | preserve — parses, keeps ghost id (drift not error) | projects.test.ts: tolerates a default that doesn't reference any project (K23 / NEW-20) | K23 |
| 71 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged projects.yaml | projects.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |
| 72 | wrong_type (name:123 / prefix:[]) | drop bad element → broken; valid load | projects.test.ts: loads valid projects and sets a corrupt one aside as broken | A138 |
| 73 | none (all valid) | no-op — broken omitted | projects.test.ts: omits `broken` entirely when every project is valid | A138 |
| 74 | broken entry w/ unreadable id | degrade — broken carries index though id undefined | projects.test.ts: degrades even a corrupt entry that carries no readable id | A138 |
| 75 | wrong_type (sole entry corrupt) | degrade — broken names it, not "no projects" | projects.test.ts: degrades even when EVERY project entry is corrupt (a broken project is not 'no projects') | A138 |
| 76 | missing_required (zero entries) | refuse — /at least one/ | projects.test.ts: still throws 'at least one project' when the file has ZERO entries (valid or broken) | A138 |
| 77 | object_fatal (duplicate prefix, valid entries) | refuse — /duplicate project prefix/ | projects.test.ts: keeps object-fatal cross-entry checks throwing (duplicate prefix among VALID entries) | A138 |
| 78 | unrecognised (stray hand-edited `broken:`) | refuse — /unrecognized key/ | projects.test.ts: rejects a stray `broken:` key in the file (load-time diagnostic, not on-disk) | — |
| 79 | object_fatal (duplicate ids) | refuse — /duplicate project id/ | projects.test.ts: rejects duplicate ids | — |
| 80 | object_fatal (duplicate prefixes) | refuse — /duplicate project prefix/ | projects.test.ts: rejects duplicate prefixes | — |
| 81 | missing_required (empty list) | refuse — ProjectsConfigError | projects.test.ts: rejects an empty projects list | — |
| 82 | missing_required (empty array) | refuse — /at least one/ | projects.test.ts: rejects an empty projects array | — |

#### labels.yaml (`packages/core/src/config/labels.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 83 | missing_required (empty name) | degrade → broken (index 0, id named) | labels.test.ts: degrades a label with an empty name to a broken entry | A138 |
| 84 | missing_required (empty id) | degrade → broken (no id on marker) | labels.test.ts: degrades a label with an empty id to a broken entry (no id on the marker) | A138 |
| 85 | invalid_value (malformed hex color) | preserve entry, drop only the color | labels.test.ts: keeps a label whose hex color is malformed, dropping only the color | MSL-22 |
| 86 | invalid_value (8-digit hex / alpha) | preserve entry, drop the color | labels.test.ts: drops an 8-digit hex color rather than rejecting the file (no alpha support) | MSL-22 |
| 87 | wrong_type (archived:"yes") | degrade → broken | labels.test.ts: degrades a label with a wrong-typed archived field to a broken entry | A138 |
| 88 | wrong_type (archived:"yes" + valid) | drop bad element → broken; valid loads (raw preserved) | labels.test.ts: loads a valid label beside a structurally-corrupt one | A138 |
| 89 | none (all valid) | no-op — broken omitted | labels.test.ts: omits broken (does not set []) when every entry parses | A138 |
| 90 | object_fatal (duplicate ids) | refuse — /duplicate label id/ | labels.test.ts: rejects duplicate ids | — |
| 91 | unrecognised (top-level `extra:`) | refuse — /unrecognized key/ | labels.test.ts: rejects unknown top-level keys | — |
| 92 | unrecognised (per-label `description:`) | degrade → broken (/unrecognized key/) | labels.test.ts: degrades a label with an unknown per-label key to a broken entry | A138 |
| 93 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged labels.yaml | labels.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |

#### milestones.yaml (`packages/core/src/config/milestones.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 94 | invalid_value (malformed target_date) | degrade → BrokenEntry (/YYYY-MM-DD/); rest load | milestones.test.ts: degrades a malformed target_date to a BrokenEntry (does not throw) | A138 |
| 95 | object_fatal (duplicate ids) | refuse — /duplicate milestone id/ | milestones.test.ts: rejects duplicate ids | — |
| 96 | missing_required (empty name) | degrade → BrokenEntry (id named) | milestones.test.ts: degrades an empty name to a BrokenEntry (does not throw) | A138 |
| 97 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged milestones.yaml | milestones.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |
| 98 | object_fatal (milestones not a list) | refuse — MilestonesConfigError | milestones.test.ts: throws when milestones is not a list (object-fatal) | — |
| 99 | invalid_value (bad target_date + valid) | drop bad element → broken; valid load | milestones.test.ts: loads valid milestones and sets a corrupt one aside instead of throwing | A138 |
| 100 | none (all valid) | no-op — broken omitted | milestones.test.ts: omits broken (does not set it to []) when every entry parses | A138 |
| 101 | wrong_type (name:42) | degrade; preserve corrupt entry raw text | milestones.test.ts: preserves the raw text of a corrupt entry rather than dropping it | K27 |

#### sprints.yaml (`packages/core/src/config/sprints.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 102 | invalid_value (malformed start_date) | degrade → broken (/YYYY-MM-DD/) | sprints.test.ts: degrades a malformed start_date to `broken` | A138 |
| 103 | invalid_value (end before start) | degrade → broken (names ordering) | sprints.test.ts: degrades an end_date-before-start_date entry to `broken` | A138 |
| 104 | invalid_value (unknown state) | degrade → broken | sprints.test.ts: degrades an unknown state to `broken` | A138 |
| 105 | object_fatal (duplicate ids) | refuse — /duplicate sprint id/ | sprints.test.ts: rejects duplicate sprint ids | — |
| 106 | unrecognised (per-sprint `velocity:`) | degrade → broken (/velocity/) | sprints.test.ts: degrades a sprint with an unknown per-sprint key to `broken` | A138 |
| 107 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged sprints.yaml | sprints.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |
| 108 | invalid_value (bad start + valid) | drop bad element → broken; valid load | sprints.test.ts: degrades one corrupt sprint to `broken` while valid ones load | A138 |
| 109 | invalid_value (end<start per-entry superRefine) | drop bad element → broken; valid load | sprints.test.ts: degrades an end_date-before-start_date entry (per-entry superRefine) | A138 |
| 110 | unrecognised (velocity + valid) | drop bad element → broken (/velocity/); valid loads | sprints.test.ts: degrades an entry with an unknown key rather than blanking the file | A138 |
| 111 | none (all valid) | no-op — broken omitted | sprints.test.ts: omits `broken` entirely when every entry is valid | A138 |
| 112 | object_fatal (sprints not an array) | refuse — SprintsConfigError | sprints.test.ts: throws when `sprints` is not an array | — |
| 113 | unrecognised (top-level `extraneous:`) | refuse — /unrecognized key/ | sprints.test.ts: throws on an unknown top-level key | — |
| 114 | object_fatal (duplicate ids among valid) | refuse — /duplicate sprint id/ | sprints.test.ts: still throws on duplicate ids among valid entries (object-fatal) | A138 |

#### calendar.yaml (`packages/core/src/config/calendar.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 115 | missing_required (holidays absent) | refuse — CalendarConfigError | calendar.test.ts: requires holidays to be present | — |
| 116 | invalid_value (unknown timezone) | refuse — /timezone/ | calendar.test.ts: rejects an unknown timezone | — |
| 117 | invalid_value (first_day_of_week out of range) | refuse — /first_day_of_week/ | calendar.test.ts: rejects a weekday out of 0..6 range | — |
| 118 | invalid_value (working_days entry not a weekday) | refuse — /working_days\[1\]/ | calendar.test.ts: rejects a working_days entry that's not a weekday | — |
| 119 | invalid_value (malformed holiday date) | degrade → BrokenEntry (/YYYY-MM-DD/); rest kept | calendar.test.ts: degrades a holiday with a malformed date to a BrokenEntry, keeping the rest | A138 |
| 120 | missing_required (empty holiday label) | degrade → BrokenEntry (/label must be a non-empty string/) | calendar.test.ts: degrades a holiday with an empty label to a BrokenEntry | A138 |
| 121 | none (all valid) | no-op — broken omitted | calendar.test.ts: omits `broken` when every holiday parses | A138 |
| 122 | object_fatal (holidays not a list) | refuse — CalendarConfigError | calendar.test.ts: keeps a wholly non-array holidays value object-fatal | — |
| 123 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged calendar.yaml | calendar.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |

#### list-view.yaml (`packages/core/src/config/list-view.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 124 | wrong_type / duplicate (visible:[status,status]) | refuse — ListViewConfigError | list-view.test.ts: throws ListViewConfigError with a helpful message on duplicates | — |
| 125 | invalid_value (visible/hidden overlap) | refuse — /both visible and hidden/ | list-view.test.ts: throws on visible/hidden overlap | — |
| 126 | wrong_type (number 5 in visible) | drop bad element → broken; good keys load | list-view.test.ts: degrades a non-string chip key to a broken entry, keeps the good ones | A138 |
| 127 | invalid_value (empty-string chip key) | drop bad element → broken | list-view.test.ts: degrades an empty-string chip key to a broken entry | A138 |
| 128 | wrong_type (bad entries in both arrays) | drop bad elements; collect 2 broken | list-view.test.ts: collects broken entries from both visible and hidden | A138 |
| 129 | none (all valid) | no-op — broken omitted (≠ []) | list-view.test.ts: omits `broken` entirely when every entry parses (distinct from []) | A138 |
| 130 | object_fatal (visible not an array) | refuse — ListViewConfigError | list-view.test.ts: keeps a malformed outer structure object-fatal (visible not an array) | — |
| 131 | unrecognised (top-level `bogus:`) | refuse — ListViewConfigError | list-view.test.ts: keeps an unknown top-level key object-fatal | — |
| 132 | unrecognised (stray hand-edited `broken:`) | refuse — ListViewConfigError | list-view.test.ts: still rejects a stray hand-edited `broken:` key (loader owns it) | — |
| 133 | object_fatal (duplicate within array + degradable) | refuse — /duplicate entry 'status' in visible/ | list-view.test.ts: keeps duplicate-within-array object-fatal even alongside a degradable entry | — |
| 134 | broken_config_entry (schema-violating on save) | refuse on save (validation re-applied) | list-view.test.ts: rejects malformed config on save (validation re-applied) | — |
| 135 | dangling (removed custom-field keys in visible) | drop bad element (prune) | list-view.test.ts: drops removed field keys from visible | — |
| 136 | dangling (removed keys in hidden) | drop bad element; collapse empty filters | list-view.test.ts: drops removed field keys from hidden | — |
| 137 | dangling (both arrays emptied) | collapse whole filters block | list-view.test.ts: collapses the whole filters block when both arrays become empty | — |
| 138 | dangling (visible emptied by pruning) | collapse to absent-form default | list-view.test.ts: collapses a visible array that became empty (returns to default) | — |

#### workflow.yaml (`packages/core/src/config/workflow.test.ts`)

Note the **strict vs tolerant** axis: strict mode (the write gate) refuses; tolerant mode (the read path) degrades to per-sub-list `broken`.

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 139 | missing_required (custom_fields absent) | refuse — WorkflowConfigError | workflow.test.ts: rejects files missing custom_fields | — |
| 140 | missing_required (key.prefix absent) | refuse — WorkflowConfigError | workflow.test.ts: throws on missing key.prefix | — |
| 141 | invalid_value (bad status category, STRICT) | refuse — names allowed categories | workflow.test.ts: throws on an invalid status category in strict mode (the write gate) | — |
| 142 | invalid_value (bad status category, TOLERANT) | degrade → broken.statuses; valid load | workflow.test.ts: degrades an invalid status category to a broken entry in tolerant mode | A138 |
| 143 | invalid_value (bad custom-field type, STRICT) | refuse — names allowed types | workflow.test.ts: throws on an invalid custom field type in strict mode | — |
| 144 | invalid_value (bad custom-field type, TOLERANT) | degrade → broken.custom_fields | workflow.test.ts: degrades an invalid custom field type to a broken entry in tolerant mode | A138 |
| 145 | object_fatal (non-object root) | refuse — WorkflowConfigError | workflow.test.ts: throws on non-object root | — |
| 146 | missing_required (statuses array absent) | refuse — "statuses is required (expected array)" | workflow.test.ts: throws on missing statuses array | — |
| 147 | missing_required (custom_enum without preset_values) | refuse — /preset_values is required/ | workflow.test.ts: rejects custom_enum without preset_values | — |
| 148 | missing_required (custom_numeric without unit_label) | refuse — /unit_label is required/ | workflow.test.ts: rejects custom_numeric without unit_label | — |
| 149 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged workflow.yaml | workflow.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |
| 150 | invalid_value (corrupt status mid-list, TOLERANT) | drop bad element → broken.statuses; valid load | workflow.test.ts: degrades one corrupt status to broken and keeps the good statuses resolvable | A138 |
| 151 | wrong_type (value:not_a_number on priority, TOLERANT) | degrade; preserve corrupt entry raw text | workflow.test.ts: preserves the corrupt entry's raw text rather than dropping it | K27 |
| 152 | mixed (scalar in task_types + missing inverse, TOLERANT) | degrade per sub-list, per-list indices; untouched lists absent | workflow.test.ts: groups corruption by sub-list, keeping per-list indices | A138 |
| 153 | none (all valid, both modes) | no-op — broken omitted | workflow.test.ts: omits `broken` entirely when every entry parses (both modes) | A138 |
| 154 | wrong_type (value:not_a_number, STRICT vs TOLERANT) | STRICT refuses (/priorities\[0\].*weird/); tolerant degrades | workflow.test.ts: strict mode (default) throws on a per-entry fault — the write gate contract | — |
| 155 | invalid_value (only default:true status corrupt, TOLERANT) | degrade; skip default-count check; still loads | workflow.test.ts: does not blank the workflow when the ONLY default status is corrupt | A138 |
| 156 | invalid_state (zero defaults) | refuse — /exactly one status with 'default: true'/ | workflow.test.ts: still throws when statuses are ALL valid but have zero defaults | — |
| 157 | invalid_state (two defaults) | refuse — /exactly one status .* but 2/ | workflow.test.ts: still throws when statuses are ALL valid but have two defaults | — |
| 158 | object_fatal (statuses not a list) | refuse — no collection to degrade | workflow.test.ts: keeps a non-array sub-list object-fatal (no collection to degrade) | — |
| 159 | invalid_value (scalar estimation unit) | refuse — object-fatal single record | workflow.test.ts: keeps a malformed scalar `estimation` object-fatal (single record, not a list) | — |
| 160 | unrecognised (top-level `surprise:`) | refuse — object-fatal | workflow.test.ts: keeps an unknown top-level key object-fatal | — |
| 161 | wrong_type (key not a record) | refuse — object-fatal, identity-bearing | workflow.test.ts: keeps a malformed `key` object-fatal (identity-bearing) | — |

#### queries.yaml (`packages/core/src/config/queries.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 162 | missing_required (queries array absent) | refuse — "queries is required (expected array)" | queries.test.ts: throws on missing queries array | — |
| 163 | missing_required (query id absent) | refuse — QueriesConfigError | queries.test.ts: throws on missing query id | — |
| 164 | missing_required (query name absent) | refuse — "queries[0].name is required" | queries.test.ts: throws on missing query name | — |
| 165 | invalid_value (bad sort direction) | refuse — names allowed directions | queries.test.ts: throws on invalid sort direction | — |
| 166 | object_fatal (non-object root) | refuse — QueriesConfigError | queries.test.ts: throws on non-object root | — |
| 167 | broken_config_entry (unparseable DSL) | degrade → broken marker (id/name/query/index/error/position) | queries.test.ts: collects an unparseable query as a broken marker instead of throwing | A118 |
| 168 | broken_config_entry (invalid DSL + valid) | drop bad element → broken; healthy loads | queries.test.ts: keeps a healthy entry sitting next to a broken one (one bad row never blanks the view) | A118 |
| 169 | broken_config_entry (serialize) | drop on write — serialize omits broken; never leaks to disk | queries.test.ts: is not written back to disk (serialize drops the broken marker) | A118 |
| 170 | object_fatal (duplicate id even when broken) | refuse — /duplicate query id/ | queries.test.ts: still throws QueriesConfigError on a duplicate id even when a query is broken (object-fatal) | — |
| 171 | object_fatal (malformed YAML) | refuse — YamlSyntaxError tagged queries.yaml | queries.test.ts: throws YamlSyntaxError on malformed YAML (tagged with file label) | — |
| 172 | unrecognised (unknown field in display) | refuse — strict | queries.test.ts: rejects unknown fields inside display (strict) | — |

#### health.ts — generalized per-entry collector (`packages/core/src/config/health.test.ts`)

| # | KIND | asserts | file:testname | decision |
|---|---|---|---|---|
| 173 | wrong_type (n:"not-a-number") | drop bad element → BrokenEntry (id/index/error/rawText); valid load | health.test.ts: collects valid entries and sets corrupt ones aside as BrokenEntry | A138 |
| 174 | missing_required (id absent) | degrade — BrokenEntry named by index, id undefined | health.test.ts: names a corrupt entry by index even when its id is unreadable | A138 |
| 175 | none (all valid) | no-op — broken length 0 | health.test.ts: an all-valid list produces no broken entries | A138 |

### 1.9 Core — git reconcile / merge (`git/reconcile-plan.test.ts`, `git/merge-malformed.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 176 | git reconcile (core) | wrong_type (priority carries health) | mark corrupt side — local side marked `corrupt` w/ rawText+error; healthy remote unmarked | reconcile-plan.test.ts: marks a conflict side as corrupt when that side's task has health on the field (Phase-7B) | — |
| 177 | git reconcile (core) | invalid_value (remote status absent from local config) | degrade & show as drift — shown raw, kept out of pick-value options | reconcile-plan.test.ts: marks a remote status absent from local config as drift, keeping it out of options (GIT-14) | GIT-14 |
| 178 | git merge (core) | malformed_history (map instead of list) | refuse — unresolved (0 merged, 1 unresolved), both versions intact | merge-malformed.test.ts: refuses a history file that is a map rather than a list | — |
| 179 | git merge (core) | malformed_history (bare scalar) | refuse — 1 unresolved | merge-malformed.test.ts: refuses a history file that is a bare scalar | — |
| 180 | git merge (core) | malformed_history (comments map) | refuse — 0 merged, 1 unresolved (/not a list of comment/) | merge-malformed.test.ts: refuses a malformed comments file | — |
| 181 | git merge (core) | boundary (empty/comment-only → null) | no-op degrade — treated as empty list, not failure | merge-malformed.test.ts: treats an empty file as an empty list, not a failure | — |

### 1.10 Core — integrity/doctor scan (`packages/core/src/diagnostics/integrity.test.ts`)

The `malformed` (reported, non-blocking) vs `unreadable` (blocks publish) severity split.

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 182 | doctor scan (core) | malformed_history (hand-edited entry in _comments) | report non-blocking — severity `malformed`, names file + "entry 2" | integrity.test.ts: names the file and the entry position | — |
| 183 | doctor scan (core) | malformed_history (same) | preserve & reassure — /kept in place/i | integrity.test.ts: says the entry is preserved, so the user is not told to panic | — |
| 184 | doctor scan (core) | malformed_history (same) | does not block publish — blockingFindings empty | integrity.test.ts: is not blocking | — |
| 185 | doctor scan (core) | malformed_history (unrecognised kind in _history) | report — 1 finding, `malformed`, "history entry 2" | integrity.test.ts: reports a row with an unrecognised kind | — |
| 186 | doctor scan (core) | malformed_history (unrecognised kind) | does not block publish | integrity.test.ts: does not block a publish on one | — |
| 187 | doctor scan (core) | object_fatal (_history chmod 0o000) | report & block — severity `unreadable`, 1 blocking | integrity.test.ts: reports an unreadable history file as blocking | — |
| 188 | doctor scan (core) | object_fatal (_comments chmod 0o000) | report file it could not read — path contains _comments.yaml | integrity.test.ts: reports the file it could not read | — |
| 189 | doctor scan (core) | object_fatal (_comments chmod 0o000) | blocks publish | integrity.test.ts: blocks, because a publish would mirror content nobody read | — |
| 190 | doctor scan (core) | object_fatal (unparseable comments YAML) | report unreadable & block | integrity.test.ts: reports a file that will not parse as unreadable too | — |
| 191 | doctor scan — task fm (core) | wrong_type (due_date:42) | report non-blocking `malformed` (/due_date/), no blocking | integrity.test.ts: reports a field-local corruption as non-blocking malformed | — |
| 192 | doctor scan — task fm (core) | object_fatal (unterminated task.md YAML) | report `unreadable` & block | integrity.test.ts: reports an object-fatal task.md as unreadable (blocks publish) | — |
| 193 | doctor scan (core) | mixed malformed vs unreadable | keep severities distinguishable — sorted ["malformed","unreadable"], only unreadable blocks | integrity.test.ts: reports both without collapsing them | — |

### 1.11 Core — backup / restore (`packages/core/src/backup/backup.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 194 | backup restore (core) | unrecognised (rank lifted to health) | restore verbatim — value survives byte-for-byte via health, not on frontmatter | backup.test.ts: carries every field the CSV drops, with its value, across a round trip | K27 |
| 195 | backup restore (core) | malformed_history (bad JSONL task line) | degrade & name/skip — bad line reported w/ 1-based number, rest restored | backup.test.ts: names a bad line, skips it, and restores everything else | — |
| 196 | backup restore (core) | object_fatal (unreadable dest _comments during overwrite) | preserve — file left byte-identical, does not clobber | backup.test.ts: never writes over a _comments.yaml it could not read (P-11) | P-11 |
| 197 | backup restore split (core) | broken set (numbered part missing) | refuse & write nothing — /part N is missing/, dir stays empty | backup.test.ts: refuses a partial set, names the missing part, and writes nothing | — |
| 198 | backup restore split (core) | broken set (part from a different backup) | refuse — /belongs to a different backup/ | backup.test.ts: refuses a part from a different backup | — |

### 1.12 Wire — web server API (`apps/web/src/server/*.test.ts`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 199 | GET /api/tasks/:ref (wire) | wrong_type (due_date:42) | 200-with-health — carries `health` (field/kind/rawText/repair; raw omitted); field dropped from frontmatter | server.health.test.ts: opens the task (200) and reports the corruption in `health` | K27 |
| 200 | GET /api/tasks/:ref by key (wire) | wrong_type (same) | 200 — index folds the corrupt task, resolves by key | server.health.test.ts: resolves the corrupt task by key too (the index folds it) | — |
| 201 | GET /api/tasks/:ref (wire) | healthy control | no `health` field on a healthy task | server.health.test.ts: a healthy task carries no `health` field | — |
| 202 | GET /api/workflow (wire) | missing_required (status w/o key) | refuse envelope — ≥400, config_invalid, names workflow.yaml + field "key" | server.config-errors.test.ts: names the file and the failing field | — |
| 203 | GET /api/labels (wire) | broken_config_entry (name:5, id:[]) | degrade 200-with-broken; /api/info + /api/workflow still 200 (no white-screen) | server.config-errors.test.ts: does not take down endpoints that do not read it | A138 |
| 204 | GET /api/projects (wire) | missing_required (projects:[]) | refuse envelope — names projects.yaml, "at least one project", fix `loctt project create` | server.config-errors.test.ts: reports the at-least-one-project constraint specifically | A138 |
| 205 | GET /api/projects (wire) | missing_required (entry loses prefix) | degrade 200-with-broken — good projects + broken naming entry index 0 (/prefix/); restored file has no broken | server.config-errors.test.ts: PRU-37: names the file and the offending entry when a project loses its prefix | A138 |
| 206 | GET /api/labels (wire) | none (labels:[]) | empty is success — 200, items [], total 0 | server.config-errors.test.ts: serves an empty labels list as a success | — |
| 207 | GET /api/milestones,/sprints (wire) | none (empty) | empty is success — 200, total 0 | server.config-errors.test.ts: serves empty milestones and sprints the same way | — |
| 208 | GET /api/labels (wire) | object_fatal (unclosed YAML) | refuse envelope — ≥400, names labels.yaml; /api/tasks still 200 | server.config-errors.test.ts: names the file and does not take down unrelated views | — |
| 209 | GET /api/sprints (wire) | broken_config_entry (end<start) | degrade 200-with-broken; NOT failed-fetch envelope, NOT empty; names rule; /api/tasks 200 | server.config-errors.test.ts: is distinguishable from a failed fetch and names the broken rule | A138 |
| 210 | GET /api/sprints (wire) | none (sprints:[]) | zero sprints is a state not failure — 200, total 0 | server.config-errors.test.ts: is not confused with a tracker that simply has no sprints | — |
| 211 | POST /api/tasks/:ref/set (wire) | invalid_value (unconfigured status) | refuse envelope — 400, field=status, not_saved, retry, validation_failed; disk unchanged | server.errors.test.ts: a rejected field write names the field and says the change was not saved | — |
| 212 | POST /api/tasks/:ref/set (wire) | wrong_type (bad date) | refuse envelope — 400, validation_failed, field=due_date; states YYYY-MM-DD; no ZodError leak | server.errors.test.ts: a bad date is a stated validation failure, not a serialized validator dump | — |
| 213 | POST /api/tasks (create) (wire) | wrong_type (bad date on create) | refuse envelope — 400, validation_failed, not_saved; no ZodError leak | server.errors.test.ts: a bad value on create is a stated validation failure, not a serialized validator dump | A136.1 |
| 214 | POST /api/tasks/bulk/set (wire) | dangling (unresolvable refs, partial) | degrade per-item — 200, succeeded 1 / failed 2, each failure own ref+reason; success not rolled back | server.errors.test.ts: a partly-failing bulk set names each failure with its own ref and reason | — |
| 215 | POST /api/tasks/bulk/set (wire) | dangling (all refs unresolvable) | degrade — 200, succeeded [], failed 2 | server.errors.test.ts: a bulk set that fails for every item still reports zero applied | — |
| 216 | POST /api/tasks/bulk/archive (wire) | wrong_type (refs not an array) | refuse envelope — 400, validation_failed, field=refs, no ZodError leak | server.errors.test.ts: a request-shape rejection points at the field it belongs to | — |
| 217 | GET /api/tasks/NOPE-999 (wire) | dangling (unknown ref) | refuse envelope — 404, not_found, not "unknown" | server.errors.test.ts: a known cause is reported as itself, not as the generic unknown | — |
| 218 | GET set/DELETE /api/tasks/:ref (wire) | dangling (task no longer exists) | refuse envelope — 404, not_found, not_saved, reload | server.errors.test.ts: a write against a task that no longer exists says nothing was saved | — |
| 219 | GET /api/tasks?view=ghostfield (wire) | dangling (view refs deleted custom field) | degrade & warn — view runs (200), warnings names "squad", warnings[0].field="query" | server.view-warnings.test.ts: surfaces a warning naming the unknown field rather than an empty result | — |
| 220 | GET /api/tasks?view=healthy (wire) | healthy control | no warnings on a healthy view | server.view-warnings.test.ts: leaves other saved views working and unwarned | — |
| 221 | GET /api/views (wire) | dangling (broken ghostfield view) | degrade, don't drop — broken view stays listed & editable, query returned verbatim | server.view-warnings.test.ts: keeps the broken view listed and editable rather than dropping it | VUE-22 |

### 1.13 Web UI — client rendering (`apps/web/src/client/**`)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 222 | fieldHealth view-model (UI) | wrong_type (intrinsic whole-field) | value absent, fieldHealth present, isDegraded true | fieldHealth.test.ts: fieldView › an intrinsic whole-field fault: value absent, fieldHealth present | A137.1 |
| 223 | fieldHealth view-model (UI) | dangling (extrinsic element) | value stays present AND element health co-exist; fieldHealth undefined; isDegraded true | fieldHealth.test.ts: fieldView › an extrinsic element fault: value present AND element health (co-exist) | A137.1 |
| 224 | fieldHealth view-model (UI) | dangling (multiple elements) | collects MULTIPLE element faults (length 2) | fieldHealth.test.ts: fieldView › collects MULTIPLE element faults on one field | A137.1 |
| 225 | fieldHealth view-model (UI) | boundary | isElementOf distinguishes similarly-named fields; a field is not an element of itself | fieldHealth.test.ts: fieldView › does not confuse a field with a similarly-named one (boundary) | A137.1 |
| 226 | fieldHealth view-model (UI) | unrecognised | unrecognisedHealth returns only unrecognised-kind entries | fieldHealth.test.ts: fieldView › unrecognisedHealth returns only unrecognised-kind entries | A135.1 |
| 227 | fieldHealth view-model (UI) | healthy control | value present, no health, isDegraded false | fieldHealth.test.ts: fieldView › a healthy field: value present, no health | A137.1 |
| 228 | list cell AssigneeCell (UI) | dangling (deleted user) | truncated-ULID tail + "(deleted user)"; not blank/full ULID/"unknown user" | cells.test.tsx: AssigneeCell › degrades a dangling user reference to truncated-ULID + (deleted user) | K21, K22 |
| 229 | list cell AssigneeCell (UI) | dangling (deleted user) | only the 6-char tail, never the whole 26-char ULID | cells.test.tsx: AssigneeCell › shows only the truncated tail, never the whole ULID | K22, A123 |
| 230 | list cell AssigneeCell (UI) | healthy control | live user by name, no marker, no ULID leak | cells.test.tsx: AssigneeCell › renders a live user by name with no degraded marker | — |
| 231 | list cell AssigneeCell (UI) | other (archived user) | name + "(archived)", not the deleted form | cells.test.tsx: AssigneeCell › renders an archived user by name + (archived), not the deleted form | — |
| 232 | list cell AssigneeCell (UI) | none (unset ref) | dash, no "deleted user" | cells.test.tsx: AssigneeCell › renders a dash when the reference is unset | — |
| 233 | list cell StatusBadge (UI) | wrong_type (whole-field intrinsic) | rawText "42" + "(broken)" + `field-health-status` testid, not em-dash | cells.test.tsx: cell corruption markers › StatusBadge with no value but a health finding shows the raw text + (broken), not a dash | A137.1 |
| 234 | list cell StatusBadge (UI) | wrong_type (co-existing value + element) | value "In progress" AND "(broken)" marker + testid | cells.test.tsx: cell corruption markers › StatusBadge with a valid value AND a health finding shows the value and the marker | A137.1 |
| 235 | list cell StatusBadge (UI) | healthy control | no "(broken)" marker, no testid | cells.test.tsx: cell corruption markers › a clean cell (no health) renders no broken marker | — |
| 236 | list cell Priority/Type (UI) | wrong_type (whole-field intrinsic) | raw "99"/"true" + "(broken)" | cells.test.tsx: cell corruption markers › PriorityCell and TypeBadge with no value but a health finding show the raw + (broken) | A137.1 |
| 237 | list cell AssigneeCell (UI) | wrong_type (co-existing element fault) | name "Ken" AND "(broken)" marker | cells.test.tsx: cell corruption markers › AssigneeCell with a resolved user AND a health finding shows the name and the marker | A137.1 |
| 238 | list columns (UI) | broken_config_entry (stale list_columns) | drop unknown column ids | columns.test.ts: resolveColumns › drops unknown column ids from a stale setting | — |
| 239 | list columns (UI) | broken_config_entry (resolves to nothing) | fall back to defaults | columns.test.ts: resolveColumns › falls back to defaults when the setting resolves to nothing | — |
| 240 | list columns (UI) | wrong_type (non-array list_columns) | ignore, fall back to defaults | columns.test.ts: resolveColumns › ignores a non-array list_columns | — |
| 241 | board card (UI) | missing_required (untitled → key) | fall back to key, never a blank title | BoardCard.test.tsx: › falls back to the key for an untitled task, never a blank title | K26 |
| 242 | board card (UI) | wrong_type (title in health) | ⚠ marker + key in its place | BoardCard.test.tsx: › marks a corrupt title (lifted into health) with ⚠ and shows the key | K26, A137.1 |
| 243 | board card (UI) | healthy control | title shown, no ⚠ | BoardCard.test.tsx: › a healthy titled card shows the title and NO marker | — |
| 244 | board card (UI) | wrong_type (whole-field status via shared cell) | "(broken)" + `field-health-status` testid + raw "99"; card stays | BoardCard.test.tsx: › a whole-field-corrupt status shows the cell's (broken) marker, card stays | A137.1 |
| 245 | board card (UI) | none (dense-layout absent field) | status w/ no value & no health renders nothing (no dash, no ⚠) | BoardCard.test.tsx: › a status field with no value and no health renders nothing (dense layout) | — |
| 246 | relationship row (UI) | healthy control | plain link, no corrupt/broken marker | RelationshipRow.test.tsx: › renders a healthy target as a plain link with no corrupt marker | A139 |
| 247 | relationship row (UI) | object_fatal (resolved but corrupt) | `relationship-corrupt` affordance AND keeps link; not deleted | RelationshipRow.test.tsx: › marks a resolved-but-corrupt target with a corrupt affordance AND keeps the link | A139 |
| 248 | relationship row (UI) | object_fatal (missing AND corrupt / unreadable) | reads as corrupt (with target id), not deleted / "no task with id" | RelationshipRow.test.tsx: › marks a missing-AND-corrupt (unreadable) target as corrupt, not deleted | A139 |
| 249 | relationship row (UI) | dangling (genuinely absent) | `relationship-broken` "no task with id"; distinct from corrupt | RelationshipRow.test.tsx: › renders a genuinely-absent target as the deleted broken-link treatment | A139 |
| 250 | relationship group (UI) | unrecognised (undeclared edge type) | surface under raw key, flagged `unknown`, ordered last, not dropped | group.test.ts: groupRelationships › surfaces an edge whose type workflow.yaml does not declare, under its raw key | — |
| 251 | relationship group (UI) | unrecognised (removed kind) | still renders (raw key, unknown, resolves) but NOT offered in picker | group.test.ts: groupRelationships › does not offer a removed kind in the picker while its links still render | — |
| 252 | relationship group (UI) | other (duplicate edge / file drift) | listed once with a `duplicates` count, not hidden | group.test.ts: groupRelationships › lists a duplicated edge once and says how many copies the file holds | — |
| 253 | relationship group (UI) | dangling (missing target) | row carries target id; missing:true, resolvedKey undefined; not dropped; neighbour unaffected | group.test.ts: groupRelationships › keeps a dangling edge as a row carrying its target id | A139 |
| 254 | relationship group (UI) | object_fatal (targetCorrupt threading) | targetCorrupt survives response→row mapping (falsy healthy, true corrupt) | group.test.ts: buildRows › threads targetCorrupt from the response onto the row | A139 |
| 255 | sprints view (UI) | broken_config_entry (sprint-config) | `sprints-broken-config` named by id + "(broken)" + msg; healthy column renders | SprintsView.test.tsx: A138 › surfaces a broken sprint entry, named and marked, alongside the healthy ones | A138 |
| 256 | sprints view (UI) | broken_config_entry (id unreadable) | name by position "#3" (1-based) when id unreadable | SprintsView.test.tsx: A138 › names a broken entry by position when its id could not be read | A138 |
| 257 | sprints view (UI) | broken_config_entry (corrupt-only ≠ empty) | broken notice, NOT "No sprints yet" empty state | SprintsView.test.tsx: A138 › does not read as empty when the only sprint is broken (tell broken from none) | A138 |
| 258 | sprints view (UI) | healthy control | no broken notice when every sprint parsed | SprintsView.test.tsx: A138 › shows no broken notice when every sprint parsed | A138 |
| 259 | sprints view (UI) | wrong_type (task carrying health) | task w/ due_date lifted stays in its column, no vanish/crash | SprintsView.test.tsx: corrupt task on a sprint card › keeps a task carrying health in its sprint column (does not vanish or crash) | — |
| 260 | timeline date classifier (UI) | invalid_value (unparseable start_date) | classified `invalid` w/ value verbatim, no "Invalid Date" | dateProblem.test.ts: TML-48: an unparseable start_date is reported as invalid with the value verbatim | TML-48 |
| 261 | timeline date classifier (UI) | invalid_value (ordering trap) | `invalid`, not missing/open_due | dateProblem.test.ts: TML-48: an invalid date is classified as invalid, not merely as missing | TML-48 |
| 262 | timeline date classifier (UI) | invalid_value (date-shaped non-day) | 2026-02-31 still `invalid`, not a bar | dateProblem.test.ts: TML-48: a date-shaped string that is not a real day is still invalid | TML-48 |
| 263 | timeline date classifier (UI) | missing (undated) | neither date → `undated` (baseline vs corrupt) | dateProblem.test.ts: TML-5: neither date is reported as undated | — |
| 264 | timeline date classifier (UI) | wrong_type (due_date lifted to health) | `corrupt` (not undated); note names corrupt + raw, no "Invalid Date" | dateProblem.test.ts: reports a corrupt due_date (lifted to health, absent from frontmatter) as corrupt — not undated | K27 |
| 265 | timeline date classifier (UI) | wrong_type (start_date) | `corrupt`, naming the field, with rawText | dateProblem.test.ts: reports a corrupt start_date as corrupt, naming the field | K27 |
| 266 | timeline date classifier (UI) | wrong_type (precedence) | prefers `corrupt` over value branches | dateProblem.test.ts: prefers the corrupt classification over the value branches | — |
| 267 | timeline date classifier (UI) | wrong_type (unrelated-field isolation) | corrupt title does NOT fake a date problem; only start/due count | dateProblem.test.ts: ignores health on unrelated fields — a corrupt title does not fake a date problem | — |
| 268 | timeline rows (UI) | wrong_type (corrupt-dated routing) | routed to Unscheduled lane, marked `corrupt`, ≠ undated, not dropped; fine task charts | dateProblem.test.ts: buildRows carries the problem onto the row › routes a corrupt-dated task to the Unscheduled lane, marked corrupt and NOT dropped | — |
| 269 | timeline rows (UI) | wrong_type (corrupt-dated count invariant) | counted under every grouping, no vanish | dateProblem.test.ts: buildRows carries the problem onto the row › still counts a corrupt-dated task under every grouping (no vanish) | — |
| 270 | timeline rows (UI) | invalid_value (unparseable date) | treated as no date not scheduled (guards NaN bar) | rows.test.ts: isScheduled › treats an unparseable date as no date rather than as scheduled | — |
| 271 | timeline rows (UI) | dangling (orphaned group value) | keeps a task whose group value config dropped; row not dropped, count preserved, band id kept | rows.test.ts: buildRows — grouping › keeps a task whose group value names something the config dropped | — |
| 272 | timeline rows (UI) | missing_required (nameless user → id) | band label falls back to user id; not "undefined", not dropped | rows.test.ts: buildRows — grouping › falls back to the user id when a user's name is absent | O5 |
| 273 | list view (UI) | missing_required (untitled → key) | render by key, not blank cell | ListView.test.tsx: › renders a task with no title by its key, not a blank cell | K26 |
| 274 | list view (UI) | wrong_type (row carrying health) | "(broken)" + `field-health-status` testid + raw "42" | ListView.test.tsx: › marks a degraded field on a row that carries health | A137.1 |
| 275 | list view (UI) | object_fatal (unreadable task) | surfaced in affordance ("could not be read" + reason); readable rows render; no crash | ListView.test.tsx: › still lists an unreadable task in the affordance and does not crash | — |
| 276 | list view (UI) | dangling (deleted/unknown refs) | unknown status → raw key "ghost_status"; deleted assignee → truncated tail + "(deleted user)", no full id, no "unknown user" | ListView.test.tsx: › falls back to raw values for ids/keys that no longer resolve | K21, K22 |
| 277 | list view (UI) | broken_config_entry (deleted saved view) | rows render; role=status notice names view + "no longer exists" + queries.yaml, not an alert | ListView.test.tsx: deleted saved view › renders the rows and explains that the view is gone | VUE-22 |
| 278 | list view (UI) | broken_config_entry (deleted view remediation) | X-to-remove: "Drop it from the URL" removes stale view param | ListView.test.tsx: deleted saved view › offers to drop the stale view from the URL | VUE-22 |
| 279 | list view (UI) | healthy control | no status notice when view exists | ListView.test.tsx: deleted saved view › says nothing when the view still exists | — |
| 280 | attachments panel (UI) | wrong_type (health-agnostic corrupt task) | grid/tiles/count from `attachments` alone (never reads health); no error/empty claim | AttachmentsPanel.test.tsx: S7 › renders the grid, tiles and count from attachments alone | REL-49 |
| 281 | attachments panel (UI) | none (corrupt task, empty) | empty state (not error) when corrupt task has no attachments | AttachmentsPanel.test.tsx: S7 › renders the empty state (not an error) when a corrupt task simply has no attachments | — |
| 282 | attachments panel (UI) | object_fatal (unreadable dir, REL-49) | `attachments-error` "could not be read" + error; suppresses empty claim; dropzone renders | AttachmentsPanel.test.tsx: S7 › shows the error affordance instead of the 'no attachments' claim | REL-49 |
| 283 | attachments panel (UI) | object_fatal (retry) | Retry only when onRetry supplied, and calls it | AttachmentsPanel.test.tsx: S7 › offers Retry only when onRetry is supplied, and calls it | — |
| 284 | attachments panel (UI) | object_fatal (retry) | omits Retry when no onRetry | AttachmentsPanel.test.tsx: S7 › omits Retry when no onRetry handler is given | — |
| 285 | activity/describe (UI) | invalid_value / dangling (orphaned config value) | keeps raw key "urgent" + marks drifted, not blanked; valid side renders label | describe.test.ts: orphaned config values (CMT-26) › keeps the raw key and marks it, rather than blanking it | CMT-26 |
| 286 | activity/describe (UI) | dangling (hard-deleted user) | mark drifted, show raw id | describe.test.ts: orphaned config values (CMT-26) › marks an assignee whose user was hard-deleted | CMT-26 |
| 287 | activity/describe (UI) | missing_required (present nameless user) | fall back to id (not drifted, never "undefined") | describe.test.ts: orphaned config values (CMT-26) › falls back to the id when a present user has no name (O5) | O5 |
| 288 | activity/describe (UI) | missing_required (nameless reporter) | fall back to id, never "undefined" | describe.test.ts: orphaned config values (CMT-26) › falls back to the id for a nameless reporter too (O5) | O5 |
| 289 | activity/describe (UI) | unrecognised (custom field removed from config) | mark drifted on the name (DRIFT_SUFFIX); value survives | describe.test.ts: custom_field_change (CMT-27) › marks a custom field removed from config, on the name | CMT-27 |
| 290 | activity/describe (UI) | invalid_value (undeclared enum value) | mark drifted, keep raw value | describe.test.ts: custom_field_change (CMT-27) › marks an enum value the field no longer declares | CMT-27 |
| 291 | activity/describe (UI) | dangling (unresolvable comment author) | name honestly ("Unknown user"), not by id | describe.test.ts: kinds (CMT-15) › names an unresolvable comment author honestly rather than by id | CMT-15 |
| 292 | activity/describe (UI) | invalid_value (drift on name-written value) | a value config genuinely doesn't know is marked drifted (paired negative) | describe.test.ts: key rename (CMT-29) › resolves a milestone written by name, not only by id | CMT-29 |

### 1.14 CLI / MCP surface layer (integration/format tests)

The CLI/MCP **binary** layer has almost no stored-corruption rendering tests; what exists is below. (See §4 for the parity implications.)

| # | object/surface | KIND | asserts | file:testname | decision |
|---|---|---|---|---|---|
| 293 | CLI history formatter | dangling (actor is a deleted user) | fall back to the id; never "actor unknown" | apps/cli/src/format/history.test.ts: falls back to the id when the actor is no longer a known user | O5 |
| 294 | CLI history formatter | missing_required (actor absent) | "actor unknown", distinct from "renderer dropped it" | apps/cli/src/format/history.test.ts: states that the actor is unknown rather than ending the line blank | O5 |
| 295 | CLI history formatter | invalid_value (status key no longer in workflow) | show the value + "(?)" drift marker | apps/cli/src/format/history.test.ts: marks a value whose key is no longer in the workflow config | GIT-14 |
| 296 | CLI history formatter | control (no workflow config) | raw keys unmarked (can't tell valid from drifted without config) | apps/cli/src/format/history.test.ts: renders raw keys unmarked when no workflow config is available | — |
| 297 | CLI `list --view` | dangling (saved view refs unknown custom field) | warn on stderr + still run the view (advisory, exitCode undefined) | apps/cli/src/cli.test.ts: warns on stderr and still runs the view | — |
| 298 | CLI `list --view` | healthy control | no warning for a healthy view | apps/cli/src/cli.test.ts: does not warn for a healthy view | — |
| 299 | MCP `get_task` | wrong_type (bad tool ARG, not stored data) | reject a wrong-type arg w/ field path — "ref" + "expected string". NOTE: validates the request argument, NOT rendering of a stored corrupt field | apps/mcp/src/mcp.test.ts: rejects a wrong-type arg with the field path in the error | — |
| 300 | MCP `create_task` | invalid_value (unknown status arg) | surface "Known: …" hint listing valid keys | apps/mcp/src/mcp.test.ts: create_task surfaces a 'Known: ...' hint for an unknown status | — |
| 301 | MCP list `warnings` | dangling (broken saved view) | clean body (no warnings) for a healthy view — the only MCP view-warning assertion | apps/mcp/src/mcp.test.ts: returns a clean body for a healthy view | — |

---

## 2. Behavior groups

Distinct behaviors, each with the layers where it is tested. **Layers:** Core /
Wire (web API) / Web-UI / CLI / MCP.

**B1 — Object-fatal task (bad id/key, unparseable YAML) throws an attributed `UnreadableTaskError`, blocks nothing else.**
Core: #17, #18, #36, #38. Wire: #199-201 imply the folding; #275 (UI) surfaces it. Web-UI: #275. CLI: — (no `show`/`list` binary test). MCP: —.

**B2 — A wrong-typed known field degrades: lifted off frontmatter into `health`, raw value preserved, task still loads.**
Core: #4, #14-16, #191. Wire: #199, #200. Web-UI: #233-234, #236, #242, #244, #264-265, #274. CLI: —. MCP: —.

**B3 — Preserve-others: a write to one field keeps an untouched corrupt field byte-for-byte on disk.**
Core: #9, #12, #13, #19, #27, #28, #60 (profile), #63 (settings), #194 (restore). Wire: — (no test round-trips a set over a corrupt task at the API layer). Web-UI: n/a. CLI: —. MCP: —.

**B4 — Override-on-write clears a finding (a valid write to the corrupt field repairs it).**
Core: #20, #12, #25. Wire: #205 (restored file has no broken — analogous at config layer). Web-UI: n/a (repair is a POST). CLI: —. MCP: —.

**B5 — Remove (unset) drops a corrupt/unrecognised field from health and disk.**
Core: #21, #22. Wire: — (no explicit POST /unset over a corrupt field test found). Web-UI: #278 (drop stale view param is the analogous X). CLI: —. MCP: —.

**B6 — Write guard: a write may not introduce a new finding, and may not drop an untouched corrupt field (except whole-record author).**
Core: #29, #30, #31. Wire: #213 (create with bad value refused). Web-UI: n/a. CLI: —. MCP: —.

**B7 — Derived-operation rule: an op that must READ a corrupt structural field refuses (`CorruptFieldError`).**
Core: #23, #24 (link/unlink over corrupt relationships). Wire: — (no bulk/link-over-corrupt-relationships API test). Web-UI: n/a. CLI: —. MCP: —.

**B8 — Idempotency/no-op read of a corrupt field: never refuses, never persists the corrupt value.**
Core: #25, #26 (archive/unarchive over corrupt `archived`), #32, #33 (K25 double archive). Wire: —. Web-UI: —. CLI: —. MCP: —.

**B9 — Unrecognised top-level key preserved (passthrough) and surfaced.**
Core: #5, #9, #10, #11, #13, #58 (profile), #63-64 (settings). Wire: — (no wire test asserts `unrecognised`-kind on the tasks endpoint). Web-UI: #226 (unrecognisedHealth helper). CLI: —. MCP: —.

**B10 — Untitled task falls back to its key (title degradable per K26).**
Core: #3, #8. Web-UI: #241, #242, #273. Wire: — (implied by health). CLI: —. MCP: —.

**B11 — Config loader degrades per-entry to `BrokenEntry`, rest loads, `broken` omitted when clean, object-fatal shape still refuses.**
Core: #65-175 (projects/labels/milestones/sprints/calendar/list-view/workflow/queries/health). Wire: #203, #205, #209 (broken on wire for labels/projects/sprints). Web-UI: #255-258 (sprints notice), #238-240 (list columns). CLI: —. MCP: —.

**B12 — Config object-fatal (bad YAML, non-array root, unknown top-level key, cross-entry duplicate id) refuses with a file-attributed error, without taking down unrelated endpoints.**
Core: #71, #79-82, #90-91, #93, #97-98, #105, #107, #112-114, #122-124, #130-133, #139-149, #156-172. Wire: #202, #204, #208. Web-UI: —. CLI: —. MCP: —.

**B13 — Empty is a success, distinct from broken/failed.**
Core: #73, #89, #100, #111, #121, #129, #153, #175. Wire: #206, #207, #210. Web-UI: #257 (broken ≠ empty), #263 (undated ≠ corrupt). CLI: —. MCP: —.

**B14 — Dangling reference on a scalar/edge degrades to a truncated-ULID / "(deleted user)" / missing marker, never blank, never full ULID.**
Core: #39, #43 (missing edge), #36 (unparseable target → missing). Wire: #217, #218 (not_found envelope), #219 (view warning). Web-UI: #228-229, #276 (deleted user tail), #253 (dangling edge row), #285-286 (activity drift). CLI: #293 (deleted actor → id), #297 (view warning). MCP: —.

**B15 — Relationship edge distinguishes three target states: healthy / resolved-but-corrupt / missing (absent vs object-fatal unreadable).**
Core: #37, #38, #39, #40 (A139). Wire: — (edge data on show model; no dedicated wire test isolated here). Web-UI: #246-249, #254. CLI: —. MCP: —.

**B16 — Invalid-value / workflow-drift keeps the raw key and marks it (never blanks); picker offers valid only.**
Core: #150-155 (workflow tolerant), #177 (reconcile drift). Wire: #211 (rejected on write). Web-UI: #250-251 (unknown edge type not offered), #276 (raw status key), #285, #289-290, #292 (activity drift), #295 (CLI). CLI: #295 (history "(?)"), #300 (MCP "Known:" hint). MCP: #300.

**B17 — Corrupt date distinguished from undated on the timeline (corrupt-dated routed, marked, counted, not dropped).**
Core: — (dateProblem is UI). Wire: —. Web-UI: #260-269, #270. CLI: —. MCP: —.

**B18 — Malformed sibling history/comments row: reported non-blocking `malformed`, kept in place; refused on merge; skipped on restore; distinct from object-fatal unreadable which blocks.**
Core: #178-181 (merge), #182-186 (doctor malformed), #187-193 (doctor unreadable/split), #195 (restore skip). Wire: —. Web-UI: — (the `IncompleteNotice` rendering path was NOT found asserted in the scanned client tests — see §3). CLI: —. MCP: —.

**B19 — Restore/backup: preserve dropped fields verbatim; never overwrite an unreadable destination; refuse a broken/partial set.**
Core: #194, #196, #197, #198. Wire: —. Web-UI: —. CLI: —. MCP: —.

**B20 — Attachments section degrades independently (unreadable dir ≠ empty; error affordance + retry; corrupt task's panel ignores health).**
Core: #34, #35, #41, #42 (REL-49). Web-UI: #280-284. Wire: —. CLI: —. MCP: —.

**B21 — Reconcile marks the corrupt side of a conflict (not merged as empty); drift kept out of pick options.**
Core: #176, #177. Wire: —. Web-UI: — (no reconcile-UI client test in scanned set). CLI: —. MCP: —.

**B22 — state.yaml is object-fatal by nature; the guarantee is an attributed throw (config_invalid), not a degrade.**
Core: #44-50. Wire: — (surfaces via config_invalid envelope, cf. #202). Web-UI: —. CLI: —. MCP: —.

**B23 — User profile degrades every field but `id`; settings drop bad known keys to default and preserve passthrough.**
Core: #51-64. Wire: — (no /api/users health-on-wire test in scanned set). Web-UI: — (profile/settings corruption rendering not in scanned client set). CLI: —. MCP: —.

**B24 — Saved view referencing a dropped field/entity stays listed, editable, and runs with a warning (not dropped, not empty).**
Core: — (queries loader #167-169). Wire: #219, #221. Web-UI: #277-279. CLI: #297. MCP: #301 (only asserts the healthy/clean-body control).

**B25 — Health-on-wire shape: `health` present when corrupt, omitted when clean; `raw` omitted (only rawText travels).**
Core: n/a (shape). Wire: #199-201. Web-UI: consumed by #222-227 view-model. CLI: —. MCP: — (**no test asserts `health` on `get_task`/`list_tasks` output**; #301 asserts only the clean case).

---

## 3. Decided-but-untested behaviors

Behaviors decided in a K##/A## decision or the framework docs for which the scan found **no test**.

1. **Repair provenance in history (proposal §9).** A set-over over a corrupt field must emit a `field_change`/`custom_field_change` with `before` = the raw stored value and `meta.was_corrupt = {kind,error}`, and a removal emits `after:null`. No test in `corruption-audit.test.ts` or `frontmatter.test.ts` asserts the `meta.was_corrupt` field or that `before` carries the raw (not `null`) — the audit tests assert the finding *clears*, not the history entry's provenance. **Gap.**
2. **MCP `get_task`/`list_tasks` carry `health` (proposal §6, A137).** The framework says all three surfaces carry `health`; the wire (#199-201) and core are tested, but **no MCP test asserts `health`/`rawText` in tool output** (#301 asserts only the clean-body case). **Gap.**
3. **CLI `show` "Needs attention" block + `rawText`; CLI `list` `⚠`/`(broken)` cells (proposal §6, A136.4).** The coverage map claims CLI `show`/`list` are health-aware; A136.4 records specific CLI `show` filtering (dangling relationship-target filtered, ULID truncated). **No CLI test exercises rendering a corrupt task-field's health** in `show` or `list` output. The only CLI degradation-rendering tests are the history formatter (#293-296) and the stale-view warning (#297). **Gap.**
4. **`invalid_value` / `dangling` extrinsic classification via `classifyTaskHealth` with an element-indexed `FieldHealth.field`.** A137.1 explicitly records: "No test asserts an indexed `FieldHealth.field` (`labels[2]`, `relationships[1].target`) through `classifyTaskHealth`." The UI view-model (#223-224) tests element health with hand-built fixtures, but the **core producer** (`classifyTaskHealth`) has no test generating an indexed finding. **Gap (recorded in A137.1).**
5. **Duplicate/dangling repair via `unsetField` on a dangling relationship edge = `unlinkTask` (proposal §7.3, A135.4).** Removing a dangling relationship edge should route through `unlinkTask` to keep the inverse consistent; unlink over an object-fatal target keeps the shipped refusal (A135.4). Tests cover link/unlink refusing over a *wrong-typed* relationships array (#23, #24), but none covers unsetting/removing a single *dangling* edge and verifying the inverse. **Gap.**
6. **Publish with field-local corruption is allowed, not gated (A135.2).** Doctor reports field-local as non-blocking `malformed` (#191), which implies it, but no test asserts the **publish/sync pre-flight** actually proceeds with a field-local-corrupt task present. **Partial / inferred gap.**
7. **Identity/directory mismatch (`frontmatter.id` ≠ directory name).** Proposal §2.3 lists this as an audit probe "to discover the behaviour" — explicitly unclassified. No test. **Gap by design (not a decided behavior yet).**
8. **`duplicateTask` copies healthy frontmatter only and refuses when `project` is corrupt (§13.3).** No test found in the scanned set (`corruption-audit.test.ts` rows do not include `duplicateTask`). **Gap.**
9. **`mergeTask` health union on reconcile (§13.2 B2: union of raw values, winning side's healthy value overrides).** Reconcile marks the corrupt side (#176) but no test asserts the health-**merge/union** semantics on a real 3-way merge. **Partial gap.**
10. **Config `broken` rendering for labels/milestones/projects settings panel (coverage-map §"Known boundaries").** Wire carries `broken` (#203, #205); sprints has a UI notice (#255-258); the coverage map states a settings-panel "broken entries" list for labels/milestones/projects is "a thin follow-up (the data is on the wire)" — i.e. decided-as-deferred, **no UI test**. **Gap (documented boundary).**

---

## 4. Cross-surface parity gaps

A behavior tested on one surface but not its siblings. Layers: Core / Wire / Web-UI / CLI / MCP.

| Behavior | Core | Wire | Web-UI | CLI | MCP | Gap |
|---|---|---|---|---|---|---|
| Task field-health carried in output | ✅ #14-16 | ✅ #199-201 | ✅ #222-227,#233-244,#274 | ❌ | ❌ #301 clean-only | **CLI & MCP** — neither asserts `health`/`rawText`/`(broken)` in `show`/`list`/`get_task`/`list_tasks` output. Web+core are the only surfaces proving corruption is *shown*. |
| Untitled → key fallback | ✅ #3,#8 | (implied) | ✅ #241,#273 | ❌ | ❌ | **CLI & MCP** — no test that `loctt show`/`list` or `get_task` renders the key for an untitled task. |
| Unreadable task in a list (affordance, no crash) | ✅ #16-18 | (implied) | ✅ #275 | ❌ | ❌ | **CLI & MCP** — `list` binary has no "N files could not be read" trailer test. |
| Config `broken` on the wire / UI | ✅ #65-175 | ✅ #203,#205,#209 | ✅ sprints #255-258; ❌ labels/milestones/projects panels | ❌ | ❌ | **CLI & MCP entirely; Web-UI partial** (only sprints renders `broken`). |
| Repair (set-over / unset over a corrupt field) | ✅ #19-22 | ❌ | n/a (POST) | ❌ | ❌ | **Wire, CLI, MCP** — repair through the API/`loctt set`/`loctt unset`/MCP `set_field`/`unset_field` over a corrupt field is untested at every surface layer; only core proves it. |
| Derived-op refusal (link/unlink over corrupt relationships) | ✅ #23,#24 | ❌ | n/a | ❌ | ❌ | **Wire, CLI, MCP** — `CorruptFieldError` envelope/exit-code untested at any surface. |
| Malformed-history `IncompleteNotice` rendering | ✅ #182-193 | ❌ | ❌ | ✅ #293-296 (history formatter drift) | ❌ | **Web-UI & MCP** — the coverage map claims activity shows a "malformed-history IncompleteNotice"; no such client test was found in the scanned set (`describe.test.ts` covers drift on values, not a malformed-row notice). CLI history formatter is the only rendered surface tested. |
| Bulk over an object-fatal member reports "could not be read" (not "not found") | ❌ | ❌ (#214-215 use dangling refs, not on-disk object-fatal) | n/a | ❌ | ❌ | **All surfaces** — proposal §6/§11.4 pre-registers this cell; no test seeds an object-fatal member and checks the bulk `failed` message. |
| Reconcile corrupt-side marking rendered in UI | ✅ #176,#177 | ❌ | ❌ | ❌ | ❌ | **Wire, Web-UI, CLI, MCP** — only core reconcile-plan is tested; no reconcile-UI client test. |
| Invalid-value drift marker | ✅ #150-155,#177 | partial #211 | ✅ #285,#289-290,#292 | ✅ #295 | ✅ #300 | **Best-covered cross-surface** — the one behavior with a test on core, web-UI, CLI, and MCP. |

---

## 5. KIND × OBJECT grid (tested / untested)

Rows = corruption kind. Columns = object. ✅ = at least one test seeds that kind
on that object and asserts a degradation behavior; ❌ = no such test found; — =
not applicable (the kind cannot occur on that object).

| KIND \ OBJECT | task fm | user profile | user settings | state | projects | labels | milestones | sprints | calendar | list-view | workflow | queries | history/comments | attachments |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wrong_type | ✅ #4 | ✅ #54-55,#59 | ✅ #61-62 | ✅ #47 | ✅ #72 | ✅ #87-88 | ✅ #101 | ✅ | ✅ #122 | ✅ #126-128 | ✅ #151,#154,#161 | ✅ | — | — |
| missing_required | ✅ #3,#8 | ✅ #56-57 | ❌ | ✅ #44,#46 | ✅ #67-69 | ✅ #83-84 | ✅ #96 | ❌ | ✅ #115,#120 | ❌ | ✅ #139-140,#146-148 | ✅ #162-164 | — | — |
| unrecognised | ✅ #5 | ✅ #58 | ✅ #63-64 | ❌ | ✅ #65-66 | ✅ #91-92 | ❌ | ✅ #106,#110 | ❌ | ✅ #131-132 | ✅ #160 | ✅ #172 | — | — |
| dangling | ✅ #36,#39,#43 (edges) | — | — | — | ✅ #70 (ghost default) | ❌ | ❌ | ❌ | — | ✅ #135-138 (removed field keys) | ❌ | ❌ | — | — |
| invalid_value | ✅ #150-155 (via wf) | ✅ #54 (tz) | ❌ | ✅ #45 | ❌ | ✅ #85-86 (color) | ✅ #94 (date) | ✅ #102-104 | ✅ #116-118 | ✅ #125,#127 | ✅ #141-144 | ✅ #165 | — | — |
| malformed_history | — | — | — | — | — | — | — | — | — | — | — | — | ✅ #178-193,#195 | — |
| broken_config_entry | — | — | — | — | ✅ #66-75 | ✅ #83-92 | ✅ #94-101 | ✅ #102-114 | ✅ #119-121 | ✅ #126-129 | ✅ #142,#144,#150-155 | ✅ #167-169 | — | — |
| object_fatal | ✅ #1-2,#17-18 | ✅ #51-53 | ❌ | ✅ #44-50 | ✅ #71,#77-82 | ✅ #90-91,#93 | ✅ #95,#97-98 | ✅ #105,#107,#112-114 | ✅ #122-123 | ✅ #130-133 | ✅ #145-149,#156-161 | ✅ #166,#170-171 | ✅ #187-193 | ✅ #34,#41 |

**Notable empty cells (untested KIND×OBJECT):**
- **dangling** on labels/milestones/sprints/workflow/queries: no test seeds a
  dangling *reference* (e.g. a task pointing at a deleted label id) at the
  config-object level — dangling is tested on task edges and on list-view
  removed-field-keys, but not as a config-side reference check.
- **missing_required** on user settings, sprints, list-view: no test (sprints
  has no required-scalar-missing case distinct from invalid_value; settings
  has no required field).
- **unrecognised** on milestones, calendar: no per-entry unknown-key test
  (projects/labels/sprints/workflow have one; milestones/calendar do not).
- **invalid_value / dangling** on projects: projects has no invalid-enum or
  dangling-reference degradation test (only structural broken-entry + ghost
  default).
- **object_fatal** on user settings: settings always degrades (drops bad keys);
  there is no object-fatal-settings test — arguably correct (settings has no
  identity to fatal on), but untested as a boundary.

---

## 6. Method note

Row grounding: every row cites a `file:testname` read in full by one of five
parallel extraction passes over the 39 named files plus the CLI/MCP
integration/format test files. Parameterized/table-driven tests
(`corruption-audit.test.ts` 9-column read loops; `frontmatter.test.ts` null
loops; `workflow.test.ts` strict/tolerant pairs) are recorded as single rows
with the multiplier noted, not expanded per generated case. Tests asserting
pure happy-path parse, round-trip of valid data, or unrelated operational
failures (locks, permissions, network) were excluded per the "ignore tests
unrelated to corruption/degradation" instruction; borderline no-op/identity
guards for degradation mechanisms (e.g. "omits `broken` when all valid") are
included because they define the mechanism's baseline.
