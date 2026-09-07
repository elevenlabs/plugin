---
name: architect-create-llm-test
description: Use when the user wants a single-turn test that checks WHAT the agent says for a given turn. Fires on "add a test that the agent greets the caller", "test that it always reads the disclosure", "make sure it refuses off-topic questions", "write an eval for this reply", or "add a pass/fail check on the agent's answer". Not a multi-turn simulation and not a tool-call check.
---

# Create an LLM response test

Use this when the user wants to assert that the agent's reply to a turn matches a natural-language success condition. This is a single-turn response judgement. If they instead want to verify which tool fires, use the tool-test skill; if they want a multi-turn role-played conversation, use the simulation-test skill. For a DOM or Architect-style agent whose first action is almost always starting a procedure, prefer a simulation test instead, since a single-turn LLM test only grades that first action and returns useless verdicts.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID` where relevant.

## 1. Gather context first

Read only what you need to ground the test, in parallel where independent:

- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` - to ground the success condition in the agent's actual behavior: its first message, system prompt, and any required disclosures. A condition like "greets the user" is worthless if you do not know what the greeting is supposed to be.
- List existing tests to avoid a near-duplicate and to copy the naming convention already in use.

If the user is turning a real bad call into a regression test, read the conversation (`GET /v1/convai/conversations?agent_id=$AGENT_ID`, then `GET /v1/convai/conversations/{conversation_id}`) and lift the transcript into `chat_history`. Conversation reads carry customer PII; do not copy them into other systems or logs, and respect zero-retention-mode accounts.

## 2. Create the test

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agent-testing/create" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "llm",
    "name": "Greets caller by name on open",
    "success_condition": "The reply welcomes the caller and offers help. Mark SUCCESS only if it does both.",
    "chat_history": [{"role": "user", "message": "Hi"}]
  }'
```

An LLM test needs exactly three fields:

- `name` - non-empty string. Reuse the naming style from the existing tests.
- `success_condition` - natural-language description of what makes the reply correct.
- `chat_history` - array of `{role, message}` where `role` is `"user"` or `"agent"` only, and the array must end on the `user` turn the agent is supposed to respond to.

## 3. Schema gotchas that cause failures

1. **Empty or missing `chat_history`.** It is required and must be non-empty, ending on a `user` turn. An empty array fails with "Chat history is required for llm tests".
2. **Wrong `role` value.** The enum is strictly `"user"` or `"agent"`. Do not use `"assistant"`, `"system"`, `"bot"`, or `"human"`.
3. **Blank `success_condition`.** A whitespace-only string also fails. Write a concrete criterion.
4. **Vague `success_condition`.** It validates but produces a flaky test. Phrase it as an evaluation question with an explicit pass bar ("Mark SUCCESS only if the agent reads the disclosure starting with X"), not as an instruction ("The agent should read the disclosure").
5. **Wrong test type for the intent.** If the user wants to check a tool call, `success_condition` has no effect; use the tool-test skill. If they want a multi-turn role-play, use the simulation-test skill (`chat_history` is not used there). Sending simulation fields to an LLM test is a common schema mismatch.
6. **Putting the expected answer in `chat_history`.** The final turn must be the user prompt. Do not add a trailing `agent` message with the "right" answer; the agent generates that reply at run time and the judge scores it against `success_condition`.
7. **`chat_history` over 200 messages is rejected.** Trim long transcripts to the turns that set up the one under test.

## 4. Attach and run

Creating a test only registers it. If it should run going forward, attach it to the agent and branch, then run it:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/testing/attach-test" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"test_id": "'"$TEST_ID"'", "branch_id": "'"$BRANCH_ID"'"}'

curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/run-tests" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"tests": [{"test_id": "'"$TEST_ID"'"}], "branch_id": "'"$BRANCH_ID"'", "repeat_count": 1}'
```

Poll `GET /v1/convai/test-invocations/{suite_id}` until `test_runs[0].status` leaves `pending`, then read `condition_result`. If the user wants several checks, create them one at a time. If a created test keeps failing on a valid conversation, the `success_condition` is likely too strict; loosen it or split compound criteria.
