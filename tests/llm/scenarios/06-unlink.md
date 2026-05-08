# Scenario 6 — Unlink

**Setup:** continue from Scenario 5 (T-1 with T-2 and T-3 as children), or replicate:
```bash
loctt create "Build user auth feature"
loctt create "Backend API"
loctt create "Frontend form"
loctt link T-2 parent T-1
loctt link T-3 parent T-1
```

**Prompt:** *"Actually, T-3 shouldn't be under T-1 anymore."*

**Expected tools called:** `unlink_tasks` for the T-1 ↔ T-3 edge.

**Expected end-state:**
```bash
loctt show T-1   # only T-2 should remain as a child
loctt show T-3   # should no longer reference T-1 as parent
```

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 06-unlink
```

Pass = exit 0. Failure prints which assertion broke.
