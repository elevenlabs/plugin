---
name: architect-migrate-to-procedures
description: Use when the user wants to migrate a system-prompt-driven agent to a procedure-driven setup, pull step-by-step logic out of a heavy system prompt, or "convert my prompt into procedures".
---

# Migrate a system-prompt agent to procedures

Guide the user through moving a prompt-heavy agent to a procedure-driven setup. Everything is branch-scoped over the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`). You need `$AGENT_ID` and the `$BRANCH_ID` you are working on. Procedure creates and edits follow the draft then publish model; see the `architect-manage-procedures` skill for the exact endpoint mechanics.

## 1. Check current agent state

Read the agent with `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`. Verify it is effectively system-prompt-only: an empty workflow with no custom nodes or edges, and no existing custom procedures beyond default system ones (list via `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures`). If it already has custom workflow nodes or existing procedures, flag this to the user, but do not stop the migration.

## 2. Analyze the system prompt for candidates

Read the system prompt (`conversation_config.agent.prompt.prompt` off the agent GET). Identify good procedure candidates: sequential step-by-step instructions, and conditional logic or branching paths (for example, "if the user asks for X, do Y").

## 3. Survey for clarity

If any part of the system prompt is unclear or needs more detail to become a procedure, ask specific clarifying questions. Resolve all ambiguities before proceeding.

## 4. Propose suggested procedures

Present a Markdown table with columns:

- Name: a concise, human-readable name.
- Trigger: the user intent or phrase that should activate it.
- Brief content: a short summary of the steps or logic to capture.

Reflect any clarifications from step 3 in the proposal. Ask the user if they are happy with the plan.

## 5. Create procedures one at a time

Once the user approves and all questions are resolved, create the approved procedures one by one: `POST /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures` per procedure (this writes a draft). Do not create them all in a single turn. Create one, confirm it succeeded, then proceed to the next. For content shape and the free-form vs deterministic choice, see the `architect-manage-procedures` and `architect-structured-procedures` skills.

Publish the pending drafts into a version when the set is complete via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`.

## 6. Review and test

Invite the user to review the new procedures and try them out. Once trimmed logic has moved into procedures, you can slim the system prompt with a `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` on the prompt field, keeping the changes on the branch until the user is ready to merge.
