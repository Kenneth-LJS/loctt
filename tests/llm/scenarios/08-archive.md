# Scenario 8 — Archive (soft delete)

**Setup:**
```bash
loctt create "Old idea I no longer want"
```

**Prompt:** *"Get rid of T-1, but I might want it back later."*

**Expected tools called:** `archive_task` with `ref: "T-1"`. NOT `delete_task`.

**Expected end-state:**
```bash
loctt list                # T-1 should not appear
loctt show T-1            # should still resolve, with archived flag set
```

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 08-archive
```

Pass = exit 0. Failure prints which assertion broke.
