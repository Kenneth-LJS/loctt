# Scenario 2 — Read a task

**Setup:** create T-1 via CLI:
```bash
loctt create "Set up CI pipeline"
```

**Prompt:** *"What does T-1 say?"*

**Expected tools called:** `get_task` with `ref: "T-1"`.

**Expected end-state:** read-only, no mutations. `loctt list` should still show exactly one task.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 02-read-task
```

Pass = exit 0. Failure prints which assertion broke.
