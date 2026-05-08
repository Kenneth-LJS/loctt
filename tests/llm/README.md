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

1. Open the scenario file under `tests/llm/scenarios/<n>-<name>.md`. Read the setup steps. If any prerequisite tasks are listed, create them via the **CLI** (not via the agent) before starting — we want the agent's tool calls scoped to the scenario itself.
2. Paste the prompt verbatim into the agent.
3. Watch which MCP tools the agent calls. Don't intervene unless the agent gets stuck or asks a question.
4. After the agent finishes, run the automated verifier from inside the test workspace:
   ```bash
   npm run llm:verify -- <scenario-name>
   ```
   Or pass `--root <path>` to run from anywhere:
   ```bash
   npm run llm:verify -- <scenario-name> --root /path/to/test-workspace
   ```
   Exit 0 = pass. Exit 1 prints which assertion broke.
5. Record the result (pass/fail, tools called, notes) in the results log.

A scenario passes if **all three** hold:
- The agent called the expected tool(s) (extras are OK if they don't mutate state incorrectly).
- The arguments were semantically correct (right ref, right field, right value).
- `npm run llm:verify -- <name>` exits 0.

If any one fails, mark the scenario failed and note specifically which.

---

## Scenarios

The 15 scenarios live as individual markdown files under [`tests/llm/scenarios/`](./scenarios/). Each file contains the setup commands, the verbatim prompt, the expected agent behavior, and a `## Verify` section telling you how to run `npm run llm:verify`.

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

When a new MCP tool is added or a description changes, add a scenario covering it. Two files per scenario:

1. **`tests/llm/scenarios/<n>-<name>.md`** — the runbook entry: setup commands, the verbatim prompt, expected agent behavior, and a `## Verify` section. Keep prompts in plain natural language — don't smuggle the tool name into the prompt. The whole point is that the agent must figure out which tool to call from the description.

2. **`tests/llm/verify/<n>-<name>.ts`** — a default-exported async function `(root: string) => Promise<void>` that uses the helpers in `tests/llm/lib/expect.ts` to assert the post-scenario state. Failures should throw with a message that names the broken expectation. Read-only scenarios can be as simple as `expectTaskCount(<seedCount>)`.

Bias scenarios toward:
- **Pairs of similar tools** (append vs replace, archive vs delete) — catches description overlap.
- **Multi-step flows** — catches whether the agent can chain tools sensibly.
- **Ambiguous or invalid input** — catches whether the agent asks vs guesses.
