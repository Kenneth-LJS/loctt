# Scenario 14 — List available views

**Setup:** ensure `.loctt/config/queries.yaml` has at least one saved view (the default init likely provides one). No tasks needed.

**Prompt:** *"What saved task views do I have?"*

**Expected tools called:** `list_views`.

**Expected end-state:** read-only. Agent should report the view names from `queries.yaml`.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 14-list-views
```

Pass = exit 0. The verifier confirms no task mutation happened. The agent's response (the list of view names) requires human eyeballing.
