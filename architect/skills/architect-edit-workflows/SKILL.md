---
name: architect-edit-workflows
description: Use when the user wants to build or change an agent's workflow or a specific node ("add a node", "connect these nodes", "route to a phone transfer", "add a condition/edge", "delete this node", "why does deploy say duplicate edge"), or a workflow change is failing validation.
---

An agent's workflow (its nodes and edges) lives inside the agent config. Over REST you read it from `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` (the `workflow` object) and write whole-config changes with `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`. There is NO granular per-node/per-edge endpoint from the API. If the user needs interactive node-by-node editing on a canvas, that is only in the web app; say so plainly and either make the whole-config edit here or point them there. All calls use `xi-api-key: $API_KEY`.

Workflow writes are error-prone. Go slow, change one thing at a time, and read the current graph before every write.

## 1. Read the current graph first, always

`GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` and read the `workflow` object. Nodes and edges are keyed maps (not arrays): every node has a `type`, a `position`, and an `edge_order`; the graph always contains `start_node`. You need existing node ids to connect, update, or delete, and you need to see which pairs already have an edge. Also `GET /v1/convai/tools` for the real tool ids: expression edges and tool nodes reference tool ids, and a guessed id fails validation.

## 2. Make one change at a time

Take the workflow you read, apply a single change, and PATCH the whole `workflow` back. Do not hand-build a partial workflow from memory and do not drop nodes, edges, or nested config you did not mean to change: omissions are treated as deletions and cause `schema_mismatch`. After each successful write, re-read the config to confirm the change landed before the next one.

## 3. Cross-node constraints (each is a common failure)

1. ONE edge per node pair. Two edges between the same pair cause a "Duplicate edge found" error on deploy. For a bidirectional transition, put `forward_condition` (A to B) and `backward_condition` (B to A) on the SAME single edge. Never create a second edge for the return direction. This is the most common failure.
2. Terminal nodes have NO outgoing edges. `end` and `phone_number` (phone transfer) nodes are terminal; an edge out of one, or a `forward_condition` from one, fails validation. A phone_number transfer that fails just ends the call; if the user wants retry or fallback, recommend the `transfer_to_number` system tool instead.
3. Expression edges vs LLM conditions. Use an expression edge for deterministic routing off a tool result or dynamic variable (route on whether a lookup returned a match, or on `{{account_type}}`). Use an LLM/prompt condition only for genuine judgment. Vague LLM conditions cause wrong-node routing; write tight conditions that reference concrete signals ("lookup returned a matching record", not "customer is identified").
4. Conditions must be mutually exclusive. Overlapping conditions on a node's outgoing edges make the model fire the wrong one. Keep each outgoing condition disjoint.
5. Node ids and positions are required and consistent. A connection needs source and target ids that already exist in the current graph (why step 1 is mandatory). A new node needs a `position` ({x, y}); omitting it or reusing an existing id causes validation errors.
6. A transfer (`standalone_agent`) node keeps `agent_id` and `node_id` as FLAT fields, siblings of `type`/`position`; there is no `transfer_destination` wrapper. Set `agent_id` (and leave `node_id` null) to transfer to a different agent; set `node_id` (and leave `agent_id` null) to transfer within the same agent. The "a target must be selected" error fires only when both are empty. The node also needs `delay_ms` (int >= 0), `transfer_message` (string or null), and `enable_transferred_agent_first_message` (bool).
7. On an agent with `override_agent` nodes the effective prompt lives IN the nodes, so editing the base agent prompt often has no effect on the conversation or 422s. Change the node's prompt in the workflow, and tell the user which node owns the text so they are not surprised a base-prompt edit changed nothing.
8. Tool scoping is separate from the graph. If a node needs a tool, set `tool_ids: []` at the base agent and grant tools per node via that node's `additional_tool_ids`, not by adding edges.

## 4. After editing

Re-read the config to confirm the change landed, and remind the user to test each transition path end to end (a simulation test is the reliable way; see the create-simulation-test skill).
