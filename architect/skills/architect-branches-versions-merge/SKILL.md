---
name: architect-branches-versions-merge
description: Use when working with agent branches, versions, drafts, traffic splits, or merges. Fires on "make a copy to test on", "create a branch", "switch to my test branch", "send 10% of traffic to the new version", "roll it out gradually", "merge my branch back to main", or when a branch operation errored.
---

# Branches, versions, and merging

Branches are versioned snapshots of an agent's config (prompts, voices, tools, workflows) that let you test changes without touching live production. Main is the default branch and receives 100% of traffic unless a split is configured. Drafts are work-in-progress edits on a branch that are not committed to a version until published. Traffic splitting distributes a share of live conversations deterministically across branches (by conversation id) for A/B testing. Merging folds a source branch's changes into its parent (usually main), creating a new version on the target.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY` and `$AGENT_ID`.

Branch operations fail most often on stale state: a wrong branch id, a traffic allocation that does not total 100, or an operation blocked by branch protection. Read current branch state first, then route to the exact operation.

## HARD GATE: resolve the id before any write

Never write to a branch id you have not just confirmed. If the user names a branch ("switch to angelo/test-switch", "go to my test branch"), that name is not a ready-to-use id. Resolve it by listing branches and matching on `name` first, in the same task, before the first write. Do not reuse an id from earlier context, memory, or a guess. If no exact name match exists, say so and ask the user to confirm rather than picking the closest-looking one.

## 1. Read current branch state first

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches" \
  -H "xi-api-key: $API_KEY"
```

This is the source of truth. For each branch note the exact `id` (agtbrch_...), `current_live_percentage`, `protection_status` (admin_perms_required vs writer_perms_required), `parent_branch_id`, `main_branch_id`, and `draft_exists`. Get one branch's true HEAD version from `.most_recent_versions[0].id`.

Also get the agent to confirm which branch is currently active and the agent id:

```bash
curl -s "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID" -H "xi-api-key: $API_KEY"
```

## 2. Route to the exact operation

- **Create a copy to experiment on** -> `POST /v1/convai/agents/$AGENT_ID/branches` with `{name, description, parent_version_id}`. Use the parent branch's HEAD version id (from `.most_recent_versions[0].id`). New branches start at 0% live traffic, so creation alone sends no live traffic.
- **Edit config on a different branch** -> scope every read and write to that branch with `?branch_id=<id>`. `PATCH /v1/convai/agents/$AGENT_ID?branch_id=<id>` commits to that branch's HEAD, never main.
- **Send a share of live traffic to a branch** -> set the traffic split. This is the operation most likely to fail; see the constraints below.
- **Fold a branch's changes back into its parent** -> merge. Preview first, then merge; the merge is destructive on the target.

## 3. Constraints that cause the failures

1. **Traffic split must total exactly 100% across all active branches.** Setting a split declares the whole allocation, not one branch. If you raise a new branch to 10%, lower another (usually main) by the same 10% in the same call. Sum every branch's `current_live_percentage` from the branch list, apply the delta, and confirm the new set sums to 100 before sending. A partial set that does not total 100 is the top validation failure.
2. **Only include active (non-archived) branches** in the split. An archived branch or a stale id triggers not_found or validation. Rebuild the allocation strictly from the current branch list.
3. **Protection status blocks writes.** Main typically has `protection_status: admin_perms_required`. If the user is not an admin, merging into main and editing main fail with a permission error. Check `protection_status` before promising a merge; if it is admin-gated and the user lacks the role, route them to the traffic-split A/B path (ramp traffic instead of merging) or to support.
4. **Merge target follows parentage.** A branch merges into its `parent_branch_id`. Verify the branch has the parent the user expects. You cannot merge a branch into an unrelated branch.
5. **An uncommitted draft blocks the operation.** If `draft_exists: true`, unsaved edits can cause a wrong-state error on switch or merge. Have the user save/commit or explicitly discard the draft first. Do not silently overwrite it.
6. **Ramp gradually, do not jump to 100.** Move a proven branch 10% -> 50% -> 100% across separate traffic-split calls, watching analytics between steps, rather than one 0 -> 100 jump.
7. **Traffic split is not the same as explicit branch selection.** `current_live_percentage` only governs how un-pinned live traffic is auto-routed. A branch at 0% can still receive conversations when it is selected explicitly (a `branch_id` passed via the API, or an explicit branch pin in a client). Never tell a user that a 0% branch gets no conversations, and account for explicitly-targeted branches when reasoning about where recent conversations came from.

## 4. Merge

Merge folds a branch into its parent. Always run a merge preview first to show the diff before merging. The merge endpoint is:

```
POST /v1/convai/agents/{agent_id}/branches/{source_branch_id}/merge
```

Merging is destructive on the target and creates a new version on it. If main is `admin_perms_required` and the user lacks the role, the merge fails with a permission error; do not retry. Offer the traffic-split A/B path instead, or escalate to support.

## 5. Recovery

- A bare validation failure is almost always the traffic split not summing to 100 or an array shape issue. Re-read the branch list, recompute the full allocation over active branches to total exactly 100, resend. Do not retry the identical payload.
- not_found means the branch id is stale, archived, or a name was passed. Re-read the branch list, copy the exact current id, retry. For a traffic split, drop any branch not present in the fresh list.
- A wrong-state error means you acted before the branch was ready or an uncommitted draft is blocking. Save/commit or discard the draft, then retry.
- A permission error means the target branch is protection-gated and the user lacks the role. Do not retry; offer the traffic-split path or escalate.
