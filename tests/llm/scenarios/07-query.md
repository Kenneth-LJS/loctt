# Scenario 7 — Query tasks

**Setup:**
```bash
loctt create "Fix login redirect" --priority high
loctt create "Add password reset" --priority high
loctt create "Update footer text" --priority low
loctt create "Refactor logging" --priority medium
```

**Prompt:** *"Show me all the high-priority tasks."*

**Expected tools called:** `list_tasks` with a query filtering on priority (or `list_views` first if a saved view exists, then `list_tasks` with the view).

**Expected end-state:** read-only. The agent's response should mention the two high-priority tasks (T-1 and T-2) and not the others.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 07-query
```

Pass = exit 0. Failure prints which assertion broke. Note: the agent's response text isn't checked from the filesystem; this only confirms no mutation happened.
