# LocTT LLM Test Runbook

Manual test scenarios for verifying that an LLM (Claude, GPT, etc.) can drive the LocTT MCP tools correctly. Run these **after** the deterministic integration and E2E suites pass — they verify agent ergonomics, not correctness.

Each scenario is a natural-language prompt, the expected agent behavior, and an expected end-state. The LLM should figure out which MCP tools to call from its prompt; the runbook does not tell it which tools to use.

---

## When to run

- After any change to MCP tool descriptions, parameter names, or required fields.
- After adding or renaming an MCP tool.
- Before an MCP-impacting release.
- Periodically (monthly is fine) to catch description rot.

Not part of `npm test`. Run manually.

---

## Setup

1. **Build current code:**
   ```bash
   npm run build
   ```

2. **Create a fresh test workspace:**
   ```bash
   mkdir -p tests/workspace/llm-run-$(date +%Y%m%d-%H%M)
   cd tests/workspace/llm-run-<timestamp>
   git init                 # only if testing git-backed scenarios
   ../../../apps/cli/dist/index.js init
   ```

   Each run should use a fresh workspace. Don't reuse a previous run's `.loctt/` — prior tasks pollute the prompts.

3. **Wire up the MCP server in your agent host:**

   For Claude Desktop / Claude Code / Cursor, point the MCP config at the freshly built binary with `cwd` set to your test workspace. Example for Claude Code (`.mcp.json` at workspace root):
   ```json
   {
     "mcpServers": {
       "loctt": {
         "command": "node",
         "args": ["<repo>/apps/cli/dist/index.js", "mcp"],
         "cwd": "<test-workspace>"
       }
     }
   }
   ```

   Restart the agent host so it picks up the MCP server.

4. **Verify the agent sees the tools.** Ask the agent: *"What MCP tools do you have available for loctt?"* It should list `create_task`, `get_task`, `list_tasks`, `update_task`, `link_tasks`, etc. If the list is missing or partial, the MCP server isn't wired up correctly — fix that before continuing.

5. **Open a results log file:** `tests/llm/results/<YYYY-MM-DD>-<model>.md`. Use the template at the bottom of this doc.

6. **Cleanup at end of run:**
   ```bash
   rm -rf tests/workspace/llm-run-<timestamp>
   ```

   The whole workspace lives under `tests/workspace/` (gitignored), so removal is safe.

---

## How to run a scenario

1. Read the scenario's setup steps. If any prerequisite tasks are listed, create them via the **CLI** (not via the agent) before starting — we want the agent's tool calls scoped to the scenario itself.
2. Paste the prompt verbatim into the agent.
3. Watch which MCP tools the agent calls. Don't intervene unless the agent gets stuck or asks a question.
4. After the agent finishes, run the verification commands listed under "Expected end-state".
5. Record the result (pass/fail, tools called, notes) in the results log.

A scenario passes if **all three** hold:
- The agent called the expected tool(s) (extras are OK if they don't mutate state incorrectly).
- The arguments were semantically correct (right ref, right field, right value).
- The end-state matches the verification commands.

If any one fails, mark the scenario failed and note specifically which.

---

## Scenarios

### Scenario 1 — Create a task

**Setup:** fresh workspace, no tasks.

**Prompt:** *"Create a new task to fix the login bug."*

**Expected tools called:** `create_task` with `title` containing "login" (exact phrasing is the agent's choice).

**Expected end-state:**
```bash
loctt list
# Should show one task, key T-1, title mentions "login"
```

**Notes for verifier:** The agent might pick a status or priority on its own — that's fine as long as the values are valid for the workflow.

---

### Scenario 2 — Read a task

**Setup:** create T-1 via CLI: `loctt create "Set up CI pipeline"`.

**Prompt:** *"What does T-1 say?"*

**Expected tools called:** `get_task` with `ref: "T-1"`.

**Expected end-state:** read-only, no mutations. `loctt list` should still show exactly one task.

---

### Scenario 3 — Update status

**Setup:** create T-1 via CLI: `loctt create "Write tests"`.

**Prompt:** *"Mark T-1 as in progress."*

**Expected tools called:** `update_task` with `ref: "T-1"`, `field: "status"`, and a value matching an `in_progress`-like status from `workflow.yaml`.

**Expected end-state:**
```bash
loctt show T-1
# Status should be in_progress (or whatever the workflow's "active" status is named)
```

---

### Scenario 4 — Update body (replace vs append)

**Setup:**
```bash
loctt create "Refactor auth"
loctt body T-1 --set "Initial notes."
```

**Prompt 4a:** *"Add a note to T-1 saying we need to consult the security team first."*

**Expected tools called:** `append_task_body` (NOT `replace_task_body`).

**Expected end-state:**
```bash
loctt body T-1
# Should contain BOTH "Initial notes." and the new note about security team
```

**Prompt 4b** *(separate run, fresh setup):* *"Update T-1's description to: 'See doc at /design/auth.md'."*

**Expected tools called:** `replace_task_body`.

**Expected end-state:** body is exactly the new content; original "Initial notes." is gone.

This pair tests whether the agent distinguishes append from replace based on phrasing.

---

### Scenario 5 — Link tasks (parent/child)

**Setup:**
```bash
loctt create "Build user auth feature"   # T-1
loctt create "Backend API"               # T-2
loctt create "Frontend form"             # T-3
```

**Prompt:** *"Make T-2 and T-3 subtasks of T-1."*

**Expected tools called:** `link_tasks` twice — once for each child. The relationship type used should match the workflow's parent-like relationship (commonly `parent` or similar).

**Expected end-state:**
```bash
loctt show T-1
# Should list T-2 and T-3 as children (or under whatever the relationship label is)
```

---

### Scenario 6 — Unlink

**Setup:** continue from Scenario 5.

**Prompt:** *"Actually, T-3 shouldn't be under T-1 anymore."*

**Expected tools called:** `unlink_tasks` for the T-1 ↔ T-3 edge.

**Expected end-state:**
```bash
loctt show T-1   # only T-2 should remain as a child
loctt show T-3   # should no longer reference T-1 as parent
```

---

### Scenario 7 — Query tasks

**Setup:**
```bash
loctt create "Fix login redirect" --priority high
loctt create "Add password reset" --priority high
loctt create "Update footer text" --priority low
loctt create "Refactor logging" --priority medium
```

**Prompt:** *"Show me all the high-priority tasks."*

**Expected tools called:** `list_tasks` with a query filtering on priority (or `list_views` first if a saved view exists, then `list_tasks` with the view).

**Expected end-state:** read-only. The agent's response should mention the two high-priority tasks (T-1 and T-2) and not the others.

---

### Scenario 8 — Archive (soft delete)

**Setup:** `loctt create "Old idea I no longer want"`.

**Prompt:** *"Get rid of T-1, but I might want it back later."*

**Expected tools called:** `archive_task` with `ref: "T-1"`. NOT `delete_task`.

**Expected end-state:**
```bash
loctt list                # T-1 should not appear
loctt show T-1            # should still resolve, with archived flag set
```

---

### Scenario 9 — Permanent delete (with confirmation)

**Setup:** `loctt create "This was a typo"`.

**Prompt:** *"Permanently delete T-1. I'm sure I don't want it."*

**Expected tools called:** `delete_task` with `ref: "T-1"` and `confirm: true`.

**Expected end-state:**
```bash
loctt show T-1
# should error: task not found
```

This tests whether the agent understands the `confirm: true` requirement and the destructive nature.

---

### Scenario 10 — Ambiguous reference

**Setup:**
```bash
loctt create "Login bug on iOS"
loctt create "Login bug on web"
```

**Prompt:** *"Update the login task to in_progress."*

**Expected agent behavior:** The agent should recognize the ambiguity. Acceptable behaviors:
- Ask the user which task they mean.
- List both candidates and ask to pick.
- Pick one but call out the ambiguity in its response.

**Unacceptable:** silently picking one and updating it without flagging the ambiguity.

**Expected end-state:** depends on the agent's choice. If it asked for clarification, no mutation should have happened. If it picked one with disclosure, only that one's status changed.

---

### Scenario 11 — Nonexistent reference

**Setup:** fresh workspace, no tasks.

**Prompt:** *"What's the status of T-42?"*

**Expected tools called:** `get_task` with `ref: "T-42"`. The tool should return an error.

**Expected agent behavior:** Surface the error to the user clearly ("T-42 doesn't exist") rather than fabricating a response or retrying with different refs.

---

### Scenario 12 — Multi-step triage

**Setup:**
```bash
loctt create "Bug: 500 on signup"           # T-1
loctt create "Bug: typo in homepage"        # T-2
loctt create "Feature: dark mode"           # T-3
loctt create "Bug: slow dashboard load"     # T-4
loctt create "Master tracking task"         # T-5
```

**Prompt:** *"Look at T-1 through T-4. For each one that's a bug, link it as blocking T-5 and set its priority to high. Leave the feature alone."*

**Expected tools called:** at minimum a sequence that involves reading T-1 to T-4 (or listing them), then for T-1, T-2, T-4: `link_tasks` (with a `blocks` or workflow-equivalent relationship) and `update_task` for priority. T-3 should be skipped.

**Expected end-state:**
```bash
loctt show T-5            # should show T-1, T-2, T-4 as blockers (or equivalent)
loctt show T-3            # priority unchanged, no relationship to T-5
loctt show T-1            # priority is high
```

This is the most realistic multi-tool scenario. Failure here usually points to either a tool description that the agent misread or a missing capability (e.g. no convenient way to query or filter mid-conversation).

---

### Scenario 13 — Read history

**Setup:**
```bash
loctt create "Refactor auth"
loctt set T-1 status in_progress
loctt set T-1 priority high
```

**Prompt:** *"What changes have been made to T-1?"*

**Expected tools called:** `task_history` with `ref: "T-1"`.

**Expected end-state:** read-only. Agent's response should mention the create event, status change, and priority change.

---

### Scenario 14 — List available views

**Setup:** ensure `.loctt/config/queries.yaml` has at least one saved view (the default init likely provides one).

**Prompt:** *"What saved task views do I have?"*

**Expected tools called:** `list_views`.

**Expected end-state:** read-only. Agent should report the view names from `queries.yaml`.

---

### Scenario 15 — Read config

**Setup:** any state.

**Prompt:** *"What statuses can I use for tasks in this project?"*

**Expected tools called:** `get_config`. The agent should pull the status list from the returned config rather than guessing.

**Expected end-state:** read-only. Agent's response should list the actual statuses configured in `workflow.yaml`.

---

## Results log template

Copy into `tests/llm/results/<YYYY-MM-DD>-<model>.md`:

```markdown
# LLM Test Run — YYYY-MM-DD

- **Model:** Claude Sonnet 4.6 / Claude Opus 4.7 / GPT-5 / etc.
- **Agent host:** Claude Code / Claude Desktop / Cursor / etc.
- **LocTT version:** <git sha or version>
- **Workspace:** tests/workspace/llm-run-<timestamp>

## Summary

- Passed: X / 15
- Failed: Y / 15
- Skipped: Z / 15

## Per-scenario results

| # | Scenario | Tools called | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Create a task | create_task | ✅ | — |
| 2 | Read a task | get_task | ✅ | — |
| 3 | Update status | update_task | ❌ | Agent used `set_status` (doesn't exist) before retrying with update_task |
| 4a | Append body | append_task_body | ✅ | — |
| 4b | Replace body | replace_task_body | ✅ | — |
| ... | | | | |

## Description / schema feedback

Any tools where the description was confusing, parameter names were unclear, or the agent had to retry. These become input for tool-description improvements.

## Workspace state at end of run

Optional: `loctt list` output, `tree .loctt/` snapshot, anything noteworthy.
```

---

## Adding new scenarios

When a new MCP tool is added or a description changes, add a scenario here covering it. Keep prompts in plain natural language — don't smuggle the tool name into the prompt. The whole point is that the agent must figure out which tool to call from the description.

Bias scenarios toward:
- **Pairs of similar tools** (append vs replace, archive vs delete) — catches description overlap.
- **Multi-step flows** — catches whether the agent can chain tools sensibly.
- **Ambiguous or invalid input** — catches whether the agent asks vs guesses.
