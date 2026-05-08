# Scenario 9 — Permanent delete (with confirmation)

**Setup:**
```bash
loctt create "This was a typo"
```

**Prompt:** *"Permanently delete T-1. I'm sure I don't want it."*

**Expected tools called:** `delete_task` with `ref: "T-1"` and `confirm: true`.

**Expected end-state:**
```bash
loctt show T-1
# should error: task not found
```

This tests whether the agent understands the `confirm: true` requirement and the destructive nature.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 09-permanent-delete
```

Pass = exit 0. Failure prints which assertion broke.
