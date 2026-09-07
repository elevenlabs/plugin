---
name: architect-structured-procedures
description: Use when you want to create, rewrite, inspect, or fix a structured / deterministic / flow-style procedure, convert a procedure between free-form and structured, or when a deterministic procedure fails validation or the compile step rejects the JSON. The authoritative JSON schema is inline here.
---

# Write or convert a structured (deterministic) procedure

Both procedure forms are first-class. Pick deliberately:

- `free_form`: markdown with optional frontmatter and prose steps. The model reads it and applies judgement. Right when steps are guidance or need discretion. This is the default and usually the correct answer.
- `deterministic`: JSON compiled into a real state machine. Steps run in order, exactly as written. Right when a tool sequence must be guaranteed (compliance, ticket hygiene, ordering that must not vary between runs).

Never convert one form to the other unless the user asked. Converting a working free-form procedure to deterministic trades away flexibility; say which capability is being traded, in one sentence, when you convert.

Everything is branch-scoped over the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`). You need `$AGENT_ID` and `$BRANCH_ID`. Create and edit follow the draft then publish model (see the `architect-manage-procedures` skill): a create posts a draft, an edit patches the draft, and a `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` publishes pending drafts into a new version.

## Do not guess the schema

There is no `tool_code` step type and no nested `tool_code` object. Use the schema below, or read an existing deterministic procedure's `content` as a template (list procedures via `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures`, which returns `type` and full content for every procedure). Validate the JSON before publishing with `POST /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/compile`.

## Authoritative content schema

`content` is a JSON string with exactly two top-level keys. `steps` must be non-empty.

```json
{ "trigger": "<when this procedure fires, or empty string>", "steps": [ ... ] }
```

Every step carries a `type` discriminator. The complete set:

```
{ "type": "ask",    "instruction": "<what to ask the user>" }
{ "type": "tell",   "instruction": "<what to convey, model phrases it>" }
{ "type": "say",    "message": "<verbatim message>" }
{ "type": "tool_call", "tool_id": "tool_...", "tool_name": "<name>",
                       "instruction": "<optional>", "on_failure": <handler|null> }
{ "type": "system_tool", "system_tool_name": "end_call" }
{ "type": "branch", "branches": [ <arm>, ... ], "fallback": [ <substep>, ... ] }
```

- An arm is `{ "condition": <condition>, "steps": [ <substep>, ... ] }` with non-empty `steps`.
- A condition is `{ "type": "llm", "condition": "<natural language>" }` or `{ "type": "expression", "expression": <ASTNode> }`.
- A substep may be `ask` / `tell` / `say` / `tool_call` / `system_tool`. A branch cannot nest another branch.
- `on_failure` is `{ "branches": [ { "condition": ..., "steps": [...] } ], "fallback": [ ... ] }`, where `fallback` is mandatory and non-empty, and its substeps may be `ask` / `tell` / `say` / `retry`. `retry` is `{ "type": "retry", "max_retries": 1-3 }`.

## Validation rules that reject your JSON

1. `ask` / `tell` need a non-empty `instruction`; `say` needs a non-empty `message`.
2. All conditions in one branch (or one failure handler) must be the same type; never mix `llm` and `expression`.
3. A `retry` step must be the last step in its failure branch.
4. `end_call` must be the last step wherever it appears.
5. No two consecutive `branch` steps; put a non-branch step between them.
6. An `expression` condition may not come directly after an `ask`. Use an `llm` condition to branch on a user reply, or place the expression after a `tool_call`.
7. `tool_id` must be a real tool on this agent. Get it from `GET /v1/convai/tools` (or the agent's `tool_ids`), never invent one, and make `tool_name` match.

## Converting free-form to deterministic

The failure mode to avoid: writing the JSON but leaving the procedure `free_form`, so the JSON lands as raw text in the markdown body and the user's prose procedure is replaced by a wall of JSON.

1. Read the current `content`, `name`, and `type` via `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID`.
2. List tools via `GET /v1/convai/tools` to resolve every tool the prose mentions into a real `tool_id`, before writing any JSON.
3. Map prose to steps, preserving tool order exactly: "ask the user X" becomes `ask`, "tell them Y" becomes `tell`, a fixed sentence becomes `say`, "call tool T" becomes `tool_call`, "if Z then" becomes `branch`.
4. `PATCH /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID/draft` with `type: "deterministic"` set explicitly, plus `name` and the JSON string as `content`.

Setting `type` is the whole conversion. An omitted `type` resolves to the procedure's existing type, so omitting it on a free-form procedure keeps it free-form. Editing the content string alone always writes back the existing type and therefore cannot convert a procedure; only a draft edit with an explicit `type` can.

5. Compile via `POST .../procedures/compile`. A compile error names the offending path (e.g. `steps[2].tool_id`); fix that field and resend once.
6. Publish the draft via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`. Confirm which form it is now, and that the edit sits on the branch draft until published and only ships on merge.

Never silently drop a step you could not map to a step type. Tell the user instead.
