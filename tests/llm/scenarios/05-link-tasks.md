# Scenario 5 — Link tasks (parent/child)

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

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 05-link-tasks
```

Pass = exit 0. Failure prints which assertion broke.
