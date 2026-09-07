---
name: architect-get-agent-ci-green
description: Use when an agent's test suite is red and needs to be driven to green. Fires on "get CI green", "the test suite is failing", "run the tests and fix them", "triage these test failures", "why is my agent suite red", or after attaching tests when many runs fail at once. Covers running a suite, polling it, classifying failures by cause, and fixing the ones that are test bugs rather than agent bugs.
---

# Get an agent's test suite green

A red suite is usually not one bug. It is several unrelated causes stacked together, and most of them are broken *tests*, not a broken agent. Triage by cause first; fixing blind wastes whole runs, since each simulation takes minutes.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, `$BRANCH_ID`.

## 1. Establish a baseline before changing anything

You cannot tell a fix from noise without a starting number.

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $API_KEY" > agent.json
```

The suite is at `platform_settings.testing.attached_tests` — a mix of individual `test_` ids and `tfld_` folder ids. **Only these are this agent's CI.**

That distinction matters more than it looks. On a real Architect suite, 56 tests ran but only 3 were attached to the agent; the other 53 came from inherited folders and belonged to entirely different agents (a Zendesk support agent, a delivery agent, a sales agent). They failed because they asserted another agent's behavior. No amount of fixing makes them pass here, and "fixing" them means editing another team's tests.

So before triaging, split failures into:

- tests attached to **this** agent — your problem
- tests that arrived via a shared folder and target another agent — not your problem; report them and leave them alone

Fetch each test body with `GET /v1/convai/agent-testing/{test_id}`. A 404 on an attached id means a stale attachment pointing at a deleted test — worth reporting, and it cannot pass.

## 2. Run the suite and poll

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/run-tests" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"tests": [{"test_id": "test_abc"}], "branch_id": "'"$BRANCH_ID"'", "repeat_count": 1}'
```

The response `id` is the suite id. Poll it, counting statuses:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/test-invocations/$SUITE_ID" -H "xi-api-key: $API_KEY"
```

Poll in the **background** on a 20-30s interval, not a foreground sleep. Simulations take minutes and a large suite takes far longer; a foreground wait blocks the session and times out. Stop when no `test_runs[].status` is `pending`.

To find a run started from the UI, list recent invocations (note this is a top-level endpoint; the `/agents/{id}/test-invocations` form does not exist):

```bash
curl -s "https://api.elevenlabs.io/v1/convai/test-invocations?agent_id=$AGENT_ID&page_size=10" \
  -H "xi-api-key: $API_KEY"
```

## 3. Classify every failure before fixing any

Read `condition_result.rationale.messages` plus the transcript at `agent_responses[]`. Sort each failure into one of four buckets — they have different fixes and very different costs.

**A. Unmocked tool call.** Transcript shows `Error: no mock matched for tool 'X'`. A test bug, and normally the largest bucket. In one real triage this was 32 of the failures, all from a single tool. Fix per the `architect-mock-all-tools` skill: mocks key on **tool ID**, and the ID must be one on this agent. Name keys and stale IDs are silently ignored.

**B. 60s timeout.** `Timed out after 60s waiting for the agent to produce its next turn`, with an empty transcript. This is a hang, not a verdict — the agent never got started. For DOM/Architect-style agents the usual cause is an empty `chat_history`. Seed one agent turn and raise `simulation_max_turns` to at least 6.

If seeding does not fix it, the timeout can be **content-driven** rather than config-driven. Verified by A/B: two tests with byte-identical mock config, seed, and turn count behaved differently purely by scenario text — "Which model is this agent on?" passed in one turn, while "Add a client tool ..." timed out with zero tool calls on every attempt. Heavy authoring requests (creating tools, generating agents) can exceed the 60s per-turn budget before the agent emits anything. Swap in a trivial scenario on the same config to tell the two apart: if the trivial one passes, the config is fine and the request itself is too slow — a platform limit to report, not a test to keep retrying.

**C. Wrong-agent test.** Success conditions reference tools or flows this agent does not have. Unfixable here by design. Report it, do not edit it.

**D. Genuine agent misbehavior.** Mocks all matched, the agent ran the flow, and it still did the wrong thing. **This is the only bucket that should change the agent.** Everything else is test repair.

**E. Stale architecture.** A `tool`-type test asserts a tool that the agent no longer routes through, so every run reports `No tool with name 'X' was called`. The agent is correct and the assertion is obsolete.

This is easy to mistake for a mass regression because it fails loudly and in bulk. In one triage, 46 of 108 failures were a single instance of this: every test asserted `execute_agents_tool`, but a migration had promoted the catalog tools to direct ConvAI tools, so that dispatcher is no longer called. Nothing was broken; the tests encoded the previous architecture.

The signature is a large group of same-type tests failing with an identical "tool not called" message and a shared `referenced_tool` id. Check whether that tool is still on the agent's `tool_ids` and whether a recent migration changed how it dispatches. The fix is to rewrite the assertions against the tool now called, or retire the tests — a product decision, so surface it rather than silently deleting.

Rewriting a meta-tool assertion to a direct one is mechanical. The old envelope asserted `tool_name` plus `args.*` paths; the direct call drops the `tool_name` row, strips the `args.` prefix from every remaining path, and repoints `referenced_tool.id` at the real tool. Watch for two follow-on traps: a migration that *splits* one tool by type (`create_tool` → `create_client_tool` / `create_webhook_tool`, `create_test` → `create_llm_test` / `create_simulation_test` / `create_tool_test`), where the right successor is inferable from the asserted arg paths; and stale `execute_agents_tool` calls sitting in the test's own seeded `chat_history`, which teach the agent the obsolete pattern in-context and must be rewritten too.

**Before rewriting, check the test type can even observe the call.** A `tool`-type test grades a single agent turn — exactly one tool call. If the agent opens with `start_procedure` (or any preamble) and calls the target on a later turn, the test can never pass no matter how correct the assertion is. Setting `check_any_tool_matches: true` widens matching from "the first call" to "any call in the turn", which is worth doing because it converts a misleading `Expected tool 'X' but agent called 'start_procedure'` into an honest `No tool with name 'X' was called` — but it does not add turns. In one suite, all 50 tool tests produced exactly one call and 37 opened with `start_procedure`, so they were structurally unpassable as `tool` tests.

### Converting a tool test to a simulation test

For a procedure-first agent this is the real fix, and it is mechanical. Build the simulation from the tool test's own fields:

- `simulation_scenario` — replay the tool test's seeded user turns as second-person instructions ("Say exactly: '<first user message>'. If the agent asks for confirmation, reply '<second user message>'. Then say you are done.").
- `success_conditions` — one condition per assertion: the `referenced_tool` name becomes "The agent calls the X tool", and each `parameters[]` entry becomes a sentence about its `path` and expected value.
- `chat_history` — a single seeded agent greeting; `simulation_max_turns` around 14.
- Mocks — the full ID-keyed superset, as always.

The payoff is real: a converted test ran 11 tool calls and reached the target the single-turn version could never see.

Two things to get right, both learned the hard way:

- **Assert intent, not an exact string, where the agent has legitimate freedom.** One converted test set the LLM to `gemini-2.5-flash` on one run and `gemini-2.5-flash-preview-05-20` on the next; both are valid ids for "Gemini 2.5 Flash", so an `exact` match is flaky by construction. Write "a gemini-2.5-flash* variant" instead. Same for tools split by type — accept `update_agent_config` or `patch_agent_config` when either is correct.
- **Re-run a converted test at least twice** before trusting it. Single-run greens hide exactly this nondeterminism.

### Assert the outcome, not the tool

The largest source of false failures is a criterion naming one specific tool when the agent legitimately reached the same outcome another way. Expect this to outnumber real bugs.

Three forms, all fixed by rewriting the criterion rather than "fixing" the agent:

- **A purpose-built tool beats the generic one.** Where a catalog offers both a specialized writer and a general config writer, the agent will usually pick the specialized one. A criterion demanding the generic writer then fails a correct run. Name the acceptable set ("any tool that writes X: A, B or C") and assert the resulting state instead of the call.
- **Assertions on fields the schema does not require.** When a tool is split by type, the identity moves into the tool name and any old type argument becomes redundant, so the agent omits it. Criteria asserting such a field fail against correct calls. Read the live schema (`GET /v1/convai/tools/{id}`, check `parameters.required`) and delete assertions on anything optional.
- **Values differing in case or form.** Decide whether exact casing is genuinely part of the contract; if not, say "(case-insensitive)" in the condition rather than failing a correct call.

The discipline: when a run fails, read what the agent actually did **before** editing anything. If it achieved the user's goal by a reasonable route, the criterion is wrong. Only conclude "agent bug" once the criterion describes an outcome the agent genuinely failed to reach.

### The scenario must justify the assertion

Conversion carries old assertions forward verbatim, and some were never justified by the prompt. If the scenario asks for an everyday outcome but the criterion demands a specific internal structure, the agent will satisfy the request the obvious way and fail. A test whose prompt does not imply its assertion is a broken test, not a failing agent.

Read the scenario and criteria together. If a reasonable user reading that prompt would not expect the asserted outcome, either make the prompt ask for it plainly or relax the criterion to what the prompt actually implies. The same applies to the kind of artifact you expect: if the scenario does not say which type to create, the agent may reasonably create a different one.

Only after A, B, C, and E are cleared can you trust bucket D. Fixing the agent to satisfy a test that was failing for reason A or E actively makes the agent worse.

## 4. Watch for implausible mock data masquerading as an agent bug

A failure looks like bucket D — mocks matched, agent declined to act — but the real cause is mock *content*. Agents reason about values, so a well-formed mock with an unrealistic value gets rejected.

Seen in practice: a ticket mocked as `TRIAGE-4821` when the platform's ids are `agtqa_`-prefixed. The agent judged it malformed, refused the lookup, and every success condition failed. Changing only the id to `agtqa_3901...` turned the same test green. Before concluding the agent is wrong, check that mock values match production shape.

## 4b. Knowledge failures: verify the fact before changing the agent

When a test fails because the agent stated a wrong number or denied a real feature, do not patch the prompt from the test's expectation. The test may be the stale one. Find the source of truth in the codebase first — the enforced constant, with a file:line — and only then decide which side is wrong. Parallel targeted subagent searches are well suited to this: each fact is an independent lookup.

Three outcomes, each with a different fix:

- **Test right, agent wrong** — add the fact to the prompt, using the verified value.
- **Test wrong, agent right** — fix the test. Product facts drift, and a test written against an old figure will keep failing a correct agent.
- **Sources genuinely conflict** — surface it rather than picking a side. When config, docs, and the test disagree, that needs a product ruling, not a prompt edit.

Watch for a single systemic cause behind many "wrong number" failures. Limits often differ between surfaces — the web app, the public API, and per-plan tiers — and an agent that reaches for the wrong one will miss a whole cluster of facts at once. Fixing that framing once resolves many individually-reported failures, so before writing six separate fact patches, check whether they share one root cause.

Read the judge's rationale closely too: it often quotes the knowledge base directly and tells you which side is stale.

## 5. Fix in place, then re-run only what you changed

Repair a simulation test with `PUT /v1/convai/agent-testing/{test_id}`. It edits in place and keeps the id, so attachments and folder placement survive. Send the complete object — omitted fields are not preserved — and note that `PATCH` returns 405.

Do not delete and recreate to apply a fix. A new test gets a new id, which silently drops it from the agent's suite, so the next full run covers less than you think while looking greener. A 404 from `PUT` means a wrong id, not a missing capability.

Bulk repair works well because the two mechanical buckets share one payload shape: seed `chat_history`, raise `simulation_max_turns`, and attach the full ID-keyed mock set. Applying that to every A and B failure at once is a single pass — 38 tests updated in one batch in a real triage, all returning 200.

Deleting a test you do not own is destructive; confirm with the owner first, and never delete another team's tests to make your number go up.

Re-run just the changed tests while iterating. Save the full-suite run for final verification.

## 6. Verify green means green

Two failure modes hide behind a passing suite. Check both.

**A test can pass with every mock broken.** One verified run passed on the agent's own reasoning while all seven of its mocks returned `no mock matched`. Grep every transcript for `no mock matched` even when the suite is fully green; any hit is a latent failure that will surface the moment the agent's path changes.

**Passing once is not passing reliably.** Agents take nondeterministic paths, so a run can pass while leaving tools unmocked that a later run will hit. Observed directly: a repaired test passed, then on re-run the agent reached `patch_agent_config` and `update_agent_config`, which nothing had mocked. Mock the superset of tools the agent *could* call, not just those it happened to call once, and re-run a repaired suite at least twice before declaring it green.

Report the outcome as a delta with both numbers (`1/6 → 5/5`), name what stayed red and why, and state plainly which failures were test bugs versus agent bugs.
