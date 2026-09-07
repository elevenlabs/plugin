---
name: agent-simplification
description: "Simplify a complex ElevenLabs voice agent (typically a large workflow agent) into a leaner architecture — fewer workflow nodes, deduplicated prompts, procedures where they help — while PROVING with a ground-truth test suite that every behaviour of the original is preserved or improved. Use when the user says things like 'simplify this agent', 'flatten this workflow', 'this agent is too complex', 'consolidate these nodes', 'rebuild this agent with fewer nodes', 'can we replace this workflow with procedures', or asks whether a big workflow agent can be made easier to maintain without losing behaviour."
---

# ElevenLabs Agent Simplification

Turn a complex agent (usually a many-node workflow) into a simpler one that is **provably at least
as good**. The core loop: understand everything the complex agent does → encode it as a test suite
(ground truth) → build the simpler agent → iterate until it matches or beats the original on every
test → A/B on branches → hand over with an honest report.

The output is never just a simpler agent. It is a simpler agent **plus the test suite that proves
equivalence**, attached natively in the platform so the client can re-run it.

## Non-negotiable safety rails

- **Never edit the production agent, global tools, the knowledge base, or shared tests.** Work on a
  duplicate agent or a branch. Tools and KB documents are workspace-global — editing them changes
  prod. Procedures are per-agent (cloned on duplicate), so a copy's procedures are safe to edit.
- Before any PATCH, verify you are targeting the copy/branch (`agent_id` / `branch_id` check in the
  script). Make every write script refuse to run against anything else.
- Snapshot the full agent JSON before the first change (rollback + later diffing).
- **PII hygiene:** real transcripts contain names/numbers. Keep them in scratch space, never commit
  them, and delete them when done. Scrub any dynamic-variable seed derived from a real call
  (replace the client name, activation date, etc.). Conversation IDs are fine to reference.

## Phase 1 — Understand the complex agent completely

Pull the agent JSON (`GET /v1/convai/agents/{id}`) and map every layer:

1. **Base prompt** (`conversation_config.agent.prompt.prompt`).
2. **Workflow nodes — read `additional_prompt`, not just `prompt.prompt`.** This is the #1 trap:
   an `override_agent` node's real instructions live in `additional_prompt` (the studio
   "Conversation goal" box, APPENDED to the base prompt). `conversation_config.agent.prompt.prompt`
   on a node is only set when the "Override prompt" toggle is ON. A node whose `prompt.prompt` is
   empty is NOT an empty node. Extract every node's `additional_prompt` to a file — in a real case
   16 "empty-looking" nodes carried ~100k chars of specialized business logic.
3. **Edges** — routing conditions (`forward_condition.label`), in/out degrees. The only **dead
   nodes** are orphans (no incoming edge = unreachable) and fully disconnected nodes (no edges at
   all). Anything with edges is a live decision point — every node has an LLM choosing among its
   outgoing edges, even a tool node with an empty tool list — so it cannot be considered for
   removal unless genuine logic duplication is proven.
4. **Per-node scoping** — `additional_knowledge_base` / `additional_tool_ids`. Check whether the
   base agent already exposes the same KB (folders in RAG `auto` mode = every doc) and tools; if so
   the scoping is redundant, not behaviour.
5. **Say nodes** — fixed messages the client wants said verbatim (goodbyes, transfer preambles,
   mandated phrases). These become wording-parity tests later.
6. **Transfer machinery** — compare workflow `phone_number` node destinations against the base
   `transfer_to_number` system tool (destination SIP/number + its `condition` text). Often
   identical → the workflow transfer scaffolding is redundant. Check real usage: count tool fires
   across recent conversations (which transfer path actually runs in prod?).
7. **Dispatch tools** (tool nodes in the graph) — these fire **deterministically** whenever the
   graph reaches that node, whereas agent-attached tools fire at the LLM's discretion. Examine each
   one: which paths reach it, and what guarantee does it provide? Flattening removes that guarantee,
   so every dispatch path needs a test proving the tool still fires in the simplified agent. Some
   dispatch tools also turn out redundant (e.g. a "say X then transfer" preamble tool duplicating
   what the `transfer_to_number` system tool already does) — check real-call tool-fire counts before
   deciding.
8. **Procedures, system tools (`built_in_tools`), language config** — note `language_presets` lives
   at the TOP level of `conversation_config`, not under `.agent`.
9. **Real conversations** — pull recent calls (`GET /v1/convai/conversations?agent_id=&page_size=100`,
   paginate; detail per call). Categorize (use the agent's own `call_category` data-collection if
   present), count tool fires, and note failure modes. This tells you which paths matter and at what
   frequency.

If you find duplicated logic anywhere (repeated boilerplate across nodes, per-node scoping the base
already has, scaffolding duplicating a system tool), simply remove it in the simplified build —
after confirming it is a true duplicate, not a variant.

## Phase 2 — Build the ground-truth test suite BEFORE simplifying

Derive test scenarios from **both** sources:
- **The complex agent itself**: every distinct behaviour in the node `additional_prompt`s, the base
  prompt's flows (e.g. an operator-transfer escalation sequence), each qualifying-transfer case,
  say-node wording, dispatch-tool paths, procedure flows, tool-consent rules, deprecated services,
  coverage/country rules, language policy.
- **Real conversations**: one scenario per distinct path/category actually observed, phrased as a
  simulated-user persona (reference the source `conv_` id in the scenario for traceability).

Two complementary instruments — pick per behaviour:

| | `simulation` tests (multi-turn) | `llm` tests (single-turn) |
|---|---|---|
| What | Simulated user persona converses N turns; whole conversation judged against `success_conditions` | Fixed `chat_history`; judge the agent's NEXT reply against `success_condition` |
| Use for | Procedure-driven and multi-step flows (diagnostics, escalation sequences, retention) | Sharp single decision points (don't transfer on first demand; reply language; refusal) |
| Avoid for | — | Any flow whose first agent turn is a tool call (`start_procedure`, `language_detection`): the judge sees no text → `unknown`. Use a simulation test instead. |

Criteria-writing rules (learned the hard way):
- **Verify every fact in a criterion against the KB before asserting it.** Do not label something a
  hallucination until you've grepped the KB (a "made-up" USSD code turned out to be documented).
- **Accept reasonable behaviour.** If answering a direct question briefly before a still-needed
  transfer is fine, say so in the criterion. Over-strict criteria create false failures you'll then
  "fix" wrongly.
- **Don't let the scenario undermine the premise.** If testing "plain SIM fails where partner is
  4G-only", pin a country that actually has no 3G (check the KB), or the agent will be correct and
  the test wrong.
- **Don't test `end_call`.** Test harnesses don't simulate call termination reliably, and the caller
  hangs up anyway. Testing that the agent does NOT hang up prematurely is fine.
- One criterion per saved test where possible (clean per-behaviour pass/fail in the dashboard).

Mechanics:
- Save as **native tests** (`POST /v1/convai/agent-testing/create`) and attach to both the
  **original (reference) agent** and the **simplified copy** via
  `platform_settings.testing.attached_tests` — dashboard-visible, re-runnable by the client, and
  the same test objects score both sides of the A/B.
- Mock every webhook/client tool with **`tool_mock_overrides`** (per-test inline mock bodies keyed
  by tool id: `{tool_id: [{"mock_result": "<json string>"}]}` with
  `tool_mock_config: {mocking_strategy: "all", ...}`). Nothing hits real endpoints and no global
  tool object is edited.
- Seed `dynamic_variables` from a real call (scrubbed), and include `system__call_sid`,
  `system__caller_id`, `system__conversation_id`, `system__called_number` — simulations error with
  `missing_dynamic_variables` otherwise if any tool references them.
- Tests already attached to the original agent are shared objects: adding new tests alongside them
  is fine, but never edit or remove the existing ones.

**Baseline the original agent on the suite first.** Its failures are improvement opportunities, not
excuses ("equivalently bad" is not the goal).

## Phase 3 — Simplify

Default target: **single-agent (1-node workflow)** + base prompt + focused rules + procedures + KB.
Keep the workflow only where determinism is genuinely required and prompt enforcement proves
unreliable in tests.

- Flatten the workflow (`PATCH` with a start-node-only workflow). Check what the main/hub node's
  `additional_prompt` actually adds beyond the base prompt — if it adds nothing (or duplicates it),
  there is nothing to port from that node.
- Port each node's **unique** logic (not any repeated boilerplate) into either:
  - **focused prompt rules** — short `#`-titled sections, one behaviour each; or
  - **procedures** — for genuinely multi-step flows (diagnostics, retention). See the procedures
    API lifecycle below; procedures on the copy are safe to edit (per-agent clones).
- Deterministic phrasing the client mandated (say nodes) → encode single verbatim phrases as
  explicit prompt rules and test them. **Mandated multi-step sequences** (e.g. "clarify twice, ask
  a feedback question, only then transfer") belong in a **procedure** — step ordering is exactly
  what procedures are for, and prompt-rule enforcement of step order is less stable (the model
  tends to jump to the terminal action once the customer has pushed enough times, skipping the
  last mandated step). Whichever mechanism you use, test the full sequence multi-turn.
- Common config fixes while you're there: `PATCH` rejects a body containing both resolved `tools`
  and `tool_ids` — pop `tools`, keep `tool_ids`. Read-modify-write the full `conversation_config`
  so nothing is wiped.

## Phase 4 — Iterate on failures (the discipline that makes this work)

Run the suite on the copy; then, for **every** non-passing test (on the copy **or** the original):
1. Read the transcript/rationale once. **Do not re-run to confirm a failure** — one failure means
   there's something to improve. (Re-running to verify a FIX is fine.)
2. Classify: **agent bug** (fix with a focused rule/procedure edit, then verify) vs **test bug**
   (wrong premise, over-strict criterion, wrong instrument — fix the test, never by loosening it
   past what's actually correct) vs **ungradable artifact** (tool-only turn in an `llm` test →
   convert to a simulation test or retire the duplicate).
3. Failures shared by the original agent are still yours to fix — the tests encode ground truth
   from real calls, and the goal is a better agent, not parity with its defects.
4. Watch for **rule dilution**: as prompt rules accumulate, earlier enforcement can weaken. If a
   previously-passing mandated behaviour regresses, strengthen that rule's self-check rather than
   adding more prose.

## Phase 5 — Final A/B on branches of the original agent

The cleanest comparison is two branches of the SAME agent:
- `POST /v1/convai/agents/{id}/branches` with `{parent_version_id, name, description,
  conversation_config, platform_settings, workflow}` → a branch (e.g. "Pete") carrying the
  simplified config; Main stays untouched. `parent_version_id` = the agent's current `version_id`.
- `GET /v1/convai/agents/{id}?branch_id=...` to verify each branch's config.
- Run the full suite per branch: `POST /v1/convai/agents/{id}/run-tests` with
  `{"tests":[{"test_id":...}], "branch_id": ...}`; poll
  `GET /v1/convai/test-invocations/{invocation_id}` until all runs are terminal; result is
  `condition_result.result` (`success` / `failure` / `unknown`; `rationale` may be a dict with
  `summary`).
- Report per-branch totals + per-test diffs, with invocation ids (client-verifiable in the
  dashboard).

## Phase 6 — Report honestly

- State the claim precisely: "reproduces every tested behaviour of the original on a much simpler
  architecture and scores X vs Y on the suite" — not "a 1-node agent is inherently better".
- Name the caveats: LLM-judged simulations (strong signal, not live traffic), single-run noise,
  you authored the tests you're scoring against, per-turn token cost of a bigger always-on prompt,
  and workflow determinism vs prompt enforcement for verbatim phrases.
- Recommend human review of a few calls and a gradual rollout before any full switch.
- If you got something wrong along the way, correct the record explicitly in the report.

## API gotchas appendix

**Procedures (draft → commit lifecycle — everything is branch-scoped):**
- `POST /v1/convai/agents/{id}/branches/{br}/procedures` `{name, content, type: "free_form",
  trigger?}` → returns `procedure_id`, but creates the procedure **as a draft** and adds its ref to
  your user's agent draft. It will NOT appear in the committed agent/branch procedure lists yet —
  do not conclude the API "didn't attach" (checking the committed view after create is the classic
  mistake).
- `GET .../procedures/status` → the draft refs; `GET agent?include_draft=true` → draft config.
- `POST .../procedures/compile` → **preview only**: validates and returns the compiled workflow +
  errors. It commits nothing.
- **Commit = `PATCH /v1/convai/agents/{id}?branch_id={br}`** (an empty JSON body works): it
  resolves procedure refs from your draft into the new committed version, then deletes the drafts.
  After this, the procedure appears in `GET agent` `.procedures`, the branch list, and direct GET.
- Edit content: `PATCH .../procedures/{pid}/draft` (full body: name, content, type, trigger) →
  commit PATCH. Delete: `DELETE .../procedures/{pid}` (removes from draft set) → commit PATCH.
- Procedure `content` = markdown with `---` frontmatter (`name`, `trigger`) + steps. Reference KB
  docs as `[kb id="..." name="..."]`, tools as `[tool id="..." name="..."]`, system tools as
  `[system_tool id="transfer_to_number" name="..."]`.
- Procedures are per-agent (cloned when an agent is duplicated) — but the KB/tools they reference
  are global.

**Testing:**
- Saved-test update is `PUT` (full replace — a partial body silently wipes omitted fields), not
  `PATCH` (405).
- `simulate-conversation` (ad-hoc, no saved artifact) runs the LIVE agent config — to A/B a
  candidate config you must actually PATCH it (or use branches + `run-tests`).
- A test whose judged turn is a bare tool call grades `unknown` — instrument mismatch, not failure.
- Multi-turn sims have some single-run flakiness. Don't paper over it with repeat runs — testing
  has cost; prefer broadening the suite with more varied scenarios, and investigate any failure
  rather than re-rolling it.

**Agent config:**
- A language preset makes a language switchable by `language_detection`; but if a `{{language}}`
  dynamic variable anchors the default, add an explicit "the spoken language wins" prompt rule.
- Conversation-detail endpoint rate-limits hard — keep concurrency ~4-5 with retries.
