---
name: architect-turn-taking-latency
description: Use when the user asks about turn taking, speculative turns, agent response latency, preparing responses while the user speaks, turn eagerness or timeout, or how fast the agent replies.
---

# Turn taking and latency settings

Everything is branch-scoped over the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`). You need `$AGENT_ID` and `$BRANCH_ID`.

## 1. Read the current turn settings

Read the agent's `conversation_config.turn` (and the workflow nodes if the question is workflow-specific) with `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`. Do not pull the full agent context for procedures and unrelated config; the turn block is what matters here.

## 2. Explain the relevant levers

Based on the user's specific latency or turn-taking question:

- Speculative turn (`speculative_turn`): when enabled, the agent starts preparing the LLM response during silence before full turn confidence is reached, reducing perceived latency.
- Turn eagerness (`turn_eagerness`): controls how quickly the agent jumps in (low, standard, high / eager).
- Turn timeout (`turn_timeout`): maximum wait time before the agent re-engages.

## 3. Apply the change

Use a single-field partial-merge patch with the exact dotted path so you touch only the setting in question:

- `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` with `{"conversation_config":{"turn":{"speculative_turn":true}}}`, or the same shape for `turn_eagerness` / `turn_timeout`.

This commits to branch HEAD and returns a new version. Confirm the change to the user, and note it is on the branch until merged.
