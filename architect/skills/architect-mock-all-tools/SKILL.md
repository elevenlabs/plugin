---
name: architect-mock-all-tools
description: Use when a simulation test needs every tool call mocked so runs are deterministic and never hit live systems. Fires on "mock all tools", "mock the tools in this test", "the test says no mock matched", "tool returned an error in my test run", "stop my test calling the real API", or when a run fails because a tool errored rather than because the agent misbehaved. Also use before running a suite for a DOM/Architect-style agent.
---

# Mock all tools in a simulation test

A simulation test that hits live tools is not a test, it is a flaky integration run. Mock every tool the agent can reach so a failure means the agent behaved wrong, not that a dependency moved.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, `$BRANCH_ID`.

## The one mistake that breaks almost every mock

**Mocks match on tool ID, never on tool name.** An override keyed by a name, or by an ID that is not on *this* agent, is silently ignored. The tool then runs unmocked and you see this in the transcript:

```
Error: no mock matched for tool 'open_support_form'
```

That message means "your key did not match", not "mocking is off". It is the single largest cause of red simulation suites.

Two ways to get the key wrong, both common:

1. **A tool name as the key.** `{"open_support_form": [...]}` never matches. Verified directly: a test with seven name-keyed overrides had all seven miss.
2. **A stale ID.** Tool IDs are not stable across agents or workspaces. An ID copied from another agent, or left behind after a tool was recreated, resolves to nothing. A suite can carry a full set of overrides where *not one* ID exists on the agent under test.

Both fail the same silent way: config saves fine, `mocked_tool_ids` looks populated, every call still errors.

## 1. Resolve real tool IDs first

Never hand-write an ID. Derive the name-to-ID map from the agent you are testing.

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $API_KEY" > agent.json
```

The IDs are at `conversation_config.agent.prompt.tool_ids`. Resolve each to a name via the workspace tool list:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/tools?page_size=100" -H "xi-api-key: $API_KEY"
```

Three traps when resolving:

- **Page to the end.** `has_more`/`next_cursor` paginate. A workspace can hold thousands of tools; stopping at the first page or an arbitrary cap makes real IDs look unresolvable and sends you chasing a bug that does not exist.
- **Duplicate names are normal.** The same tool name often exists under several IDs from earlier copies. Never pick by name from the workspace list. Map name to ID **only across the agent's own `tool_ids`**, so you pick the one this agent actually calls.
- **Not every callable tool is in `tool_ids`.** System tools (`start_procedure`, `end_procedure`, `load_memory_entry`, `transfer_to_agent`) and RAG run unmocked no matter what. Do not try to mock them; expect them live in the transcript and let success conditions tolerate them.

## 2. Write the mock config

`tool_mock_config` is an object, not a list:

```json
{
  "tool_mock_config": {
    "mocking_strategy": "all",
    "fallback_strategy": "raise_error",
    "mocked_tool_ids": ["tool_1101kdbpjt1vep78mhe93zj66g4x"]
  },
  "tool_mock_overrides": {
    "tool_1101kdbpjt1vep78mhe93zj66g4x": [
      {"parameter_conditions": [], "mock_result": "{\"result\":\"ok\"}", "is_error": false}
    ]
  }
}
```

- `mocking_strategy` is exactly one of `all`, `selected`, `none`.
- **With correct IDs, `all` and `selected` both apply overrides.** Verified with paired runs that differed only in strategy: both passed and both returned the override payload. If an override is not landing, the cause is the key, not the strategy.
- `fallback_strategy: "raise_error"` is what surfaces an unmocked call as a loud error instead of a silent live call. Keep it: it is how you discover the tool you forgot.
- `mock_result` is a **JSON-encoded string**, not a nested object.
- `parameter_conditions: []` matches any arguments. Add conditions only when one tool must return different data per call:
  ```json
  {"parameter_conditions": [{"path": "workspace_id", "eval": {"type": "exact", "expected_value": "ws_123"}}]}
  ```

## 3. Make mock data domain-plausible, not merely well-formed

A schema-valid mock carrying an implausible value still fails the test, because the agent reasons about the *content*. This is subtle and costs real debugging time.

A ticket test mocked a lookup with id `TRIAGE-4821`. The mock matched and returned cleanly, but the agent refused to act: the platform's real ticket ids are `agtqa_`-prefixed, so the agent judged the id malformed and redirected to a support form. Every success condition failed, and none of it was the agent's fault. Swapping in `agtqa_3901...` made the same test pass with no other change.

So mirror production shape in mock values:

- Match real ID prefixes and formats (`agent_`, `tool_`, `agtqa_`, `agtbrch_`).
- Return the fields the agent actually reads. An empty `{}` where the agent expects `status` or `title` reads as a broken record.
- Keep the mock consistent with the scenario prose. If the user says "open ticket X", the mock must contain ticket X.

The failure signature to recognize: mocks match (no `no mock matched`), yet the agent declines, redirects, or asks for clarification. That is implausible mock data, not a misbehaving agent.

## 4. Cover the full DOM surface for Architect-style agents

A DOM agent inspects the page before acting, so a "single tool" test in fact calls many. Mock the whole surface or the run dies on the first unmocked read:

`get_agent_config`, `list_tools`, `list_agents`, `get_workflow`, `get_page_text`, `get_interactive_elements`, `get_session_activity`, `execute_parallel_agents_tool`, `navigate_to_page`, `navigate_to_url`, `open_support_form`

Add the tools specific to the behavior under test (e.g. `create_webhook_tool`, `get_agent_ticket`). Mocking a superset is free; a missing one is a failed run.

Also seed `chat_history` with one agent turn. A DOM agent with empty history reliably dies at `Timed out after 60s waiting for the agent to produce its next turn` — a hang, not a verdict:

```json
{"role": "agent", "message": "Hi! I'm Architect...", "time_in_call_secs": 0,
 "tool_calls": [], "tool_results": [], "interrupted": false,
 "reasoning": [], "used_static_kb_document_ids": []}
```

Set `simulation_max_turns` to at least 6 for a DOM agent; too low returns inconclusive before the flow completes.

## 5. Verify the mocks actually applied

Never trust a green status alone. Read the transcript and confirm each expected tool returned **your** payload:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/test-invocations/$SUITE_ID" -H "xi-api-key: $API_KEY"
```

Walk `test_runs[].agent_responses[].tool_results[]` and check `is_error` and `result_value`. A test can pass while every mock misses — one verified run passed on the agent's own reasoning with all seven of its mocks erroring. Passing for the wrong reason is worse than failing, because it hides the broken config until the behavior changes.

Grep the transcript for `no mock matched` on every run. Any hit means a key is wrong, even when the suite is green.

## 6. Edit an existing test in place with PUT

`PUT /v1/convai/agent-testing/{test_id}` updates a simulation test in place and returns the updated body. The id is preserved, so every attachment and folder placement survives the edit. This is the correct way to repair mocks on an existing test.

```bash
curl -s -X PUT "https://api.elevenlabs.io/v1/convai/agent-testing/$TEST_ID" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" -d @fixed.json
```

Send the whole object, not a partial patch: `type`, `name`, `simulation_scenario`, `success_conditions`, `simulation_max_turns`, `dynamic_variables`, `chat_history`, `tool_mock_config`, `tool_mock_overrides`. Omitted fields are not preserved. `PATCH` is not supported and returns 405.

A 404 from `PUT` means the id is wrong, not that editing is unsupported. Re-read the id from the agent's attached list before concluding anything else.

Prefer `PUT` over delete-and-recreate. Recreating mints a new id, which silently detaches the test from the agent's suite; you then have to re-attach it, and any folder placement is lost. Only delete when you genuinely want the test gone, and confirm with the owner first for a test you did not create.
