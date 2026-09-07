---
name: architect-review-live-calls
description: "Review an agent's recent finished conversations to find what is actually going wrong in production, then route each finding to a fix. Use when the user says 'we just launched this agent, how is it doing', 'review the last 3 days of calls', 'check how the agent is performing', 'monitor agent {id}', 'what are callers running into', 'why are calls failing', or asks for a post-launch health check or a weekly call review."
---

# Review an agent's live calls

Every other conversation read in this plugin is downstream of a problem someone already found — a QA ticket, a reported tool error, one bad call to turn into a test. This skill is the entry point that *surfaces* the problem: start from recent calls, end with clustered findings routed to a fix.

This skill owns the list→paginate→transcript fetch pattern. When another skill needs a sample of real calls, point at this one rather than reimplementing pagination and the PII rules.

This is a review of **finished** calls. Live in-flight audio over `wss://.../v1/convai/conversations/{id}/monitor` is a different thing and is not covered here.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY` and `$AGENT_ID`. For an EU/IN/SG residency workspace the host is `https://api.<eu|in|sg>.residency.elevenlabs.io` and the key is workspace-specific. Sending a residency key to the global host fails with a clear message — `Invalid API key: The API key used is for a data residency stack, however this server is a global server` — so if you see that, switch hosts rather than doubting the key.

## Two modes — pick one before fetching

Baselines live at a fixed path so a later run — even a different session — can find one without being told where to look: `.architect-live-calls/<agent_id>-baseline.json`, relative to the repo root. Check for that file before you fetch anything.

- **Launch sweep** (default; use when the agent went live within roughly the last two weeks, or when no baseline file exists at that path for this agent). Question: *is this thing working at all?* Did calls complete, did tools fire, where do callers drop, is the first message landing. Small N, no baseline, no QA tickets to route into — findings go straight to a fix.
- **Drift check** (use when the baseline file exists for this agent). Question: *what changed?* Compare this window's aggregates against the baseline and lead with deltas. Without a baseline a rate is not a finding — "12% of calls failed" means nothing on its own, so if the user asks for a drift check and no baseline file exists, run a launch sweep instead and write the baseline for next time.

State which mode you are running in one line before you start, and name the baseline path when you are running a drift check or writing a fresh baseline.

## What the list endpoint gives you — and what it withholds

`GET /v1/convai/conversations` returns `{conversations, next_cursor, has_more}`. Each entry carries enough to run the whole aggregate pass without touching a single transcript:

`conversation_id`, `agent_id`, `agent_name`, `branch_id`, `version_id`, `start_time_unix_secs`, `call_duration_secs`, `message_count`, `status`, **`termination_reason`**, `call_successful` (`success` | `failure` | `unknown`), `call_success_score`, **`tool_names`**, `main_language`, `direction`, `conversation_initiation_source`, `sentiment_analysis`, `tag_ids`, `call_summary_title`.

Query params that are honored: `agent_id`, `page_size` (**max 100** — larger 422s), `call_start_after_unix`, `call_start_before_unix`, `call_successful` (enum-validated), `user_id`, and `cursor` (pass back `next_cursor`, loop while `has_more`).

**`summary_mode=include` is the highest-value flag here.** It defaults to `exclude`, and turning it on populates `transcript_summary` on every entry — a one-line account of each call. Cluster from those summaries *before* you open any transcript; it is far cheaper and far less PII-exposing than reading calls to find out what they were about.

**What the list does NOT give you:** `evaluation_criteria_results` and `data_collection_results` come back `null` in list responses *even with `summary_mode=include`*. They only populate on the single-conversation `GET /v1/convai/conversations/{conversation_id}`, under `.analysis`. So per-criterion pass rates and extraction fill rates are **sample statistics from step 3, never window-wide rates** — say so wherever you report them.

## 1. Set the window and fetch

Ask for the window if the user did not give one — they will usually say it in passing ("last 3 days", "since Monday", "this week"). Default to 7 days for a launch sweep.

```bash
curl -s "https://api.elevenlabs.io/v1/convai/conversations?agent_id=$AGENT_ID\
&call_start_after_unix=$SINCE&summary_mode=include&page_size=100" \
  -H "xi-api-key: $API_KEY"
```

Filter server-side with `call_start_after_unix` — do not pull the agent's whole history and trim client-side. Loop on `cursor`/`has_more` until you pass the window edge.

If the window is empty, say so and stop. An agent with no calls is not a passing health check.

Alongside the window fetch, pull the agent's configured tool set once — it is what step 2's dead-tool check compares `tool_names` against, and the list endpoint has no way to derive it on its own: `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` for `conversation_config.agent.prompt.tool_ids` (plus each node's `additional_tool_ids` for a workflow agent), then `GET /v1/convai/tools` to resolve those ids to names. Skip this fetch, and skip the dead-tool check, if the user only wants a scoped read on a single aggregate.

## 2. Aggregate pass — count before you read

Build a small table from the list payload alone:

- **Volume and completion** — total calls, and the `status` / `call_successful` split.
- **`termination_reason`, grouped and counted.** Usually the single most useful number in the report — a spike in one reason is the finding.
- **Duration and `message_count` distribution** — flag both tails. A cluster of sub-two-turn calls usually means the greeting, the connection, or the language is wrong; a cluster of very long calls usually means the agent cannot close or is looping.
- **`tool_names` coverage** — union the arrays and compare against the configured tool names from step 1. A tool that appears in zero calls is either dead weight or an instruction the LLM never acts on, and that is invisible from the config alone.
- **`main_language` split** — unexpected languages mean detection or ASR problems, not multilingual success.
- **`call_success_score` and `sentiment_analysis` distribution** — useful as a tiebreak when `call_successful` is mostly `unknown`.

Then read the `transcript_summary` lines end to end and group them. This is the cheapest clustering signal available and it comes free with the same request.

## 3. Deep-read only the outliers

Pick targets from the aggregates, do not sample randomly: the dominant `termination_reason` bucket, `call_successful=failure` (filter it server-side), the tails of the duration distribution, and any summary cluster whose mechanism you cannot infer.

Cap it. Default 10 transcripts, 20 if the user asks for a thorough review. On `GET /v1/convai/conversations/{conversation_id}` the fields that earn the fetch are:

- **`.analysis`** — `evaluation_criteria_results` and `data_collection_results` (the only place they exist), plus `transcript_summary` and `call_success_score`.
- **`.metadata`** — `termination_reason`, `error`, `cost`, `phone_call`, `authorization_method`, `rag_usage`, `features_usage`.
- **`.transcript[]`** — per turn: `tool_calls` and `tool_results` (the failing call and its error verbatim), `interrupted`, `triggered_guardrails`, `conversation_turn_metrics` (latency), `rag_retrieval_info`, `original_message` vs `message`, and `role`.

**If you hit the cap, say what you dropped and why** — "read 10 of 34 calls in the dominant termination bucket" is honest; silently reading 10 and reporting as if you covered the window reads as full coverage when it isn't.

## 4. Cluster by root cause

Group by mechanism, not by surface wording — same broken tool, same prompt gap, same missing procedure branch, same ASR failure. **Corroborate every cluster against at least two conversations before you trust its root-cause hypothesis.** One transcript supports a story; two support a cause. A cluster of one is a suspicion — label it as one.

Rank by frequency × severity. A rare hard failure can outrank a common cosmetic one; say which you are doing when it is not obvious.

## 5. Route each cluster to a fix

Findings are worthless as a list. Hand each cluster to the skill that fixes that class of problem:

| Cluster looks like | Route to |
| --- | --- |
| Tool errored, timed out, or never appears in `tool_names` | `architect-troubleshoot-tool-errors` |
| Agent said the wrong thing, missing rule, weak greeting | `architect-edit-string-fields` |
| Missing or mis-branching step-by-step logic | `architect-manage-procedures` / `architect-structured-procedures` |
| Wrong routing, dead-end node, bad edge condition | `architect-edit-workflows` |
| Criteria that never fire, or extraction fields always null | `architect-post-call-data` |
| `interrupted` turns, slow `conversation_turn_metrics`, callers cut off | `architect-turn-taking-latency` |
| Unexpected `main_language`, misheard input | `architect-update-config-safely` (ASR and language config) |
| Broad structural problems across many clusters | `agent-review` for a full config audit |

Two rules on the handoff: fixes land on a branch, never straight on main (`architect-branches-versions-merge`), and **every confirmed cluster becomes a regression test before the fix ships** — `architect-create-llm-test` for a single bad reply, `architect-create-tool-test` for a wrong or missing tool call, `architect-create-simulation-test` for a multi-turn flow that fell apart. A production bug that ships a fix without a test comes back.

## 6. Write the baseline

Write to `.architect-live-calls/<agent_id>-baseline.json`, relative to the repo root — the same path checked under "Two modes" above to decide launch sweep vs drift check. Create the directory if it does not exist. One file per agent; overwrite it on every run so the next run always diffs against the most recent window, not a stale one.

Persist: window bounds, total calls, `termination_reason` counts, the `call_successful` split, tools seen, and the cluster labels with their counts.

Mark each number as window-wide (anything from step 2) or sample-derived (anything from step 3, including all per-criterion and fill-rate figures). A baseline that silently mixes the two produces fake deltas on the next run.

**Aggregate counts and conversation ids only.** No transcript text, no `transcript_summary` strings, no caller names, phone numbers, emails, or other caller identifiers — the baseline outlives the session and is easy to commit by accident. Check the repo's `.gitignore` for `.architect-live-calls/` and add an entry if it is missing before you write the file.

## Output format

Short. The report is roughly 25–50 lines:

1. One line: mode, window, call count, and the single most important number.
2. Aggregate table from step 2.
3. **Clusters** — one line each: what happens, how many calls, corroborating conversation ids, root cause, where it routes. Mark single-call clusters as unconfirmed.
4. **Top 3 to fix first**, ordered.
5. For a drift check, a deltas-vs-baseline line before the table.

No per-conversation walkthroughs, no praise section, no restating what the agent is configured to do. If a cluster needs more than two lines, the extra belongs in the skill you route it to. Produce the long version only if asked.

## Rules

- **Read-only.** This skill only issues GETs — against the conversations endpoints, and against the agent/tools endpoints to resolve configured tool names for the dead-tool check. It never deletes a conversation and never edits the agent — every config change goes through the sibling skills in step 5, which branch first.
- **PII.** Conversation payloads, summaries, and analysis carry customer PII, and calls may have audio (`has_audio`). Do not copy transcripts or summaries into other systems, logs, artifacts, committed files, or scratch files. Quote at most a short redacted fragment when it is needed to make a finding concrete, with names and numbers replaced.
- **Secrets.** Read `$API_KEY` from the environment. Never hardcode it in a generated script or in any file this skill writes, and never echo it to stdout or into the report.
- **Zero-retention workspaces.** Transcripts are unavailable by design, and `hiding_reason` on a conversation marks one you cannot read. Do not treat either as an error — run the aggregate pass on metadata alone, skip step 3, and tell the user which findings were unreachable without transcripts.
- **Non-actionable is a valid verdict.** A window where everything worked is a real result. Say so in a line and stop, rather than manufacturing findings to fill the report.
