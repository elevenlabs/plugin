---
description: >
  Burn down an agent's conversation-triage queue end-to-end: pull every pending
  ticket, cluster by root cause, fix each cluster (code PR for code, agent-config
  branch for prompt/procedure), flag existing unmerged work instead of
  duplicating it, then comment on and resolve every ticket. Usage:
  /thermo-nuclear-agent-triage-burndown <agent_id>
---

# Thermo-Nuclear Agent Triage Burndown

Batch version of the `fix-agent-qa-ticket` skill for the *whole* queue instead
of one ticket. Read that skill first — it defines the ticket API host/auth and
the branch/procedure/sim-test mechanics this command reuses per cluster.

**Args**: `agent_id` (required, `$ARGUMENTS`). For an agent in an isolated
residency environment, swap the host below to
`https://api.<eu|in|sg>.residency.elevenlabs.io`; residency agents don't exist
on the central host.
Needs `$API_KEY` (`xi-api-key` header, host `https://api.elevenlabs.io`).

## 1. Pull every pending ticket

`GET /v1/convai/agents/$AGENT_ID/conversation-triage-tickets?status=open`, then
again with `status=in_progress` — paginate both via `cursor`/`has_more`.
`qa_comment` is the primary signal on every ticket — read it first. Only if
`turn_comments` is non-empty, also pull the conversation (`GET
/v1/convai/conversations/{id}`) and read the transcript around each
`turn_comments[].turn_index`, as in `fix-agent-qa-ticket` step 2. `source=manual`
tickets have no conversation to fetch.

## 2. Cluster

Group by root-cause theme, not surface wording — same broken tool, same prompt
gap, same procedure. Before trusting a cluster's root-cause hypothesis,
corroborate it against ≥2 tickets/transcripts in that cluster.

## 3. Classify each cluster's fix location

- **Codebase bug** (backend route, tool handler, frontend) → PR in your codebase.
- **Agent config** (prompt/procedure/KB gap) → agent-config branch, per
  `fix-agent-qa-ticket` steps 3–6 (branch off main's real tip, draft+publish
  dance for procedures, sim test to prove it).
- **Not actionable** (duplicate, expected behavior, insufficient info) → no
  fix, just an explanatory comment.

A cluster can need both a code fix and a prompt tweak.

## 4. Check for in-flight fixes before creating new ones

- Agent branches: `GET .../agents/$AGENT_ID/branches?include_commit_status=true`
  — a non-main branch with `commits_ahead > 0` matching a cluster's topic is
  unmerged prior work. Reuse or flag it for merging instead of duplicating.
- Code PRs: `gh pr list --search "<topic>"` for an already-open PR touching the
  same code.

## 5. Execute — nothing gets merged by this command

- Codebase: one small **draft** PR per cluster, with tests for the touched
  area. Follow repo conventions (`AGENTS.md`): draft by default, no auto-merge.
- Agent config: one branch per cluster with a sim test proving the fix, left
  unmerged.
- Flag pre-existing unmerged branches/PRs found in step 4 for the user to
  merge rather than opening a duplicate.

## 6. Resolve every ticket

No bulk endpoint — loop per ticket, comment before resolving:

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/conversation-triage-tickets/$ID/comments" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"comment": "<root cause>\n\n<PR/branch link, explicitly \"not merged\", or why not-actionable>\n\nWritten by <model>, using <harness>."}'

curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/conversation-triage-tickets/$ID" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

Leave a ticket open, with a comment explaining why, only when resolving it
would paper over a decision a human genuinely has to make — don't silently
skip it.

## 7. Report

List: clusters found, PRs opened (draft, unmerged), branches flagged for
merge/reuse, ticket count resolved, and any left open with the reason.
