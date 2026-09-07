---
name: architect-generate-agent
description: Use when the user asks to generate, build, or create a new agent from a description ("create an agent for X", "build a chatbot that does Y"). There is no one-shot generate endpoint over REST; ask clarifying questions, then build via create and refine via patch.
---

# Generate a new agent (there is no one-shot generate endpoint)

The web Architect has a `generate_agent` action. Over the ConvAI REST API there is NO one-shot generate endpoint. Do not pretend there is. Instead, gather requirements, create a starter agent with `POST /v1/convai/agents/create`, then refine it with `PATCH` (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`).

## Step 1: pause and ask clarifying questions

Before creating anything, understand what the user actually needs. Ask targeted questions to gather:

- Use case and context: what specific problem does this agent solve? Who are the end users?
- Scope and capabilities: what should the agent do, and what should it NOT do?
- Tone and personality: how should it sound (formal, friendly, technical)?
- Integration needs: does it need to call external APIs, access a knowledge base, or trigger workflows?
- Success criteria: how will the user know it is working well?
- Constraints: any compliance, language, or channel requirements?

## Step 2: synthesize and confirm

Summarize your understanding back to the user in 2-3 sentences and ask "Is this what you're looking for?" This prevents building the wrong agent.

## Step 3: create the agent

Once aligned, create the agent with `POST /v1/convai/agents/create`. Set the name and an initial `conversation_config` built from the synthesized requirements: a system prompt capturing the use case, scope, tone, and constraints, a suitable first message, and an LLM chosen for the task (see the `architect-llm-selection` skill for region/compliance/latency tradeoffs). The response returns the new `agent_id`.

## Step 4: refine

Iterate with `PATCH /v1/convai/agents/{agent_id}?branch_id={b}` partial-merge bodies to tighten the prompt, add tools, or adjust config. For step-by-step behavior, add procedures (see the `architect-manage-procedures` skill). For knowledge, attach knowledge base documents via `POST /v1/convai/knowledge-base/text` or `.../url`. For post-call extraction and grading, see the `architect-post-call-data` skill.

## Step 5: review and next steps

Tell the user the agent is created and offer next steps: review the system prompt, set up procedures, test with a simulation, secure it for production, or customize the workflow.
