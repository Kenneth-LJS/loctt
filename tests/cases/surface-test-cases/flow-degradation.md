# Flow: data degradation (CLI & MCP)

The CLI/MCP halves of the corruption-handling behaviour whose web + core
side is [../ui-test-cases/flow-degradation.md](../ui-test-cases/flow-degradation.md).
These sit here, not in the UI tree, because `ui-test-cases/` is web-UI
only — the CLI and MCP appear there only where they collide with the UI.
A case tagged `CLI MCP` is one requirement verified twice; its bullets
say where the two surfaces must agree and where they may legitimately
differ (exit code vs `isError`, flag vs parameter).

No milestone tags — the CLI and MCP already exist, so these are
scheduled by severity.

### DEG-C1 · major · P5 P10 · CLI MCP
**Health travels through the CLI/MCP task shape only when present, and the raw object never leaks.** Read a corrupt and a clean task through `loctt show`/`list` and MCP `get_task`/`list_tasks`.

- The MCP `get_task`/`list_tasks` output carries `health` when the task is corrupt and omits it when clean — matching the wire shape (DEG-23); `raw` is never sent (only `rawText`).
- An object-fatal task attributes as unreadable, not "not found": MCP `list_tasks` reports it in an `unreadable[]` list, `get_task` returns an error envelope, and CLI `list` prints a trailer "N files could not be read: <path>: <reason>".
- Known gap: no CLI or MCP test yet exercises corrupt-field health rendering or the unreadable affordance — only healthy-view controls are covered. Needs new tests.

### DEG-C2 · major · P5 P10 · CLI MCP
**An untitled task shows its key on the CLI and MCP, never a blank.** Read a task with no title through `loctt show`/`list` and MCP `get_task`/`list_tasks`.

- Each renders the key where the title would go — never blank, never "undefined" — matching the UI (DEG-8).
- Known gap: not covered by any CLI/MCP test. Needs new tests.

### DEG-C3 · major · P5 P10 · CLI MCP
**A broken config entry is surfaced by `list`, never read as "none".** Hand-break one sprint/label/milestone/project entry, then run `sprint list` / `label list` / `milestone list` / `project list` and the MCP twins.

- The broken entry is named and marked in the listing, distinct from an empty list — one broken sprint must not read as "no sprints".
- The CLI already renders a `broken` list for saved views (`views.ts`); the other list commands and their MCP twins render only valid entries, so a broken entry is currently invisible on two of three surfaces.
- Known gap: needs new tests for `sprint`/`label`/`milestone`/`project` list on CLI and MCP.

### DEG-C4 · major · P5 P7 P10 · CLI MCP
**Repair and derived-op refusal reach the CLI/MCP as clear outcomes, not stack traces.** Over an on-disk corrupt task: repair a field with `loctt set` / MCP `set_field`, unset one with `unset` / `unset_field`, and attempt a derived op (`link`) that must read a corrupt structural field.

- A valid `set` over a corrupt field repairs it and an `unset` removes it, matching core (DEG-4); an untouched corrupt sibling is preserved (DEG-3).
- A derived op that must read a corrupt field refuses with a corrupt-field error naming the field (DEG-6). The two surfaces may differ in *how* they signal failure — CLI a non-zero exit code, MCP an `isError` envelope — but both name the field and neither emits a bare 500/stack trace.
- Known gap: no CLI/MCP test round-trips a set/unset or a derived-op refusal over an on-disk corrupt task. Needs new tests.

### DEG-C5 · major · P5 P10 · CLI MCP
**The CLI/MCP relationship display mirrors the four target states.** Read a task whose links target a healthy, corrupt-but-present, unreadable, and genuinely-absent task.

- The display distinguishes healthy / ⚠ corrupt-but-present / corrupt-unreadable / broken-link-no-task, matching core `show` and the UI (DEG-15).
- Known gap: not covered by any CLI/MCP test. Needs new tests.

### DEG-C6 · major · P5 P10 · CLI MCP
**A workflow-drifted value keeps its raw key and is marked on both surfaces.** Read a task whose status/priority key is no longer in `workflow.yaml`, and create a task naming an unknown status.

- The CLI marks a value whose key is no longer in the workflow config (rather than blanking it), and renders raw keys unmarked when no workflow config is available.
- The MCP `create_task` surfaces a `Known: …` hint for an unknown status and forwards a valid-shape-but-workflow-invalid value to the validator — the same drift-surfacing requirement as the UI (DEG-16).
- This behaviour is already tested (see the tags below); the case exists to cite it, not to flag a gap.

### DEG-C7 · major · P5 P6 P10 · CLI MCP
**A malformed history/comment is reported incomplete through the CLI/MCP, not silently shortened.** Read the history of a task with a hand-broken `history.jsonl` row through the CLI and MCP.

- The output carries the incomplete count ("N entries could not be read"), matching the web activity feed (DEG-18), and keeps the readable rows.
- Known gap: the MCP `get_history`/comments output carrying the incomplete count is not tested. Needs a new test.

### DEG-C8 · major · P5 P9 P10 · CLI MCP
**A bulk op over a corrupt member reports it as failed-because-unreadable, not as "not found".** Run a bulk set/archive whose member set includes a field-local-corrupt task and an object-fatal one.

- A per-item refusal (a derived op over a field-local-corrupt member) lands in `failed` carrying the corrupt-field error message, and the rest of the batch proceeds.
- An object-fatal member is reported "could not be read: <path>", not "not found"; a no-op member is `unchanged` (K25/BLK-27), distinct from `failed`.
- Known gap: existing bulk tests use dangling refs, not an on-disk object-fatal member. Needs new tests.
