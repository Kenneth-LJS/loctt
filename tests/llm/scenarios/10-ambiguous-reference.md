# Scenario 10 — Ambiguous reference

**Setup:**
```bash
loctt create "Login bug on iOS"
loctt create "Login bug on web"
```

**Prompt:** *"Update the login task to in_progress."*

**Expected agent behavior:** The agent should recognize the ambiguity. Acceptable behaviors:
- Ask the user which task they mean.
- List both candidates and ask to pick.
- Pick one but call out the ambiguity in its response.

**Unacceptable:** silently picking one and updating it without flagging the ambiguity.

**Expected end-state:** depends on the agent's choice. If it asked for clarification, no mutation should have happened. If it picked one with disclosure, only that one's status changed.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 10-ambiguous-reference
```

The verifier confirms no mutation happened (no task got a status set), which corresponds to the "ask for clarification" path. The other acceptable path (pick-with-disclosure) requires human eyeballing of the agent's response and is not checked here. Pass = exit 0.
