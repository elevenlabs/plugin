---
name: architect-edit-string-fields
description: Use when changing wording inside a long text field on an agent (system prompt, first message / greeting, tool description, workflow node prompt, or procedure content) - "add this to the prompt", "change this line", "append a rule", "reword the greeting", "fix the tool description" - or when a previous edit clobbered or failed to save the field.
---

# Edit large string fields

Change one long text field by reading it, editing the whole string locally, and writing it back. Do not resend a big multi-field config blob to change wording. Broad config PATCHes are the high-failure path, and resending a big blob risks silently dropping the rest of the field.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY`, `$AGENT_ID`, and `$BRANCH_ID`.

The general move is read, modify, write: GET the field, produce the full new string (append a line, replace a passage, or rewrite wholesale), then PATCH the whole field back. There is no browser find/replace and no read-before-edit gate here. You always have the current text because you just fetched it, so compute the exact new string yourself and never edit from memory.

## System prompt and first message

Read the field from the branch-scoped agent:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" -H "xi-api-key: $API_KEY" \
  | jq -r '.conversation_config.agent.prompt.prompt' > prompt.txt
```

Edit `prompt.txt` to the full intended text (append your rule, replace the passage, or rewrite it), then PATCH the whole string back. A partial-merge PATCH commits to branch HEAD and returns a new `version_id`:

```bash
curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID&version_description=prompt-edit" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"conversation_config\":{\"agent\":{\"prompt\":{\"prompt\":$(jq -Rs . < prompt.txt)}}}}"
```

`jq -Rs .` JSON-encodes the whole file, so quotes, arrows, dashes, and newlines are handled for you. For the first message, read and write `conversation_config.agent.first_message` the same way.

## Tool description

The description lives on the tool, not the agent. Get the tool, edit its `description`, and PATCH the full tool config back (the PATCH replaces the tool):

```bash
curl -s "https://api.elevenlabs.io/v1/convai/tools/$TOOL_ID" -H "xi-api-key: $API_KEY" > tool.json
# edit the description field in tool.json to the full new string
curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/tools/$TOOL_ID" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  --data-binary @tool.json
```

## Workflow node prompt

The node prompt lives in the workflow inside the agent config. Only `override_agent` nodes and prompt-type `say` nodes have an editable prompt. Read `workflow` from the branch-scoped agent, find the node by id, set its prompt string to the full new text, and PATCH the workflow back through the config. If you cannot find an editable prompt on the node, you have the wrong node id or a non-editable node type.

## Procedure content

Procedure content does not go through the agent-config PATCH. It goes through the procedure draft, then a publish. This is two steps, and there is no direct PATCH on a procedure (that returns 405).

```bash
# 1. Read the current procedure body.
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID" \
  -H "xi-api-key: $API_KEY"

# 2. Stage the full new content as a draft (send name, content, type, trigger).
curl -s -X PATCH \
  "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID/draft" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"...","content":"...","type":"free_form","trigger":"..."}'

# 3. Publish pending drafts by committing the agent with any partial-merge body.
#    Re-sending the branch's current prompt unchanged is the simplest no-op publish.
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" -H "xi-api-key: $API_KEY" \
  | jq -r '.conversation_config.agent.prompt.prompt' > current_prompt.txt
curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID&version_description=publish-procedure" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"conversation_config\":{\"agent\":{\"prompt\":{\"prompt\":$(jq -Rs . < current_prompt.txt)}}}}"
```

Fetch the current prompt scoped to `$BRANCH_ID` (not main) before the no-op publish so you do not clobber other branch-local differences. A full-content draft PATCH replaces the whole body, so it is cleaner than trying to splice a passage in place. The draft PATCH cannot change a procedure's `type`.

## Verify

After any write, re-read the same field and confirm the new text is present and nothing else was disturbed. For procedures, confirm the `version_id` changed after the publish step. These edits land on the current branch and ship only when the branch is merged, so remind the engineer to review and test the new behavior before merging.

## When it is not a string-field edit

A change to language, TTS model, LLM, or any non-text single field is not a string edit. Route it through the config PATCH flow and remember the language and TTS-model cross-field constraint. See the `architect-update-config-safely` skill.
