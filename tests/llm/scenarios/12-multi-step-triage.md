# Scenario 12 — Multi-step triage

**Setup:**
```bash
loctt create "Bug: 500 on signup"           # T-1
loctt create "Bug: typo in homepage"        # T-2
loctt create "Feature: dark mode"           # T-3
loctt create "Bug: slow dashboard load"     # T-4
loctt create "Master tracking task"         # T-5
```

**Prompt:** *"Look at T-1 through T-4. For each one that's a bug, link it as blocking T-5 and set its priority to high. Leave the feature alone."*

**Expected tools called:** at minimum a sequence that involves reading T-1 to T-4 (or listing them), then for T-1, T-2, T-4: `link_tasks` (with a `blocks` or workflow-equivalent relationship) and `update_task` for priority. T-3 should be skipped.

**Expected end-state:**
```bash
loctt show T-5            # should show T-1, T-2, T-4 as blockers (or equivalent)
loctt show T-3            # priority unchanged, no relationship to T-5
loctt show T-1            # priority is high
```

This is the most realistic multi-tool scenario. Failure here usually points to either a tool description that the agent misread or a missing capability (e.g. no convenient way to query or filter mid-conversation).

## Verify

After the agent finishes, from inside the test workspace:

```bash
npm run llm:verify -- 12-multi-step-triage
```

Pass = exit 0. The verifier checks priorities on T-1, T-2, T-4 and the bidirectional `blocks`/`is_blocked_by` edges between each bug and T-5, plus that T-3 is untouched.
