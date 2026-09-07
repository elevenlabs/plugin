---
name: architect-troubleshoot-tool-errors
description: Use when an agent tool (webhook/server, client, system, or MCP) errors, fails validation, won't save, isn't being invoked, returns no result, or behaves wrong, including "tool not used", "property cannot be empty", async/timeout, or test/simulation failures.
---

Diagnose a misbehaving tool by reading the exact error first, then matching the failure pattern. All API calls use `xi-api-key: $API_KEY` against `https://api.elevenlabs.io`.

## Check this FIRST on any schema_mismatch from a webhook or client tool

Every parameter/property object must set EXACTLY ONE value source: a non-empty `description` (the LLM fills it), OR `dynamic_variable`, OR a non-empty `constant_value`, OR `is_system_provided: true`.

- ZERO sources is invalid. `{"type":"string","constant_value":""}` with no description is rejected; an empty-string `constant_value` does NOT count as a constant. Give the field a real `description`.
- TWO OR MORE sources is invalid.
- This applies to `parameters`, `request_body_schema.properties`, `path_params_schema`, `query_params_schema`, and `request_headers` alike.

If the error names `type` or `constant_value` on a property, this rule is almost always the cause. Fix the value source before investigating anything else.

## Do not repeat these mistakes

1. Never guess a tool's config schema or hand-build config JSON blind. Read the tool's actual saved config first with `GET /v1/convai/tools/{tool_id}` and change from there.
2. Read the actual error before theorizing. For a runtime failure, read the conversation where it happened with `GET /v1/convai/conversations/{conversation_id}` and find the failing tool call and its error verbatim; for a save failure, ask the user to quote the exact error text.
3. State tool field names, defaults, and limits from the current config you read, not from memory; they change.

## Match the failure pattern

A. Agent says it uses the tool but never calls it. Check in order: (1) the tool is actually attached to the agent (`GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`, confirm the id is in `tool_ids` or the right node's `additional_tool_ids`); (2) the description is too vague, the model decides invocation from it, so rewrite it to state clearly WHEN to use the tool and apply via `PATCH /v1/convai/tools/{tool_id}`; (3) suggest a simulation test to reproduce deterministically before going live (see the create-simulation-test skill).

B. Validation / won't-save errors ("Property description cannot be empty", missing required field). Read the tool config, find the empty or invalid field, and apply the fix by reading the full config with `GET /v1/convai/tools/{tool_id}` and writing it back with `PATCH /v1/convai/tools/{tool_id}`. For each property confirm the exactly-one-value-source rule above holds.

C. No result returned / async behavior (the tool starts a job but the answer never comes back in the same turn). Likely cause: `execution_mode` is `async` when it should wait, or a client tool's `expects_response` is false. Confirm the current values via `GET /v1/convai/tools/{tool_id}`, then fix with `PATCH /v1/convai/tools/{tool_id}`. See the edit-existing-tool skill for the async plus `expects_response` rule.

D. Webhook tool returns a backend error (a 4xx/5xx, or app-specific text). This is the user's own endpoint failing, NOT an ElevenLabs config bug. Make that distinction early. Confirm from `GET /v1/convai/conversations/{conversation_id}` what payload was sent and what status came back, then verify with the user: endpoint URL, method, auth headers, and that each parameter maps to something the endpoint expects. The fix usually lives in their endpoint or the parameter schema, not the agent.

## When to stop

If the error is from the user's own backend and needs engineering help, or you have looped twice without progress, summarize the exact error and what you have ruled out and hand off to a human (a support form) rather than guessing schemas.
