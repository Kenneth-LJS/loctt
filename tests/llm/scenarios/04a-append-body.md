# Scenario 4a — Append body

**Setup:**
```bash
loctt create "Refactor auth"
loctt body T-1 --set "Initial notes."
```

**Prompt:** *"Add a note to T-1 saying we need to consult the security team first."*

**Expected tools called:** `append_task_body` (NOT `replace_task_body`).

**Expected end-state:**
```bash
loctt body T-1
# Should contain BOTH "Initial notes." and the new note about security team
```

This scenario tests whether the agent picks append over replace based on phrasing ("Add a note").

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 04a-append-body
```

Pass = exit 0. Failure prints which assertion broke.
