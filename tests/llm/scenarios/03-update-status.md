# Scenario 3 — Update status

**Setup:** create T-1 via CLI:
```bash
loctt create "Write tests"
```

**Prompt:** *"Mark T-1 as in progress."*

**Expected tools called:** `update_task` with `ref: "T-1"`, `field: "status"`, and a value matching an `in_progress`-like status from `workflow.yaml`.

**Expected end-state:**
```bash
loctt show T-1
# Status should be in_progress (or whatever the workflow's "active" status is named)
```

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 03-update-status
```

Pass = exit 0. Failure prints which assertion broke.
