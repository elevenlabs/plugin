---
name: agents-platform
description: Manage ElevenLabs voice agents through the connected ElevenLabs MCP server. Use when the user asks to create, configure, test, deploy, or inspect agents, knowledge bases, agent tools, tests, or conversations directly on their ElevenLabs account — rather than writing application code. Requires the ElevenLabs MCP server bundled with this plugin.
license: MIT
---

# ElevenLabs Agents Platform (via MCP)

Workflow guidance for the `agents_*` tools on the ElevenLabs MCP server. Every
tool takes a `context` parameter — briefly state the user's goal in it. For
building agents in the user's own codebase (SDK, CLI, widget embedding), use the
general `agents` skill instead.

## Creating and updating agents

- Create with `agents_create` using the top-level fields (`name`, `prompt`,
  `first_message`, `voice_id`, `language`, `tags`). Only reach for the raw
  `body` escape hatch when a field has no top-level equivalent. `voice_id` is
  optional — the workspace default voice is used if omitted.
- Before changing an existing agent, read it: `agents_list` to find it,
  `agents_get` to see its current config, then `agents_update` with only the
  fields that should change.
- `agents_duplicate` clones an existing agent — prefer it over recreating a
  config by hand.
- Get a shareable/test link with `agents_get_link`; inspect widget config with
  `agents_get_widget`.

## Knowledge base

- Add documents with `agents_create_kb_url` (supports auto-sync for pages that
  change) or `agents_create_kb_text`; organize with `agents_create_kb_folder`.
- Before deleting a document, check `agents_get_kb_dependents` — other agents
  may use it. Confirm with the user before `agents_bulk_delete_knowledge_base`.
- Verify retrieval quality with `agents_query_knowledge_base_rag` or
  `agents_search_knowledge_base` after adding documents.

## Testing and deployment

- Create tests with `agents_create_test`: an LLM response test
  (`success_condition` prompt plus success/failure examples), a tool-call test
  (verify a tool was or wasn't called with expected parameters), or a
  simulation test (`simulation_scenario` persona plus `success_conditions`).
- Run and inspect with `agents_list_test_runs` / `agents_get_test_run`.
- For staged changes, branch: `agents_create_branch`, make edits, preview with
  `agents_merge_branch_preview`, then `agents_merge_branch` and
  `agents_create_deployment`.

## Conversations

- `agents_list_conversations` and `agents_get_conversation` inspect call
  history and transcripts; `agents_search_conversation_messages` finds
  specific exchanges. Use these to debug agent behavior before editing prompts.

## Safety

- Confirm with the user before destructive calls: `agents_delete`,
  `agents_delete_tool`, `agents_delete_phone_number`, knowledge-base bulk
  deletes. Deletions are not reversible.
- IDs (agent, document, tool, branch) only ever come from tool results — never
  guess or reconstruct them.
