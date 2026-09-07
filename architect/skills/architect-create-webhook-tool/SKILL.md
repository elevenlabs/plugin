---
name: architect-create-webhook-tool
description: Use when the user wants to give an agent a NEW webhook / server / HTTP tool so it can call an external API (look up a customer, create a ticket, check inventory, hit their backend). Fires on "add a webhook tool", "connect my agent to my API", "make a tool that calls my endpoint", or when a webhook-tool create fails with schema_mismatch / validation. For editing an existing tool see the edit-existing-tool skill; for a tool that saves but misbehaves at runtime see the troubleshoot-tool-errors skill.
---

Creating a webhook tool is the most common way to connect an agent to an external API, and it fails a lot, almost all from schema mistakes in `api_schema.request_body_schema`. This skill gets it right on the first write.

All calls use `xi-api-key: $API_KEY` against `https://api.elevenlabs.io`.

## 1. Gather current state first

Before writing anything, make these reads (in parallel where independent):

- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` to confirm the agent and whether it is a single-node agent or a workflow (the workflow is in this config; it changes where you attach the tool later).
- `GET /v1/convai/tools` to check the tool does not already exist and to match the naming style already in use.

Get the endpoint URL, method, auth method, and request/response shape from the user before you construct the tool. If any are missing, ask for them or the API docs first.

## 2. Create the tool

```
POST /v1/convai/tools
```

with the tool config discriminated by type (webhook/server). The webhook config lives under `api_schema`, not at the top level.

## 3. Schema gotchas (the specific things that cause failures)

1. STATIC URL. `api_schema.url` must be a static string. Do NOT put `{{variables}}` in the path. Dynamic values go into `request_body_schema` (or `path_params_schema` / `query_params_schema`), never interpolated into the URL.
2. EXACTLY ONE value source per property. Every property in `request_body_schema.properties` gets its value from exactly one of: a non-empty `description` (LLM fills it), `dynamic_variable` (e.g. `"user_phone_number"` or a system var like `"system__conversation_id"`), `constant_value` (a fixed literal), or `is_system_provided: true`. Two sources on one property is the most common validation failure; ZERO sources is equally invalid. A bare `{"type":"string"}` or a property whose only non-type field is an empty `constant_value` has zero sources and is rejected. `constant_value: ""` does NOT count as a constant.
3. path_params_schema / query_params_schema are ARRAYS of parameter objects, NOT a `{properties:{...}}` object. Each item needs: `id`, `type` as a BARE string (`"string"`|`"number"`|`"integer"`|`"boolean"`; nullable uses a 2-element array like `["string","null"]`, never `{"type":"string"}`), `description`, `value_type` (`"llm_prompt"`|`"dynamic_variable"`|`"constant"`), `dynamic_variable` (empty string unless bound), `constant_value` (always a string/number/boolean, NEVER null or omitted), and `required` (boolean). A working llm_prompt item: `{"id":"city","type":"string","description":"The city to look up.","value_type":"llm_prompt","dynamic_variable":"","constant_value":"","required":true}`.
4. ARRAY properties REQUIRE an `items` schema and MUST NOT carry `constant_value`.
5. `required` must reference only property names that exist in `properties`.
6. `request_headers` is an OBJECT, not an array. For secret API keys, reference a workspace secret by id (`{"secret_id": "..."}`, list existing via `GET /v1/convai/secrets`) rather than pasting the key.
7. `response_timeout_secs` defaults to 20, max 120. Raise it only for genuinely slow APIs; high timeouts hurt voice latency.
8. Name and description drive INVOCATION. Make the description specific ("Look up a customer by phone number", not "Customer lookup"); a vague description is the top reason a correctly-saved tool never gets called.

## 4. Extract response values into the conversation

To feed API response fields into `{{dynamic_variables}}`, add entries to the tool's top-level `assignments` array (a sibling of `api_schema`). Each maps a response field to a variable: source `response`, a dot-notation `value_path` (`data.items.0.id`, NOT `data.items[0].id`, bracket indexing silently misses), and the target `dynamic_variable`. Then reference `{{customer_name}}` in the prompt so the agent speaks it.

## 5. Attach and wire usage

After creating, attach the tool to the agent. On a single-node agent add its id to the base `tool_ids`; on a workflow agent keep base `tool_ids: []` and add it to the right node's `additional_tool_ids` so it is only in scope where it fires. Apply the attachment via a targeted `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` on the relevant path. In the prompt, tell the agent exactly when to call the tool and add a fallback line ("If the lookup returns an error or no results, apologize and offer to take a message").

## 6. Recovery

- `schema_mismatch` (often no field detail): re-check the section-3 rules one by one, most often two value sources on one property, a `{{var}}` in the URL, or `constant_value` on an array. Fix and resend; do not blind-retry the identical payload.
- `validation`: a concrete arg is wrong (a `required` name with no matching property, an array missing `items`, a bad `value_path`, a non-object `request_headers`). The message names the field; correct that one.
- `not_found`: a bad agent id or a workflow node id that does not exist. Re-read current ids and retry.
