---
name: architect-explore-agent
description: Use when starting a task that needs an agent's current setup, or when another skill tells you to explore the agent first, before making recommendations or changes to a ConvAI agent.
---

# Explore an agent's context

Before recommending or changing anything, gather just enough of the agent's current configuration to act. Fetch narrowly. Do not pull the whole config every time.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID` where relevant.

## 1. Read only what the task needs

Get the agent scoped to the branch:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $API_KEY"
```

This one response carries the whole config: `name`, `conversation_config.agent.prompt.prompt` (system prompt), `conversation_config.agent.prompt.llm`, `conversation_config.agent.language`, `conversation_config.tts.model_id` and `voice_id`, `conversation_config.agent.prompt.tool_ids`, guardrails, and the workflow. Read the fields the task needs and ignore the rest. The whole config is large, so do not re-fetch it to read one leaf you already have.

## 2. Add narrow follow-up reads only when the task touches them

- To inspect a specific tool, take its id from `conversation_config.agent.prompt.tool_ids` and get just that tool: `GET /v1/convai/tools/{tool_id}`. Do not re-fetch the agent to read one tool.
- For procedures, list names and triggers with `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures`, then get one body by id with `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/{procedure_id}`.
- For past conversations, `GET /v1/convai/conversations?agent_id=$AGENT_ID`, then `GET /v1/convai/conversations/{conversation_id}` for a transcript. These carry customer PII and analysis. Do not copy them into other systems or logs, and respect zero-retention-mode accounts. For anything beyond a glance at one or two calls — pagination, which fields the list payload actually carries, aggregating a window, sampling — use `architect-review-live-calls`, which owns that pattern.

Make independent reads in parallel where they do not depend on each other, each still narrowly scoped.

## 3. Identify the active setup

From what you fetched, note the active LLM, voice, TTS model, language, and any configured tools or custom guardrails.

## 4. Summarize, then ask

State the current setup in one concise sentence, then ask what the engineer wants to improve before pulling anything more. An empty workflow (only the start node with no edges) is the default state, not a custom configuration. If the agent has procedures but no workflow nodes, describe it as a procedure-driven agent with no workflow configured.
