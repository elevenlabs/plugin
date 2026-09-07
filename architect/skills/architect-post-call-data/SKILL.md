---
name: architect-post-call-data
description: Use when the user wants to extract structured fields from finished calls (data collection) or define success/failure evaluation criteria for post-call analysis. Covers field types, enums, the independent-extraction rule, writing criteria as questions, UNKNOWN for early termination, and the 2000-character limit.
---

# Set up post-call data collection and evaluation criteria

Two related but separate post-call configs. Data collection answers "what facts were in the call?"; evaluation criteria answer "was the call good?". Both are written with `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`), branch-scoped, live on merge.

## Ground the design in real calls first

Before proposing fields or criteria, read the agent and a representative sample of its conversations (in parallel where independent):

- `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`: read the system prompt and `first_message` to see what the agent is positioned to gather, and read the existing `platform_settings.evaluation.criteria` and `conversation_config.platform_settings.data_collection` so you extend rather than clobber.
- `GET /v1/convai/conversations?agent_id=$AGENT_ID`: recent call volume and a sample to inspect.
- `GET /v1/convai/conversations/{cid}` on 2-3 of those: confirm the target data actually appears in transcripts, and note the exact phrasing the agent uses and where calls terminate early. These payloads carry customer PII; do not copy transcripts into other systems or logs, and respect zero-retention-mode accounts.

## Part 1: Data collection (structured extraction)

An independent post-call LLM extraction runs over the transcript for each field. Config lives at `conversation_config.platform_settings.data_collection`, an object keyed by field name. Each field has `type`, `description` (the extraction prompt), an optional `enum`, and value-source flags.

Design each field against these rules:

- `description` IS the extraction prompt. Be specific: "The caller's full legal name as confirmed during the call", not "Customer name". Keep it under ~500 characters; long descriptions dilute the instruction.
- Pick the type by the data: `boolean` for yes/no facts, `string` with an `enum` for categories (for example `call_outcome` with `["completed","declined","transferred"]`), `integer`/`number` for amounts. Using `string` for a yes/no fact yields "yes"/"no" text instead of a real boolean.
- Use `enum` liberally. Even a large enum (50+ values) gives stronger guidance than prose and prevents free-text drift. Cover every realistic outcome; a missing value comes back null.
- Fields are extracted independently, one LLM call each. A field's description cannot reference another field. "Only if coverage_active is yes..." will not work, because this extraction never sees another field's result. Bake any needed condition into this field's own description.
- Scalar values only, no comma-separated multi-value answers. If you need several values, split into a primary `enum` field plus a secondary free-text `string` field.
- Design for null. If the caller hangs up early, most fields will be null. That is expected, not an error; tell the user null means "not discussed".

Write it: `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` with body `{"conversation_config":{"platform_settings":{"data_collection":{...}}}}`. Merge with the existing fields you read above; do not replace the whole `data_collection` object unless the user explicitly wants a reset.

## Part 2: Evaluation criteria

Each criterion is a separate post-call LLM call scored SUCCESS / FAILURE / UNKNOWN. Its `conversation_goal_prompt` is capped at 2000 characters. Aim for 3-5 criteria, not an exhaustive list. Write each one against these rules:

- Write as a question, not an instruction. "Evaluate whether the agent collected all required fields", not "The agent should collect all fields". Criteria grade behavior; they do not tell the agent what to do (that belongs in the system prompt).
- Be specific about SUCCESS vs FAILURE, using the exact phrasing you saw in the transcripts: "Mark SUCCESS only if the agent read the disclosure starting with [exact phrase]".
- Always add UNKNOWN guidance for early termination. Every criterion that depends on a later phase needs a line like "If the call ended before reaching this phase, mark UNKNOWN rather than FAILURE." Without it, early hangups drag the success rate down for a step that never ran.
- Group related checks into one criterion. Instead of four disclosure criteria, combine: "Evaluate whether ALL of the following were read: (1)..., (2)..., (3)...". Fewer, richer criteria are cheaper (each is its own LLM call) and easier to read.
- Cover compliance (were required disclosures read?), completeness (were all fields collected?), accuracy (were facts stated correctly?), and boundaries (did the agent stay in scope?).
- Respect the 2000-character limit per criterion. Grouping is how you fit a thorough check; if a grouped criterion is still too long, split along a natural seam rather than trimming the specificity that makes it useful.
- Do not make it brittle. Criteria that fail on valid conversations make the success rate misleading.

Write it: `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` with body `{"platform_settings":{"evaluation":{"criteria":[...]}}}`. Send the FULL array; the write replaces the criteria list, so include the criteria you read above plus the new ones.

## Verify

Criteria only mean something once conversations are scored against them. Have the user run a simulation test or wait for a few live calls, then re-open graded conversations with `GET /v1/convai/conversations/{cid}` and confirm the SUCCESS / FAILURE / UNKNOWN verdicts match your judgment. If a criterion fails on a call you would call good, it is too strict; loosen the wording or add the missing UNKNOWN branch.

## Related

- If the user wants a value known BEFORE the call (for example an account id passed in at session start), that is a dynamic variable, not a data collection field.
- If fields later come back null or wrong, re-check description specificity, type match, enum coverage, and whether the data is even in the transcript.
