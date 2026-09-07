---
name: architect-create-simulation-test
description: Use when the user wants a full multi-turn conversation test where a simulated user talks to the agent across many turns. Fires on "test the whole flow", "simulate a caller", "write a scenario test", "test that the agent handles an upset customer / a full booking / a multi-step call", or when a simulation-test creation attempt failed. For single-response checks use the LLM-test skill; for one tool call use the tool-test skill.
---

# Create a simulation test

A simulation test drives a full multi-turn conversation: a simulated user (defined by a persona and scenario) talks to the agent, then the transcript is judged against success conditions. It is the highest-value test type and empirically the most failure-prone, almost always because of a schema or wrong-type mistake, not a bad idea. This skill gets it right first time.

**Always use a simulation test for DOM or Architect-style agents.** Their first action is almost always starting a procedure, so LLM and tool tests grade only that first action and return useless verdicts. Only the multi-turn simulation exercises the real flow.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID` where relevant.

## 1. Read the agent first

So the persona and success conditions match reality, read these in parallel where independent:

- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` - the system prompt, first message, language, and LLM. The persona and success conditions must reflect what the agent is actually instructed to do. Confirm the agent language so the simulated-user prose is in a language the agent handles. If the agent has a workflow (in this same config), write the scenario to walk the simulated user through the node transitions you want exercised.
- List the agent's tools for the ids you need in `tool_mock_config` and to name a specific tool in a success condition.
- List existing tests to extend coverage instead of duplicating, and read a nearby existing simulation test to copy its exact field shape. Mirroring a working example is the single most reliable way to avoid a schema mismatch.

## 2. Create the test

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agent-testing/create" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "simulation",
    "name": "Upset customer, surprise charge, de-escalate then retain",
    "simulation_scenario": "You are Diane, a loyal customer upset about a surprise $45 charge. Acknowledge the greeting, ask why you were charged, then ask for a refund. Once resolved, say you are done.",
    "success_conditions": ["The agent verified the account before discussing the charge", "The agent de-escalated before quoting policy", "The agent offered a retention option"],
    "simulation_max_turns": 20,
    "tool_mock_config": {"mocking_strategy": "all", "fallback_strategy": "raise_error", "mocked_tool_ids": []},
    "dynamic_variables": {"tier": "enterprise"},
    "chat_history": []
  }'
```

Keep the two prose fields distinct:

- `simulation_scenario` - instructions to the simulated user (the persona plus what they do, in second person). This drives the other side of the conversation. Give the simulated user a clear stop cue so the conversation ends.
- `success_conditions` - plain strings, the pass/fail rubric judged against the agent's behavior, written as evaluation statements, not instructions. Enumerate concrete checkable clauses. Reference a tool by its real name if success requires a tool call. Vague conditions make the test flaky.

Other fields:

- `type` must be exactly `"simulation"`.
- `simulation_max_turns` - cap the conversation (existing tests use around 20-24). Too low and the flow cannot complete; too high wastes runs. For a DOM or Architect-style agent set it to at least 2, or the run comes back inconclusive.
- `tool_mock_config` - an object, not a list. Shape: `{"mocking_strategy": "all", "fallback_strategy": "raise_error", "mocked_tool_ids": []}`.
- `dynamic_variables` - a flat string-to-string object of any placeholders the agent's prompt or first message needs. Missing a required placeholder makes the sim behave unexpectedly; provide every placeholder the agent references.
- `chat_history` - leave `[]` for a fresh conversation; only prefill turns when testing behavior that assumes prior context. Each prefilled entry needs `time_in_call_secs`. A DOM or Architect-style agent usually needs a seeded `chat_history` plus mocking or every run times out.

## 3. Mocking strategy and its caveats

`mocking_strategy` is exactly one of `all`, `selected`, or `none`. There is no fourth value.

- `all` mocks every tool call with the generic fallback and ignores any per-tool overrides. Combined with `fallback_strategy: "raise_error"` and no overrides, every tool call errors mid-conversation. That is fine only when the behavior under test does not depend on a tool succeeding (e.g. a confirmation-wording fix).
- If the fix depends on a specific tool returning realistic data (e.g. a list call returning a branch list so the agent can resolve a name to an id), you must use `selected` with `mocked_tool_ids: [...]` naming every tool to mock, and provide the overrides. Under `all`, overrides silently no-op and you see "no mock matched" in the transcript even though the config saved correctly.
- Any id in `mocked_tool_ids` must be a real tool id. Mock by id, judge by name.
- Some SYSTEM tools such as RAG cannot be mocked and still run live; account for that when a run behaves unexpectedly.

## 4. Editing a simulation test is delete and recreate

There is no in-place edit for a simulation test; a PUT is response/llm only and rejects `type: simulation`. If a run reveals the config was wrong, `DELETE /v1/convai/agent-testing/{test_id}`, fix the payload, and create again, then re-attach and re-run.

## 5. Attach, then run

Creating a test only registers it; it does not add it to the agent's suite. If it should run going forward, attach it in the same task without waiting to be asked, then run:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/testing/attach-test" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"test_id": "'"$TEST_ID"'", "branch_id": "'"$BRANCH_ID"'"}'

curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/run-tests" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"tests": [{"test_id": "'"$TEST_ID"'"}], "branch_id": "'"$BRANCH_ID"'", "repeat_count": 1}'
```

Simulation runs take minutes. Poll `GET /v1/convai/test-invocations/{suite_id}` until `test_runs[0].status` leaves `pending`, using a background poll loop rather than a foreground sleep. Then read `condition_result.result` and the per-criterion rationale, and iterate the persona or success conditions based on where the run diverged.

## 6. Recovery per error

- A schema mismatch usually means `tool_mock_config` was sent as a list instead of an object, `type` was not exactly `"simulation"`, or `success_conditions` was missing. Fetch a working simulation test and mirror its exact keys.
- A validation error means an unknown `mocked_tool_ids` id, an out-of-range `simulation_max_turns`, or a non-string `dynamic_variables` value. Fix the offending value.
- not_found means a referenced agent, tool id, or test id does not exist on this branch. Re-read the current ids and confirm the branch.
