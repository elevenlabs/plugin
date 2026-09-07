---
name: architect-edit-existing-tool
description: Use when the user wants to change an existing tool on their agent (rename it, fix its description, change a webhook URL/headers/auth, add or edit a request-body parameter or response assignment, adjust the timeout, or flip a client tool's expects_response / execution mode), or when a tool edit won't save or throws schema_mismatch / validation / not_found.
---

Editing a tool fails a lot, almost always because the patch violated a per-type schema rule or dropped a field the caller never read. The fix: read the current tool first, send a minimal but complete-per-object patch. All calls use `xi-api-key: $API_KEY` against `https://api.elevenlabs.io`.

## 1. Read the current tool first

Do not edit blind; the failures come from patching a shape you never read.

- `GET /v1/convai/tools` to get the exact tool id and its TYPE (webhook / client / code). The type determines the config shape.
- `GET /v1/convai/tools/{tool_id}` to read the tool's CURRENT saved config: name, description, `request_body_schema` properties, `request_headers`, auth, response `assignments`, `response_timeout_secs`, and (for client tools) `expects_response` / `execution_mode`.
- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` to confirm the tool is attached (`tool_ids` / per-node `additional_tool_ids`) and to see which nodes reference it before you rename anything.

## 2. Update with the full config

```
PATCH /v1/convai/tools/{tool_id}
```

`PATCH` REPLACES the config, so send the config for the type you read in step 1 with your changes applied. Change only what the user asked, but include the FULL object for any nested field you touch: if you edit one property in `request_body_schema`, resend the whole `request_body_schema`, not just the one property. Partial nested objects are the usual source of silent drops and validation errors.

A SYSTEM tool (`transfer_to_number`, `end_call`, `language_detection`, `skip_turn`, `update_state`, etc.) is NOT edited this way; its config lives in the agent config, so edit it via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` targeting the relevant path.

## 3. Schema gotchas

Webhook / code tools (`request_body_schema`):

- Each property needs EXACTLY ONE of: a non-empty `description`, `constant_value`, `dynamic_variable`, or `is_system_provided`. Two (or zero) is a validation error. When editing, do not leave the old `dynamic_variable` while adding a `description`.
- Array properties REQUIRE an `items` schema and MUST NOT carry `constant_value`.
- URLs must be STATIC, no `{{variables}}` in the path; move dynamic values into `request_body_schema`.
- `request_headers` is an OBJECT, not an array. For secrets use `{"secret_id": "..."}` (list via `GET /v1/convai/secrets`); do not paste a raw key when the original used a secret id.
- Response `assignments` use dot-notation `value_path` (`data.items.0.id`, NOT `data.items[0].id`; bracket indexing silently returns null).
- `response_timeout_secs`: default 20, max 120.

Client tools:

- `expects_response` (bool) and `execution_mode` (`immediate` / `post_tool_speech` / `async`) are the two fields people edit and get wrong. If `execution_mode` is `async`, the tool is fire-and-forget and `expects_response` must be false.
- Parameters follow the same one-of-four value-source rule.

All types:

- Renaming: the tool `name` is referenced by the LLM and by any node prompts or edge conditions that call it by name. After a rename, prompts still using the old name will not fire the tool. Flag this and offer to update the referencing prompts in the same pass via the agent config.
- Do not invent new schema keys.

## 4. Recovery

- `schema_mismatch`: the patch shape does not match. Re-`GET` the tool, diff against what you sent, and resend the full nested object for the field you touched. Do not retry the identical body.
- `validation`: a per-field rule above was broken (two-of-four on a property, array with `constant_value`, async + `expects_response`, timeout > 120, `{{var}}` in URL). Fix that field and resend.
- `not_found`: a stale or wrong tool id, or the tool is not on this branch. Re-`GET /v1/convai/tools` for the current agent/branch and use the exact id.

## 5. Follow-ups

If you renamed the tool or changed its parameters, update referencing node prompts or edge conditions via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`, and re-check any tool test that targeted the old schema (a sim test edit is delete + recreate; see the create-tool-test skill). If the underlying problem is that the tool is not being CALLED or returns no result at runtime (not a config-edit failure), use the troubleshoot-tool-errors skill instead.
