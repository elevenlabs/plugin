---
name: architect-schedule-launch
description: Use when preparing an agent change now but applying it later at a specific moment (product launch, marketing go-live, embargo, scheduled announcement). Fires on "queue up these changes and publish at launch", "prepare this now but don't make it live until tomorrow", "stage a knowledge-base update for the launch", "schedule a change", or "have this ready to merge when we go live".
---

# Schedule a change for a launch

The user wants to make changes now that must not affect live traffic until a later go-live moment. Model this as a branch: all work happens on a non-live branch, main keeps serving the current config, and the change goes live only when the user merges (or ramps traffic to) the branch at launch time. There is no timer. Scheduling here means staging on a branch and holding the merge until the user is ready. Be explicit with the user that nothing publishes automatically; they press merge or ramp at go-live.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY` and `$AGENT_ID`. For the exact branch mechanics, error recovery, and traffic-split rules, follow the branches, versions, and merging skill for every branch write.

## 1. Confirm the shape of the change

Ask or infer two things before touching anything:

- **What changes** - a prompt/config edit, a new tool, a knowledge-base document add or rescrape, or a fact the agent should know. A KB add or rescrape counts and is a common launch case.
- **When it goes live** - the launch moment. Confirm the user will trigger the merge or ramp themselves; you are only staging.

If the change would be fine to ship immediately, say so and skip the branch. Scheduling only earns its complexity when the change must stay dark until a specific moment.

## 2. Read current state first

Before any write, read the branch list (`GET /v1/convai/agents/$AGENT_ID/branches`) for exact ids, `current_live_percentage`, `protection_status`, `parent_branch_id`, and `draft_exists`, and get the currently active branch config (`GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`). You need main's exact id to branch off it and to know whether main is `admin_perms_required`, which gates the eventual merge.

## 3. Create the launch branch off main

Create the branch with a clear launch-named `name` (e.g. `elevenmusic-audio-references-launch`) and `parent_version_id` set to main's HEAD version (main's `.most_recent_versions[0].id` from the branch list):

```bash
curl -s -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/branches" \
  -H "xi-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "<launch-name>", "description": "Staged for launch", "parent_version_id": "<main-head-version-id>"}'
```

The new branch starts at 0% live traffic, so creation alone sends zero live traffic. That is exactly what "queue it" means. Confirm to the user the branch exists and is at 0%.

## 4. Make the change on the launch branch

Scope every edit to the launch branch with `?branch_id=<new-branch-id>` so it lands on the launch branch and never on main.

- **Config / prompt / tool edits** -> apply via `PATCH /v1/convai/agents/$AGENT_ID?branch_id=<new-branch-id>` with a partial body (see the update-config-safely skill). Never spread edits across branches.
- **Knowledge-base add or rescrape** -> create or update the KB document (`POST /v1/convai/knowledge-base/text` or `POST /v1/convai/knowledge-base/url`) and attach it while working on the launch branch. The KB reference is captured in the branch's config snapshot, so it stays off main until merge. Confirm the document shows the updated content on the branch.
- **A fact the agent should recall** -> there is no memory endpoint, and even if there were, agent memory is agent-global, not per-branch, so a fact added "on the launch branch" would go live on main and every branch immediately. For anything that must stay dark until go-live, put the fact on the launch branch as a system-prompt line (via a branch-scoped PATCH) or as a knowledge-base document. Those are part of the branched config and only ship on merge.

## 5. Optionally publish and validate on the branch (does not touch main)

Because the branch is at 0% traffic, publishing a version on it makes the change testable without exposing it to live users. Offer whichever staging style fits:

- **Hold-and-merge (simplest):** leave the change as staged work on the branch. At launch, merge.
- **Publish-then-merge (testable):** commit the change on the branch (a branch-scoped PATCH returns a new version_id), let the user or a test suite validate it, optionally send a small traffic split for a pre-launch A/B, then merge or ramp to 100% at go-live.

## 6. At launch: merge or ramp (the user triggers this)

Do not do this step until the user says the launch is live. Then, per the branches skill:

- **Merge** the launch branch into main with `POST /v1/convai/agents/$AGENT_ID/branches/<launch-branch-id>/merge`. Always recommend a merge preview first to show the diff. If main is `admin_perms_required` and the user is not an admin, the merge fails with a permission error. Flag this now, in step 2, not at launch, and route them to an admin or to the traffic-split path.
- **Or ramp traffic** with a traffic-split change if they want a gradual rollout (10 -> 50 -> 100) rather than a hard cutover. The split must total exactly 100 across active branches in a single call.

## 7. Confirm and leave a clear handoff

Summarize in one place: the branch name and id, what is staged on it, that main is unchanged and still live, and the exact action the user takes at launch ("merge the <name> branch" or "ramp traffic to 100%"). If they queued several launches, keep one branch per launch so each can merge independently.

## Multiple people working at once

Give each person their own branch off main so their work does not collide. When two branches change the same field and both merge, the platform shows a conflict warning and keeps the more recent value. Call this out so the user reviews the merge preview rather than trusting a silent auto-resolve.
