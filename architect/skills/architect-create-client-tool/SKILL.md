---
name: architect-create-client-tool
description: Use when the user wants the agent to trigger something in their own browser, app, or SDK during a call (navigate a page, open or close a dialog, read on-screen context, run client-side code), or asks "how do I add a client tool", "make the agent do something in my app", or reports a client tool that won't save or where the agent never gets a response back. For a server API tool see the create-webhook-tool skill; for editing an existing tool see the edit-existing-tool skill.
---

A client tool runs in the caller's browser or app via the widget or SDK, not on ElevenLabs' servers. The agent emits a call over the event stream and the customer's own code executes it. This is different from a webhook tool (ElevenLabs calls an HTTP endpoint). All API calls use `xi-api-key: $API_KEY` against `https://api.elevenlabs.io`.

## 1. Gather current state first

Before creating, make these reads (in parallel where independent):

- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` to confirm the agent, its LLM, and whether it is a workflow agent (workflow agents scope tools per node via `additional_tool_ids`, so where you attach the new tool matters; the workflow is in this config).
- `GET /v1/convai/tools` to avoid creating a duplicate and to reuse an existing client tool if one fits.

## 2. Create the tool

```
POST /v1/convai/tools
```

with the tool config discriminated by the client type. The fields that cause failures:

- `name`: stable snake_case identifier the SDK matches on. Keep it identical to what the client code listens for; renaming later breaks the integration.
- `description`: the LLM uses this to decide WHEN to call the tool. Be specific ("Navigate the user to the billing settings page", not "navigation"). Vague descriptions are the top cause of "the agent never calls it".
- `parameters`: an ARRAY of parameter objects (not a JSON-Schema object with a `properties` map). Each item needs: `id` (snake_case, non-empty), `type` as a BARE string (`"string"`|`"number"`|`"integer"`|`"boolean"`; nullable uses a 2-element array like `["string","null"]`, never `{"type":"string"}`), `description`, `value_type` (`"llm_prompt"`|`"dynamic_variable"`|`"constant"`), `dynamic_variable` (empty string unless bound), `constant_value` (always a string/number/boolean, NEVER null or omitted), and `required` (boolean). Exactly one value source must be populated: a non-empty `description` (llm_prompt), OR `dynamic_variable`, OR a non-empty `constant_value`, OR `is_system_provided: true`. Zero sources is invalid and is the top cause of `invalid_union` / `schema_mismatch` on `parameters.0`. A working llm_prompt item: `{"id":"city","type":"string","description":"The city to look up.","value_type":"llm_prompt","dynamic_variable":"","constant_value":"","required":true}`. For no inputs send `parameters: []`. Array-typed params also need an `items` schema.
- `expects_response`: the single most important decision.
  - `true`: the agent PAUSES and waits for the client to send a result back (bounded by `response_timeout_secs`, default 20, max 120). Use when the return value feeds the conversation ("read the current page and tell me what the user is looking at").
  - `false`: fire-and-forget; the agent does not wait. Use for pure side effects (navigate, close dialog). Setting `true` for a side-effect-only tool is a common mistake; the agent then hangs until timeout because the client never sends a result.
- `execution_mode`: `immediate` runs right away; `post_tool_speech` lets the agent speak first. Async / fire-and-forget maps to `expects_response: false`. Only set `response_timeout_secs` when `expects_response: true`, and keep it <= 120.

### Client event contract (tell the user; this is where their end breaks)

The tool only works if the client handles the call. On invocation the client receives a `ClientToolCall` event carrying `tool_call_id`, `tool_name`, and `parameters`. If `expects_response: true`, the client MUST send back a `ClientToolResult` with the SAME `tool_call_id` and a string result within `response_timeout_secs`, or the agent gets a timeout. So `expects_response: true` with no client handler = every call times out; that is a client-code gap, not a tool-config bug.

## 3. Attach and instruct

Attach the tool to the agent via a targeted `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`: on a single-node agent add its id to `tool_ids`; on a workflow agent keep base `tool_ids: []` and add it to the right node's `additional_tool_ids` (see the edit-workflows skill for node scoping). In the prompt, tell the agent when to call it and what to do on failure ("If it returns an error or times out, tell the user you could not complete the action").

## 4. Recovery

- `schema_mismatch`: usually the `parameters` block. Confirm each item has exactly one value source and a bare-string `type`, and that array params have an `items` schema. Rebuild minimally and retry.
- `validation`: a required field is missing or malformed (empty `name`, missing `description`, `response_timeout_secs > 120`). Fill or clamp and retry.
- `not_found`: a wrong agent, tool, or node id. Re-read current ids and route to the correct one.

## 5. Verify

After creating and attaching, re-`GET /v1/convai/tools` (and the agent config for a workflow) to confirm the tool exists and is scoped to the intended node, then confirm with the user that their client code listens for `ClientToolCall` and returns a `ClientToolResult` when `expects_response` is true.
