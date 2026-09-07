---
name: fix-agent-qa-ticket
description: >
  Fix an Architect QA triage ticket (agtqa_*) end-to-end via the raw agents
  API: fetch the ticket + conversation, find the root-cause procedure or prompt
  text, fix it on a branch, add + run a simulation test proving the fix, then post
  a summary comment on the ticket. Use when asked to "fix agtqa_...", "address this
  QA ticket", "triage and fix this Architect ticket", or given an agtqa_* id/URL.
---

# Fix a QA ticket (agtqa_*)

`agtqa_*` = an Agent Conversation Triage Ticket: a reviewer's flagged comments
against specific turns of a real Architect/ConvAI conversation. This skill turns
one of those tickets into a verified, branch-scoped fix, entirely through the raw
ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key`). It never
touches main directly — it stages everything on a branch and leaves merging to
the user.

**Needs from the user**: an API key and a ticket id (`agtqa_...`) or a URL
containing one. Everything else — agent id, conversation id, branch — is derived
from the ticket.

**Platform-only.** Do not write repo code as part of this skill unless the root
cause is actually a code bug (rare — most triage findings are prompt/procedure
gaps). If code IS the root cause, say so and hand off instead of guessing at a
platform-side workaround.

## 1. Fetch the ticket

```bash
curl -s "https://api.elevenlabs.io/v1/convai/conversation-triage-tickets/$TICKET_ID" \
  -H "xi-api-key: $API_KEY"
```

Returns `conversation_id`, `agent_id`, `qa_comment`, `ticket_comments[]`,
`turn_comments[]` (each with `turn_index` + `comment`), `status`
(`open`/`in_progress`/`resolved`).

## 2. Fetch the conversation and read the flagged turns

```bash
curl -s "https://api.elevenlabs.io/v1/convai/conversations/$CONVERSATION_ID" \
  -H "xi-api-key: $API_KEY"
```

`transcript[]` has per-turn `role`, `message`, `tool_calls` (each with
`tool_name` + `params_as_json`). Read a window around every `turn_index` named in
`turn_comments` — usually a couple turns before and after — to understand what
the agent actually did and said. The reviewer's comments tell you *what's wrong*;
the transcript tells you *why*. Don't skip straight to guessing the fix — find
the specific tool call, prompt gap, or missing instruction that produced the bad
turn.

The conversation also carries `branch_id` and `version_id` — useful context, but
**do not build your fix branch off this conversation's branch** unless it's
demonstrably the right base (check `is_archived` / whether it's actually merged
into main — see step 3). It's just where the flagged conversation happened to run.

## 3. Create a fix branch off main's actual tip

Get the agent and find its real main branch:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID" -H "xi-api-key: $API_KEY"
# -> .main_branch_id, .branch_id (top-level is usually main)
```

Then fetch that branch to get its true HEAD version (do not assume — a stray
personal/archived branch can look tempting but have unrelated commits in its
ancestry):

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches/$MAIN_BRANCH_ID" \
  -H "xi-api-key: $API_KEY"
# -> .most_recent_versions[0].id  is main's real tip version_id
```

Create the branch from that exact version:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "<you>/qa-<ticket-suffix>-<short-desc>", "description": "Fix for '"$TICKET_ID"'", "parent_version_id": "<main-tip-version-id>"}'
```

Required fields are `name`, `description`, `parent_version_id` (all three, or
you get a 422 listing what's missing). Response: `{created_branch_id,
created_version_id}`.

## 4. Find and fix the root cause

Usually one of:
- **A procedure** missing an instruction (list via
  `GET .../agents/{id}/branches/{b}/procedures`, fetch full content via
  `GET .../procedures/{pid}`). Search procedure names/triggers for the relevant
  topic (dashboards, refunds, whatever the ticket concerns).
- **The system prompt** (`conversation_config.agent.prompt.prompt` off
  `GET /v1/convai/agents/{id}?branch_id={b}`).

### Editing an existing procedure (draft + publish dance)

Editing an existing procedure is **two steps**, not one — there is no direct
commit-on-PATCH for procedures:

```bash
# 1. Stage the draft (full content: frontmatter + body, or per-field if the
#    procedure isn't markdown-frontmatter style)
curl -s -X PATCH \
  "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches/$BRANCH_ID/procedures/$PROCEDURE_ID/draft" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "...", "content": "...", "type": "free_form", "trigger": "..."}'

# 2. Publish ALL pending procedure drafts on the branch by re-committing the
#    agent with any partial merge body (re-sending the branch's current,
#    unmodified prompt is the simplest no-op payload). Fetch the CURRENT prompt
#    scoped to $BRANCH_ID first (not main's) so you don't clobber other
#    branch-local differences:
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" -H "xi-api-key: $API_KEY" \
  | jq -r '.conversation_config.agent.prompt.prompt' > current_prompt.txt

curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID&version_description=..." \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"conversation_config\": {\"agent\": {\"prompt\": {\"prompt\": $(jq -Rs . < current_prompt.txt)}}}}"
```

Verify by re-`GET`ting the procedure and confirming the `version_id` changed and
the new content is present.

A direct `PATCH .../procedures/{pid}` (no `/draft` suffix) does not exist —
returns 405. Creating a brand-new procedure via `POST .../procedures` commits
immediately, but don't use that to "replace" an existing one in place — it
leaves two procedures with overlapping/duplicate triggers, which is worse than
the bug you're fixing.

### Editing the prompt / criteria directly

No draft dance needed — a partial-merge `PATCH /v1/convai/agents/{id}?branch_id={b}`
commits straight to branch HEAD and returns a new `version_id`:
- prompt: `{"conversation_config":{"agent":{"prompt":{"prompt":"..."}}}}`
- criteria: `{"platform_settings":{"evaluation":{"criteria":[...]}}}` (send the
  full array; each `conversation_goal_prompt` max 2000 chars)

## 5. Add a simulation test that reproduces the ticket's scenario

**Always use a `simulation` test for Architect/DOM agents** — `llm`/`response`
tests only grade the agent's first action, which for Architect is almost always
`start_procedure`, so the judge returns useless `unknown`/`failure` verdicts.

```bash
# Optional: group tests for this ticket
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agent-testing/folders" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "QA '"$TICKET_ID"'"}'

curl -s -X POST "https://api.elevenlabs.io/v1/convai/agent-testing/create" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "simulation",
    "name": "<short description> ('"$TICKET_ID"')",
    "parent_folder_id": "<folder id or omit>",
    "simulation_scenario": "<persona + exactly what they do, mirroring the ticket>",
    "success_conditions": ["<checklist item 1>", "<checklist item 2>", ...],
    "simulation_max_turns": 8,
    "tool_mock_config": {"mocking_strategy": "all", "fallback_strategy": "raise_error"},
    "chat_history": [{"role": "user", "message": "...", "time_in_call_secs": 0}],
    "dynamic_variables": {"tier": "enterprise", "product": "conversational_ai", "objective": "...", "userInfo": "{}", "chatHistory": "[]"}
  }'
```

Gotchas that produce 422s:
- Every `chat_history` entry needs `time_in_call_secs` (even `0`), or you get a
  `missing` error pointing at that field.
- `chat_history` must end with a user message.
- A `system`-type `tool_result` inside `chat_history` needs `is_error` +
  `tool_has_been_called` fields.
- `dynamic_variables` should include whatever the prompt templates on
  (tier/product/objective/userInfo/chatHistory at minimum) or templating crashes
  mid-run.
- `mocking_strategy` is an enum of exactly `all` / `selected` / `none` — there
  is no fourth value. **`"all"` ignores `tool_mock_overrides` entirely** — it
  mocks every tool call with the generic fallback error, even if you've set a
  per-tool `mock_result`. If the fix you're testing depends on a specific tool
  actually returning realistic data (e.g. `list_branches` returning a branch
  list so the agent can resolve a name to an id), you MUST use
  `mocking_strategy: "selected"` with `mocked_tool_ids: [...]` naming every
  tool you want mocked — `"all"` silently no-ops your overrides and you'll see
  "no mock matched" in the transcript even though the override is saved
  correctly on the test (verify via `GET /v1/convai/agent-testing/{test_id}`
  if a mock isn't taking effect — the stored config can look right while the
  run still fails, which means the strategy, not the override, is wrong).
- `tool_mock_overrides` shape: `{"<tool_name>": [{"mock_result":
  "<json-string>", "parameter_conditions": [], "is_error": false}]}`.
  `mock_result` is a JSON-encoded **string**, not a nested object — build it
  with `json.dumps(...)` (or equivalent) before embedding it in the request
  body. An empty `parameter_conditions` list means "match unconditionally."
- `mocking_strategy: "all"` + `fallback_strategy: "raise_error"` (no overrides)
  makes *every* tool call error mid-conversation ("technical difficulties").
  Fine only for testing something that doesn't depend on a tool succeeding
  (e.g. a confirmation-message wording fix where the tool call itself is
  incidental); if the flow needs a tool to actually succeed with realistic
  data, use `selected` + overrides instead of reaching for `call_real_tool`.
- DOM-write tools (navigate, set_dashboard_filters, etc.) still may not fully
  green in the sim harness even with `selected` mocking if you haven't mocked
  every tool in the chain — treat persistent failures there as behavior
  documentation, not a bug, once you've confirmed the mocking strategy itself
  isn't the culprit.

Write the `success_conditions` directly against the reviewer's `turn_comments` —
each comment should map to a checklist item the grader can verify. Word each
condition to name the CORRECT id/value explicitly (e.g. "uses id X, not the
raw name string and not id Y") rather than just "doesn't guess" — a vague
condition lets a new, differently-wrong failure mode (e.g. passing the name
itself as the id) slip through as a pass.

**Editing a sim test = delete + recreate.** There is no in-place edit for a
simulation test (`PUT` on a test id is response/llm-only and rejects
`type: simulation`). If a run reveals your mock config was wrong, `DELETE
/v1/convai/agent-testing/{test_id}`, fix the payload, and `POST .../create`
again — then re-attach and re-run.

Attach it to the agent/branch, then run it:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/testing/attach-test" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"test_id": "'"$TEST_ID"'", "branch_id": "'"$BRANCH_ID"'"}'

curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/run-tests" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"tests": [{"test_id": "'"$TEST_ID"'"}], "branch_id": "'"$BRANCH_ID"'", "repeat_count": 1}'
# -> {id: suite_id, test_runs: [{test_run_id, status: "pending", ...}]}
```

## 6. Poll for the result

Sim runs take a few minutes. Poll `GET
/v1/convai/test-invocations/{suite_id}` until `test_runs[0].status` leaves
`pending`. Use a background poll loop (Bash `run_in_background` or Monitor), not
a foreground sleep — do not busy-wait in the conversation.

Once terminal, read `test_runs[0].condition_result.result`
(`success`/`failure`) and `.rationale.messages` (per-criterion grader
reasoning) to confirm the fix actually produces the intended behavior — don't
just check the pass/fail bit, skim the rationale for whether it's testing what
you think it's testing.

If it fails: re-read the rationale against the actual procedure/prompt change,
adjust, and re-run. Don't loosen `success_conditions` to force a pass unless
the condition itself was wrong (too strict/loose) — a passed test the reviewer's
concern doesn't check is worse than an honest failure.

## 7. Comment on the ticket

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/conversation-triage-tickets/$TICKET_ID/comments" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"comment": "<root cause>\n\n<what changed, branch id, not merged>\n\n<test id + PASS/FAIL + key rationale line>\n\nWritten by <model>, using Claude Code."}'
```

Include: the root cause in plain language, the branch id (explicitly "not
merged" — merging is the user's call), the test id and result, and identify
yourself per repo convention (`Written by {Model}, using {Harness}`).

**Leave ticket `status` as `open`** (don't PATCH it to `resolved`) unless the
user explicitly asks you to close it — you fixed and verified on a branch, but
the user still needs to review and merge.

## 8. Report back

Tell the user: root cause, branch id + that it's unmerged, test id + result,
and anything you had to work around (wrong-parent branch mistake, a blocked
destructive action, an ambiguous base branch) — these are exactly the kind of
judgment calls the user should sanity-check before merging.
