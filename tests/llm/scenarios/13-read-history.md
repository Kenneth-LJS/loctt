# Scenario 13 — Read history

**Setup:**
```bash
loctt create "Refactor auth"
loctt set T-1 status in_progress
loctt set T-1 priority high
```

**Prompt:** *"What changes have been made to T-1?"*

**Expected tools called:** `task_history` with `ref: "T-1"`.

**Expected end-state:** read-only. Agent's response should mention the create event, status change, and priority change.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 13-read-history
```

Pass = exit 0. The verifier confirms T-1 still exists with the seeded status and priority (i.e. no mutation happened).
