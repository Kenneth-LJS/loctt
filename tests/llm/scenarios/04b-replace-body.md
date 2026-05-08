# Scenario 4b — Replace body

**Setup:** fresh workspace.
```bash
loctt create "Refactor auth"
loctt body T-1 --set "Initial notes."
```

**Prompt:** *"Update T-1's description to: 'See doc at /design/auth.md'."*

**Expected tools called:** `replace_task_body`.

**Expected end-state:** body is exactly the new content; original "Initial notes." is gone.

This is the counterpart to 4a — testing whether the agent distinguishes append from replace based on phrasing ("Update ... to: ...").

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 04b-replace-body
```

Pass = exit 0. Failure prints which assertion broke.
