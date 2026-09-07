---
name: architect-create-tool-test
description: Use when the user wants a test asserting the agent CALLS a specific tool (with specific parameters, or does NOT call it). Fires on "test that it calls my booking tool", "verify it passes the right customer_id", "make sure it never calls transfer here", "add a tool test", "check it uses save_result at the end", or when a tool-test creation attempt errored.
---

# Create a tool-call test

This is the reliability drill-down for the tool-call test type. It fails often, almost always on the `tool_call_parameters` shape (wrong `eval` type, wrong `referenced_tool`, bracket paths). A tool test replays your `chat_history` turns, then checks whether the agent's next action is the expected tool call. For a single agent reply use the LLM-test skill; for a multi-turn role-play use the simulation-test skill.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID` where relevant.

## 1. Gather context first

You cannot write a correct `referenced_tool` without the target tool's real `id` and `type`, and you cannot write a realistic `chat_history` without knowing what the agent is supposed to do. Read these first, in parallel where independent:

- List the agent's tools (`GET /v1/convai/tools`, or the tool ids from `conversation_config.agent.prompt.tool_ids` on the agent config, then `GET /v1/convai/tools/{tool_id}`). Required: this is where you get the target tool's `id` and `type` (`webhook`, `client`, `code`, or `system`). `referenced_tool` needs both, and the type must match the tool's real executor type or creation fails.
- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` - the prompt and first message, so the `chat_history` is a plausible lead-up to the tool call, and the base `tool_ids` so you know the tool is available to the agent. For a workflow agent, the workflow in this config tells you whether the tool is scoped to a node via `additional_tool_ids`.
- List existing tests to reuse the naming scheme and avoid a duplicate.

If grounding the test in a real call, read that conversation (`GET /v1/convai/conversations/{conversation_id}`) to lift the exact tool name and parameters the agent actually used. Conversation reads carry customer PII; do not copy them elsewhere and respect zero-retention-mode accounts.

## 2. Create the test

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agent-testing/create" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "tool",
    "name": "Saves result via save_coaching_result at end of feedback",
    "chat_history": [
      {"role": "agent", "message": "Great work today. Let me save this so it shows on your dashboard."},
      {"role": "user",  "message": "Perfect, go ahead and save it."}
    ],
    "tool_call_parameters": {
      "referenced_tool": {"id": "tool_5801k...", "type": "client"},
      "parameters": [
        {"path": "scenario_id",   "eval": {"type": "anything"}},
        {"path": "overall_score", "eval": {"type": "exact", "expected_value": "6"}}
      ],
      "verify_absence": false
    }
  }'
```

## 3. Schema gotchas and how to avoid each

1. **`chat_history` role values and shape.** Each turn is `{role, message}` where `role` is exactly `"user"` or `"agent"`. The history must end on the turn just before the expected tool call, usually a `user` turn that should trigger it. An empty or agent-final history makes the assertion meaningless.
2. **`referenced_tool` needs the real `id` and `type` together.** `type` is one of `webhook` / `client` / `code` / `system` and must match the actual tool. A made-up id, or the right id with the wrong type, fails as not_found or validation.
3. **`parameters` is an array of `{path, eval}`, not a flat key/value object.** A common mistake is `parameters: {customer_id: "123"}`. The correct form is `parameters: [{"path": "customer_id", "eval": {"type": "exact", "expected_value": "123"}}]`.
4. **`eval.type` is a small enum; use the right one with its companion field:**
   - `anything` - parameter must be present, value unconstrained. No extra field.
   - `exact` - requires `expected_value` (a string; stringify numbers and bools, e.g. `"6"`, `"true"`).
   - `regex` - requires `pattern`.
   - `llm` - requires `description` (natural-language criterion the judge applies).

   There is no `contains` or `semantic` type. An unknown type, or omitting the companion field, fails as a schema mismatch.
5. **`path` uses dot notation for nested args.** `path: "customer.id"` or `path: "items.0.sku"`, not `customer[id]` or `items[0].sku`. Bracket notation does not resolve.
6. **Assert only the parameters you care about.** List just the args the test should pin; leave the rest unmentioned. To assert "some tool is called, do not care which", set `check_any_tool_matches: true` and omit `referenced_tool`.
7. **`verify_absence: true` asserts the agent must NOT call the tool** given that history. Do not also fill `parameters` in that case; there is no call to inspect. Use it for "it should never transfer here" guards.
8. **`workflow_node_transition` is workflow-only.** Leave it null or omitted for single-node agents; only set it when you gathered the node structure from the workflow and want to assert the call happens after a specific transition.

## 4. Recovery per error

- A schema mismatch is almost always the `eval` object (unknown `type`, or `exact`/`regex` missing `expected_value`/`pattern`) or `parameters` passed as an object instead of an array. Fix that one field and resend.
- A validation error is usually `chat_history` (wrong `role`, empty, or not ending on the triggering user turn) or a `path` in bracket notation. Fix per gotchas 1 and 5.
- not_found means the `referenced_tool.id` does not exist on this agent or its `type` is wrong. Re-list the tools and copy the exact id and type. If the tool genuinely does not exist, create it first (see the tool-creation skills), then reference it.

## 5. Attach, run, and edit later

Creating a test only registers it. If it should run going forward, attach it to the agent and branch, then run:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/testing/attach-test" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"test_id": "'"$TEST_ID"'", "branch_id": "'"$BRANCH_ID"'"}'

curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/run-tests" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"tests": [{"test_id": "'"$TEST_ID"'"}], "branch_id": "'"$BRANCH_ID"'", "repeat_count": 1}'
```

Pass `repeat_count` (2-50) to check flakiness. Poll `GET /v1/convai/test-invocations/{suite_id}` until the run leaves `pending`, then read `condition_result`. To edit a tool test later, read its current shape first, then update it with the full tool body.
