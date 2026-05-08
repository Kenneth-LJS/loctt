# Scenario 11 — Nonexistent reference

**Setup:** fresh workspace, no tasks.

**Prompt:** *"What's the status of T-42?"*

**Expected tools called:** `get_task` with `ref: "T-42"`. The tool should return an error.

**Expected agent behavior:** Surface the error to the user clearly ("T-42 doesn't exist") rather than fabricating a response or retrying with different refs.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 11-nonexistent-reference
```

The verifier confirms the workspace state is unchanged. The agent's response to the error is human-eyeball territory.
