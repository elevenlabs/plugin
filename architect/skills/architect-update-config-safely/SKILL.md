---
name: architect-update-config-safely
description: Use when changing an agent setting (LLM, voice, TTS model, language, first message, ASR, guardrails, timeouts, turn-taking, data collection, evaluation criteria) and wanting it to actually apply, or on symptoms like "it won't save", "the change didn't take", "schema mismatch", "invalid config", "config validation failed", "set X to Y", or a language/voice change that broke the audio.
---

# Update agent config safely

Agent config edits fail often, most commonly with a schema mismatch that names no field, so a blind retry just fails again. The reliable path is: read the current state first, change one well-formed field at a time, and know the cross-field constraints before you send. Follow this every time you touch agent config.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID`.

## 1. Read the current state first

Fetch the branch-scoped config before writing anything:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $API_KEY"
```

This gives you the authoritative current config: the exact dotted path you intend to change, the current value you are about to overwrite, and the surrounding settings that constrain the edit (`conversation_config.agent.language`, `conversation_config.tts.model_id`, `conversation_config.agent.prompt.llm`, `voice_id`). The workflow ships in the same response. If the agent has a workflow, config can live partly on nodes (per-node prompt, additional tool ids, additional knowledge base), so confirm whether your change belongs on the base agent or on a node before you patch. Do not edit blind.

Where an edit references tools, read them via `GET /v1/convai/tools` and `GET /v1/convai/tools/{tool_id}`. Where you plan to re-run tests after the change, list them first. Make independent reads in parallel.

Do not invent config keys, enum values, or schema paths. Confirm the exact key name and legal value from the current config response, not from memory.

## 2. Prefer one field per PATCH

A partial-merge `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` commits straight to branch HEAD and returns a new `version_id`. Send the single leaf you want, nested in its real shape, rather than resending a big config blob. Common partial bodies:

- llm: `{"conversation_config":{"agent":{"llm":"..."}}}`
- tts model: `{"conversation_config":{"tts":{"model_id":"eleven_flash_v2_5"}}}`
- language: `{"conversation_config":{"agent":{"language":"..."}}}`
- first message: `{"conversation_config":{"agent":{"first_message":"..."}}}`
- turn taking: `{"conversation_config":{"turn":{"speculative_turn":true}}}`
- criteria: `{"platform_settings":{"evaluation":{"criteria":[...]}}}` (send the full array; each `conversation_goal_prompt` max 2000 chars)
- data collection: `{"conversation_config":{"platform_settings":{"data_collection":{...}}}}`

Add `&version_description=...` to label the version.

```bash
curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID&version_description=set-tts-model" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"conversation_config":{"tts":{"model_id":"eleven_flash_v2_5"}}}'
```

For a large text field (system prompt, first message, tool description, node prompt, procedure content), do not push the whole field through a config PATCH. Route to the string-field edit flow instead. See the `architect-edit-string-fields` skill.

Tool bodies (webhook/client/code tools) are not agent-config edits. Update them via `PATCH /v1/convai/tools/{tool_id}` (send the full tool config; it replaces). Workflow nodes and edges are not agent-config edits either.

## 3. Cross-field constraints and gotchas

- Language and TTS model move together (the big one). Changing `conversation_config.agent.language` to a non-English language while `conversation_config.tts.model_id` is an English-only model (`eleven_flash_v2`, `eleven_turbo_v2`) is rejected by validation, or the agent goes silent or garbled at call time. Always pair them: switch `model_id` to a multilingual model (`eleven_flash_v2_5`, `eleven_turbo_v2_5`, or an `eleven_v3` model) in the same change. Send both fields in one PATCH body, or send the model first and the language second.
- Voice vs model: some voices are trained for specific model families. If audio degrades after a model swap, verify `voice_id` is compatible.
- Send each value in its native type: booleans as real booleans, numbers as numbers, enums as the exact allowed string. A number sent as a string is a common silent schema mismatch.
- Enum-valued fields (execution modes, `transfer_type`, ASR quality, LLM model id) must match the allowed set exactly, e.g. `transfer_type` is `blind` or `conference`, never `warm`/`cold`.
- Character limits exist (`conversation_goal_prompt` about 2000 chars, data-collection field descriptions about 500 chars). Over-length values fail validation.

## 4. Recover by error

- `schema_mismatch` with no field detail: the payload shape is wrong. Do not blind-retry. Re-read the exact current shape, then send one field in its real nesting. If it was a language change, apply the language and TTS-model pairing above.
- `validation`: a value is out of range or format (too long, wrong enum, wrong type). Fix that one value against the limits above.
- `not_found`: wrong agent id or branch, a path that does not exist in this config, or a referenced id (tool id, voice id) not on this agent. Re-read the config to get valid paths and ids, and confirm you are on the intended branch.
- transient backend error: retry once. If it persists, treat it as one of the above.

## 5. Verify and follow up

If the change did not seem to take, re-read that single path from the branch-scoped config and compare. A value that reads back unchanged usually means a silent validation rejection or a cross-field constraint, not a glitch.

After a behavioral change, consider re-running the relevant test to confirm no regression. If the change is risky on a live agent, do it on a branch and split traffic rather than editing main directly. For which value to pick for a given setting (LLM choice, voice settings, security posture), defer to the topic-specific skill and use this one only for how to apply the edit safely.
