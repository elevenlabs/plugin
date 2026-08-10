# Iterating on an existing agent

This is the playbook for changing an agent that already exists: reading its current setup,
editing config safely, managing branches and versions, creating and fixing tools, writing
tests, and authoring procedures. It is written for the **ElevenLabs hosted MCP**
(`elevenlabs-hosted` in [mcp.json](../../../mcp.json)), which exposes each operation as a direct
tool and authenticates per user over OAuth. The same operations are available over the SDK/CLI
with `xi-api-key`; where a tool is named below, use the matching SDK call if you prefer keys.

The tools referenced here: `get_agent`, `update_agent`, `create_agent`, `duplicate_agent`,
`list_tools`, `get_tool`, `create_tool`, `update_tool`, `delete_tool`, `list_branches`,
`create_branch`, `get_branch`, `update_branch`, `get_version`, `merge_branch_preview`,
`merge_branch`, `create_deployment`, `list_procedures`, `get_procedure`, `create_procedure`,
`update_procedure_draft`, `get_procedure_draft`, `compile_procedures`, `create_test`,
`list_tests`, `get_test`, `run_tests`, `list_test_runs`, `get_test_run`, `list_conversations`,
`get_conversation`, `create_kb_text`, `create_kb_url`.

Destructive tools (`delete_*`, `merge_branch`, `create_deployment`) are surfaced for approval by
the coding agent before they run.

## 1. Explore before you change

Read just enough of the current config to act; never pull the whole thing blindly. Call
`get_agent` scoped to the fields the task needs (name, `conversation_config.agent.prompt.prompt`,
`conversation_config.agent.llm`, etc.). The workflow, if any, is on this same config. To inspect
one tool, take its id from `conversation_config.agent.prompt.tool_ids` and call `get_tool`; do not
fetch the whole config to read one tool. Use `list_procedures` for names and triggers, and
`get_procedure` for a single body you have the id for. Where several reads are independent, make
them in parallel. Summarize the current setup in one sentence, then make the change.

## 2. Apply a config change safely (patch, not overwrite)

Prompt, first message, name, LLM, voice, criteria, and `platform_settings` are edited with a
**partial** `update_agent` body. It merges into the current config and commits to the branch head,
returning a new version id. No draft/publish dance. Keep the body minimal, one leaf for the common
case, and group fields only when they must move together.

- Prompt: `{"conversation_config":{"agent":{"prompt":{"prompt":"..."}}}}`
- LLM: `{"conversation_config":{"agent":{"llm":"..."}}}`
- Turn taking: `{"conversation_config":{"turn":{"speculative_turn": true}}}`
- Evaluation criteria: `{"platform_settings":{"evaluation":{"criteria":[...]}}}`. Send the FULL
  array (you replace the list); each `conversation_goal_prompt` is capped at 2000 characters.
- Data collection: `{"conversation_config":{"platform_settings":{"data_collection":{...}}}}`.
  Merge into the existing object, do not clobber sibling fields.

Tool config is not an agent-config edit; route tool changes to `update_tool` (section 4).

## 3. Editing large string fields (prompt, first message, tool/node text, procedure body)

There is no find-and-replace tool. Read the full field first (`get_agent`, `get_tool`, or
`get_procedure_draft`), edit the whole string locally, and write it back with `update_agent`,
`update_tool`, or `update_procedure_draft`. Match existing text verbatim, watch escaping and
whitespace, and make one edit at a time so you can confirm each landed.

## 4. Tools

Create and update tools with the unified `create_tool` / `update_tool`, discriminated by type in
`tool_config` (webhook/server, client, or code). To edit an existing tool, read it first with
`get_tool`, change only what you need in the config you read, and send the FULL config back:
`update_tool` replaces the config, so a partial nested object silently drops fields. System tools
(`transfer_to_number`, `end_call`, `language_detection`, etc.) are not edited via `update_tool`;
they live in the agent config, so edit them with `update_agent`.

Webhook tools fail most often on the `api_schema.request_body_schema` shape and on routing. Before
writing one, `list_tools` to avoid duplicates and match the naming already in use, and confirm
whether the agent is single-node or a workflow so you attach the tool in the right place. Client
tools run in the caller's app, so they only make sense when there is a client runtime to execute
them.

## 5. Branches, versions, and launches

Branches are versioned snapshots; the main branch takes 100% of traffic unless a split is
configured. Never pass a branch id you have not just confirmed with `list_branches` in the same
turn; resolve a branch name to its id there. Route each operation to its tool: `create_branch`,
`get_branch`, `update_branch`, `get_version`. For a merge, always run `merge_branch_preview`
first, then `merge_branch`. Ramp traffic with `create_deployment`. If the target branch is
admin-protected and the user is not an admin, say so up front rather than failing at merge time.

To stage a change for a launch, do the work on a non-live branch and hold the merge until go-live.
There is no timer: staging means keeping the change on a branch and merging (or ramping) when the
user is ready. Prompt, tool, and knowledge-base changes are branch-scoped and only ship on merge,
which is what makes staging reliable.

## 6. Procedures

Procedures are reusable, trigger-loaded guidance attached to an agent. List them with
`list_procedures` (names and triggers) and read one with `get_procedure`. Creating a procedure
(`create_procedure`) or editing one (`update_procedure_draft`) writes a DRAFT; a subsequent
`update_agent` call publishes pending procedure drafts into a new version. `get_procedure` returns
draft content when a draft exists. Use `compile_procedures` for structured (deterministic)
procedures. Keep each procedure's trigger specific so it loads at the right moment.

## 7. Tests

Create tests with `create_test`, discriminated by `type`:

- `llm`: judge a single agent reply against a natural-language success condition.
- `tool`: assert the agent calls a specific tool with the right parameters.
- `simulation`: a simulated user drives a full multi-turn conversation judged against success
  conditions. Use simulation for anything where the value is in the multi-turn flow.

For simulation tests, keep `simulation_scenario` (instructions to the simulated user) distinct
from `success_condition` (the rubric for the agent); swapping them is the most common mistake.
`tool_mock_config` is an object with `mocking_strategy` and `fallback_strategy`; mocking
everything with `raise_error` and no mocks makes every tool error out, so mock the read/discovery
tools the agent needs plus the tool under test. Provide every `dynamic_variables` placeholder the
prompt references.

Attach a test so it runs with the suite by adding it to `platform_settings.testing.attached_tests`
via `update_agent`. Run tests with `run_tests`, then poll `get_test_run` (simulation runs take
minutes). To understand a result, read the rationale and transcript from `get_test_run`, compare a
passing run against a failing one, and answer with the specific turn where they diverge, not the
criterion name. Identical config with different outcomes is model non-determinism: tighten the
criterion or move the requirement into a deterministic procedure.

## 8. Memory and durable facts

There is no separate per-agent memory store over these tools. For a durable fact the agent should
recall, add a concise line to the system prompt with `update_agent`, or add a knowledge-base
document with `create_kb_text` / `create_kb_url`. Both are branch-scoped, so they let you stage a
fact for a launch. Prefer a knowledge-base document when the fact could instead come from a crawled
source or an API that stays current.

## Data handling

Conversation tools (`list_conversations`, `get_conversation`) can return transcripts and analysis
containing customer PII. Do not copy that content into other systems or logs, and respect
zero-retention-mode accounts.
