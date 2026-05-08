# Scenario 1 — Create a task

**Setup:** fresh workspace, no tasks.

**Prompt:** *"Create a new task to fix the login bug."*

**Expected tools called:** `create_task` with `title` containing "login" (exact phrasing is the agent's choice).

**Expected end-state:**
```bash
loctt list
# Should show one task, key T-1, title mentions "login"
```

**Notes for verifier:** The agent might pick a status or priority on its own — that's fine as long as the values are valid for the workflow.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 01-create-task
```

Pass = exit 0. Failure prints which assertion broke.
