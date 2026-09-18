# Scenario 15 — Read config

**Setup:** any state. A fresh `loctt init` workspace with no tasks is fine.

**Prompt:** *"What statuses can I use for tasks in this project?"*

**Expected tools called:** `get_workflow_config`. The agent should pull the status list from the returned config rather than guessing.

**Expected end-state:** read-only. Agent's response should list the actual statuses configured in `workflow.yaml`.

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 15-read-config
```

Pass = exit 0. The verifier confirms no mutation and that `workflow.yaml` is loadable. The agent's response (the actual status list it printed) requires human eyeballing.
