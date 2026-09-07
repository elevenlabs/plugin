---
name: architect-manage-procedures
description: Use when you want to add, edit, rename, inspect, or list an agent's procedures, or when a procedure create/edit call fails with schema_mismatch, validation, not_found, a 405, or a 422 missing `type`. Also use when a newly created procedure comes back empty or 404s on read. Covers the list/get/create/edit-draft/publish flow over the ConvAI REST API.
---

# Manage agent procedures reliably (list / get / create / edit / publish)

Procedures are their own data, not part of the agent config. There is no agent-config path for them and no way to reach them by patching `conversation_config`. Everything here is branch-scoped and goes through the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`). You need `$AGENT_ID` and the branch id `$BRANCH_ID` you are working on.

For the craft of writing a good trigger and clear steps, see the `architect-structured-procedures` skill and the procedure-authoring guidance. This skill is about calling the endpoints correctly.

## 1. Read current state first

Before creating or editing anything, read what exists:

- List every procedure on the branch: `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures`. Each entry carries `procedure_id`, `version_id`, `name`, `type` (`free_form` or `deterministic`), `trigger`, and `has_draft`. It does NOT include `content` — the list is an index, not a way to read bodies. Do not measure a procedure's content length from this response; an absent `content` field will read as empty for every procedure and look like data loss when nothing is wrong. You cannot edit a procedure without its `procedure_id` from here.
- Read one procedure's body with `GET /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID`. This is the only way to get `content`, and you need it before an edit so you do not blow away the rest. If a draft exists for that procedure, this GET returns the DRAFT content, not the published content.
- This GET returns 404 for a procedure whose content has never been published, even when the id is correct and the procedure appears in the list. That is the expected state right after a create (see section 2), not a wrong id. Use the list to confirm the procedure exists and check `has_draft`.
- Confirm the branch you are on with `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`, since procedures are per-branch.

If the user asked to edit "the X procedure", match X against the `name` values from the list and confirm the exact `procedure_id` before writing. Do not assume an id.

## 2. Create vs edit: the draft then publish model

Writes stage a DRAFT on the branch. A draft is not live until a separate publish step commits it into a new version.

- CREATE a new procedure: `POST /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures` with `name` and `content`. `type` defaults to `free_form`; pass `type: "deterministic"` only when writing the JSON flow form.

  **Creating is two calls, not one.** The POST registers the procedure and stores the `name`, but the `content` you send does not persist — it returns 200 with a body containing only `procedure_id` (`name` and `type` come back null), and the procedure lands with an empty body. You must follow it immediately with the draft PATCH below, resending the same `content`, or you will leave a named, empty procedure on the branch. Verify with the single-procedure GET after publishing, not with the POST response.
- EDIT or RENAME an existing procedure, and complete a create: `PATCH /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID/draft`. This writes to the branch draft. There is no direct `PATCH .../procedures/$PROCEDURE_ID` (no `/draft` suffix); that returns 405.

  This endpoint requires `name`, `content`, AND `type` — all three. Omitting `type` fails with a 422 `{"type":"missing","loc":["body","type"]}` even on a plain body edit. This is the opposite of the create endpoint's behavior, so do not carry the create payload over unchanged.
- PUBLISH pending drafts: `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` with any partial-merge body publishes all pending procedure drafts on the branch into a new version. The simplest no-op body re-sends the branch's current prompt. Fetch it first scoped to this branch so you do not clobber branch-local differences, then PATCH it back unchanged.

Tell the user an edited or created procedure sits on the branch draft until this publish step runs, and that it only goes live on the production agent when the branch is merged.

### The full create sequence

Creating a procedure with a body takes three calls. Skipping the second leaves an empty procedure; skipping the third leaves it unreadable.

1. `POST .../procedures` with `name` + `content` → returns `procedure_id`. Content is NOT stored yet.
2. `PATCH .../procedures/$PROCEDURE_ID/draft` with `name` + `content` + `type` → stores the body on the draft. The response echoes the real `name` and content length; check that length matches what you sent.
3. `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` re-sending the branch's current prompt → publishes the draft into a new version.

Then verify with `GET .../procedures/$PROCEDURE_ID` (now 200, with content) and confirm `has_draft: false` in the list. Until step 3, that GET 404s and the body is only in the draft.

Build request bodies with a JSON serializer rather than hand-written strings — procedure content is multi-line markdown, and a raw newline in a hand-built payload fails with a `json_invalid` "Invalid control character" 422 that looks like a schema problem but is a quoting bug.

## 3. Content-shape gotchas that cause the failures

1. `content` is ONE string, not structured fields. For `free_form` it is a single markdown string folding the trigger and the steps into it. There are no separate `trigger` / `instructions` / `steps` parameters. Splitting them into separate args, or sending a nested object, is a top validation failure.
2. An edit draft replaces the whole body. Whatever `content` you send becomes the entire procedure; anything you omit is gone. Always start from the current content you read in step 1, modify it, and send the complete result. This is the number one cause of accidental data loss.
3. On the draft edit, `name`, `content`, and `type` are all required every time — even for a rename. To rename without touching the body, resend the existing content and type alongside the new name. To edit the body without renaming, resend the existing name and type.
4. `type` is REQUIRED on the draft edit — you cannot omit it to inherit the current type. Read the procedure's existing `type` from the list first and resend that exact value; sending the wrong one converts the procedure's form. Only `free_form` and `deterministic` are valid; an empty string or any other value fails. (`type` is genuinely optional on the create POST, where it defaults to `free_form`.)
5. Deterministic procedures: `content` must be a valid JSON string describing the flow. Malformed JSON, or free-form markdown while `type` is `deterministic`, fails. If unsure of the schema, read an existing deterministic procedure's content as a template, or see the `architect-structured-procedures` skill. Editing a deterministic procedure recompiles automatically, so keep the JSON well-formed. Compile explicitly via `POST /v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/compile`.
6. `name` is capped at 200 characters. Keep it short; put the detail in `content`.

## 4. Recover from a failed call by error

- `schema_mismatch` (often no field detail): the content shape is wrong for the type. Re-check step 3. Usually you split trigger and steps into separate fields, sent an object instead of a string, or sent markdown for a `deterministic` procedure with broken JSON. Rebuild content as a single correctly-typed string; do not blind-retry the identical payload.
- `validation`: a concrete required arg is missing, usually `content`, `name`, or `type` on the draft edit, or `procedure_id`. Supply the named field, resending the existing value for anything you were not trying to change.
- `not_found` / 404 on the single-procedure GET: decide which case you are in. (a) The procedure exists but has no published content yet — it was just created, or only ever draft-edited. The GET 404s until a publish commits a body, while the list still shows the procedure. Confirm with the list; if it is there, this is expected and the fix is to publish, not to retry the read. (b) A genuinely wrong or stale id, or you are on a different branch than where it lives. Re-list procedures on the intended branch to get the current id, then retry. Do not carry a `procedure_id` across a branch switch.
- 422 `{"type":"missing","loc":["body","type"]}` on the draft edit: you omitted `type`. It is required here even though the create endpoint defaults it. Resend with the procedure's existing `type` from the list.
- 405 on `PATCH .../procedures/$PROCEDURE_ID`: you dropped the `/draft` suffix. Re-issue against `.../procedures/$PROCEDURE_ID/draft`.

## 5. Guardrail prompts are not in the procedure body

A procedure's guardrails are a separate first-class field on the procedure, not text inside `content`. If a user asks to edit "the guardrail prompt", do not look for it in the content string. Read the procedure to see its configured guardrails, tell the user plainly that the draft-edit path covers name, content, trigger, and type only, and do not smuggle guardrail text into `content` (it will not be enforced as a guardrail and silently changes the body instead).

## 6. Confirm and cross-reference

After a successful write, tell the user exactly what changed (created, edited, or renamed), on which branch, and that it sits on the branch draft until published and only goes live on merge. For branch and traffic-split workflow when staging a change for review before it goes live, see the branch and versioning guidance. If the user actually wants to change behavior via the prompt, LLM, voice, or tools rather than a procedure, that is a config change, not a procedure edit.
