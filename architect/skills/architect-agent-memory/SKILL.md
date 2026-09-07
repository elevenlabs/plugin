---
name: architect-agent-memory
description: Use when the user wants the agent to remember, learn, save, or memorize a fact, or reports a one-off "the agent said X but should say Y" correction. There is no memory endpoint over REST; this covers the durable alternatives (system prompt or knowledge base) and when to use them.
---

# Teach an agent a fact (there is no memory endpoint over REST)

The web Architect has a `create_memory_entry` action for ad-hoc, agent-global facts. Over the ConvAI REST API there is NO memory endpoint. Say this plainly to the user rather than implying you saved a memory. Instead, persist the fact one of two durable, branch-scoped ways below (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`; you need `$AGENT_ID` and `$BRANCH_ID`).

## First, sanity-check the request

- Confirm the correction is scoped and factual: a discrete fact or rule ("In v3, only the Stability slider is supported"), not a broad behavioral change. Broad, recurring, or procedural changes belong in the system prompt or a new procedure, not a one-off fact.
- Confirm the fact genuinely cannot come from a crawled knowledge base (which can re-sync) or an API call (which stays current). If it can, prefer those sources.
- If the request is a broad behavioral change, escalate to editing the system prompt or creating a procedure instead.

## Option A: a durable fact in the system prompt

Add the fact as a short, self-contained line the agent can recall verbatim. Read the current prompt scoped to the branch, append the line, and PATCH the whole string back:

- Read: `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`, take `conversation_config.agent.prompt.prompt`.
- Write: `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` with `{"conversation_config":{"agent":{"prompt":{"prompt":"<full edited prompt>"}}}}`.

This commits to the branch HEAD and returns a new version. Keep the fact short so it does not bloat the prompt.

## Option B: a knowledge base document

For a fact better kept as recallable knowledge than a prompt line, create a KB text doc and attach it to the agent:

- `POST /v1/convai/knowledge-base/text` with the fact as the document body.
- Attach the returned document to the agent (add its id to the agent's knowledge base config via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`).

## Timing matters: both options are branch-scoped

Unlike the web memory feature (which is agent-global and goes live immediately), both the prompt line and the KB doc are branch-scoped. They only reach the production agent when the branch is merged. This is usually what you want: it lets the user stage the fact for a launch or embargo and merge at go-live. Tell the user the change is staged on the branch and ships on merge.

If the user explicitly wants a fact live on production right now and is comfortable with that, note that the durable options here still require a merge; there is no REST path to an immediate agent-global memory. Make that limitation explicit rather than pretending otherwise.

## Confirm

After writing, briefly confirm to the user what was saved, where (prompt line or KB doc), on which branch, and that it goes live on merge. Keep it to one or two short sentences.
