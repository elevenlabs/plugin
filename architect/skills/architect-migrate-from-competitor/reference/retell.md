# Retell → ElevenLabs

## Two export shapes, and how to tell them apart

Dispatch on `response_engine.type`. It is always present.

- **`retell-llm`** — a prompt-driven agent. Tools live in `retellLlmData.general_tools` and in
  per-state `tools`.
- **`conversation-flow`** — a node graph. Tools live in `conversationFlow.tools`.

Do not dispatch on `starting_state`; it is frequently absent.

The two shapes need different work. A `retell-llm` source is usually one prompt plus tools, so an EL
agent with a prompt and maybe procedures is the right target. A `conversation-flow` source has real
states and usually wants an EL workflow.

## Construct mapping

| Retell | ElevenLabs | Notes |
|---|---|---|
| Agent | Agent | Same concept. |
| Conversation node | `override_agent` node | The editor calls it an Agent node; the wire type is `override_agent`. |
| Node `instruction` | node `additional_prompt` | **Append**, not replace. See the prompt-field trap in `reference/traps.md`. |
| Function node | `tool` node referencing a webhook tool | The target is a Tool node, not a bare tool. |
| Function node with `speak_during_execution` | **one** `override_agent` node with `forced_tool_name` + `additional_tool_ids` | The node speaks, and is forced to make the call. Cleaner than a say-node-then-tool-node pair. `pre_tool_speech` is an enum (`auto`/`force`/`off`), not filler text, so it cannot carry the line. |
| Node `instruction` as `{static_text}` or `{prompt}` | `say` node `message`, a union of literal text or an LLM prompt | A clean 1:1 — do not flatten a static line into a generated one. |
| Transfer call node | `phone_number` node | Give it an outgoing `result` edge. |
| Branch node | edge conditions on the preceding node | The branch node itself disappears. |
| `else_edge` | the node's single unconditional edge | At most one unconditional out-edge per node. |
| `transition_condition` type `prompt` | LLM edge condition | The common case. |
| `transition_condition` type `equation` | expression edge condition | **Type-guard it** — see `reference/expressions.md`. |
| End node | `end` node | The only genuinely terminal node type. |
| `begin_message` | `first_message` | Present on most `retell-llm` sources; absent from every `conversation-flow` source. |
| `global_node_setting` + its `condition` | a Procedure with a `trigger` | The trigger is the analogue of the node's `condition`. Read the reachability trap first. |
| `extract_dynamic_variables` node | `update_state` node | **Not** data collection — that is post-call and cannot feed routing. |
| Node-scoped `knowledge_base_ids` | `additional_knowledge_base` on an `override_agent` node | Must be `override_agent`; a `say` node accepts the write and ignores it. |
| Flow-level `knowledge_base_ids` | the agent's knowledge base | — |
| `skip_response_edge` | unconditional edge **plus** `entry_behavior: "wait_for_user"` on the target | The edge alone only routes; it does not suppress speech. |
| Cold transfer | `blind` transfer | Unless it ran over SIP REFER — then `sip_refer`, which is also the only type accepting a SIP URI destination. |
| Warm transfer | `conference` transfer | The agent can address both parties. |
| Warm-transfer briefing message | **no equivalent** — see gaps | The field does not exist on either transfer surface. |
| `agent_swap` (cross-agent) | `standalone_agent` node, or the `transfer_to_agent` system tool | Plain edges only cover the within-agent case. |
| `agent_swap` `keep_same_voice` | `preserve_client_tts_overrides` | — |
| Shared/library component | `standalone_agent` node with a `node_id` entry, push/pop return | Referenced by id, so one edit still propagates to every caller. |
| `press_digit` tool | `play_keypad_touch_tone` system tool | Also `post_dial_digits` for digits sent on connect. |
| `send_sms` tool | native SMS channel, or a webhook tool | See the SMS note below. |
| `mcp` node / tool | native MCP server on the agent | Do **not** re-author MCP tools as webhook tools. |
| `data_storage_setting` | `PrivacyConfig` | `everything_except_pii` maps to transcript/PII redaction. Retention is **per agent**. Set the two together — see the deletion-flag trap in `reference/traps.md`, because a deletion flag sent without a retention window is silently switched off. |
| `data_storage_retention_days` | `retention_days` | `-1` means no limit, and it also disables the deletion flags. |
| `ambient_sound` / `ambient_sound_volume` | `conversation.background_sound` | Volume range is 0.01–1.0. Presets do **not** map 1:1 — see below. |
| `voice_model` holding an ElevenLabs model id | the voice/TTS model directly | Most sources that set this already name an EL model. |
| Batch testing | the agent testing API | Tests are first-class resources attached to the agent. |

## Retell constructs that are not what a mapping table might suggest

- **`press_digit` and `send_sms` are tools, never node types.** They appear only in tool definitions.
  If a mapping table tells you to convert an "SMS node" or a "DTMF node", it is describing something
  Retell does not have.
- **`conversation-flow` sources have no `begin_message`.** Derive the opening line from
  `start_speaker` plus the start node instead. Treating the absence as "this agent has no greeting"
  produces a silent agent.
- **`equation` transitions are the deterministic ones.** They lower to expression conditions.
  Natural-language `prompt` transitions lower to LLM conditions. Most edges in a typical flow are the
  latter, but the former are where the silent-inversion trap lives.
- **Ambient sound presets are a closed set on both sides and they do not correspond.** EL's presets
  are `office1`, `office2`, `restaurant`, `city`, `typing`, and `elevator1`–`elevator4`. Anything
  else in the source has to be hand-mapped to the nearest, or dropped and mentioned to the user.
  `background_sound` can also be overridden per node, which the source cannot do.
- **Response variable paths need rewriting, not copying.** Retell's `properties.` prefix is its own
  convention and is not part of the response — for a GraphQL endpoint it becomes `data.`, and a bare
  field name needs that prefix added rather than removed. Bracketed indexes (`[0]`) must become dotted
  (`.0.`). See the assignment section of `reference/expressions.md`; a path that does not resolve leaves
  the variable unset, which then silently routes every condition reading it down the absent path.
- **Voice emotion.** EL v3 expression and mood tags are square-bracketed — `[calm]`, `[warmly]`,
  `[excited]`, `[sigh]`. They belong in agent-level prompt text, not in workflow node prompts;
  describe the intended tone in prose inside a node.

## Where the real gaps are

Treat any "Retell has X and ElevenLabs does not" claim as wrong until you have searched and failed to
find the feature. The overwhelming majority of them are, including several that circulate widely.
Before telling a customer to build a workaround, look for the construct — a workaround they do not
need is worse than an unanswered question. These are the ones that hold up:

- **Per-node fine-tuning examples.** No equivalent construct. Put the guidance in the node's
  `additional_prompt` instead. This is a real loss of a mechanism, though usually not of behaviour.
- **Free-navigation ("flex") mode.** There is no mode switch. Approximate it with broad bidirectional
  edges — an EL edge carries a forward and a backward condition on the same object — and keep the
  graph small enough to reason about.
- **`cool_down` on a global node.** Retell throttles re-entry — 5, 10, 92 seconds. A procedure trigger
  has no throttle of any kind, so a global that Retell allowed back in once a minute becomes one that
  can fire on consecutive turns. This is a behaviour change with no config to soften it: the only lever
  is the trigger's own wording, so write it to describe a *situation the caller is in* rather than a
  topic they mentioned. Say so when a source uses long cool-downs; one export carried six of them.
- **Entering a global node on a deterministic test.** A trigger is a plain string of natural language —
  there is no expression object, so a global whose in-edges gate on `{{Party Size}} >= 7` cannot be
  lowered onto a procedure and stay deterministic. Two options, both fine: keep that node in the graph
  and let the deterministic edges reach it normally, or fold the numeric test onto the edges leaving its
  predecessors (see `traps.md` — an edge condition *can* conjoin a model judgment with a variable test,
  which is the capability a trigger lacks). Do not lower it and hope the wording holds.
- **The warm-transfer briefing message.** Retell can speak a private message to the receiving human
  before bridging. No such field exists on either ElevenLabs transfer surface — a phone-transfer node
  takes `custom_sip_headers`, `edge_order`, `position`, `post_dial_digits`, `require_acceptance`,
  `transfer_destination`, `transfer_type` and `uui`, and the transfer-to-number system tool's entries
  add only `condition` and `phone_number`. Names like `agent_message` or `whisper_message` are
  accepted and silently dropped on both, so a config that looks right will simply not brief anyone.
  Closest workaround: `conference` transfer lets the agent address both legs, so put the briefing in
  the prompt. (Agent-to-**agent** transfer is different — that does carry a transfer message.)
- **A dedicated transfer-negotiation agent.** The transfer-type set is closed and has no entry for
  "a separate agent negotiates with the target, then bridges". But most of what customers use it for
  *is* covered: `require_acceptance` screens the receiver and auto-releases the caller if the target
  never accepts, and `agent_message` briefs the receiver before bridging. The residual gap is only
  the separate negotiating agent.

These were commonly claimed as gaps and are not: DTMF, SMS, reusable components, node-scoped
knowledge, guardrails, ASR keyword boosting, A/B testing, version pinning, human detection before
bridging, whisper messages, MCP, mid-call variable capture, and QA scoring. Each has a real EL
construct — see the mapping table above, or ask the relevant sibling skill.

**`go_back_conditions` is on that list, and the reason is worth knowing**, because it looks like the
scariest thing about lowering a global node and it is not a gap at all. Retell needs those conditions
because its global *is a node* — entering it means leaving the node you were on, so something has to
decide when to come back. ElevenLabs has no equivalent need, in either direction:

- A **free-form** procedure is injected into your context and moves you nowhere. You never left the
  node, so there is nothing to return to and no condition to write.
- A **structured** procedure does move you to its own entry node, and the node you came from is
  recorded at activation and restored when the procedure ends. The return is structural rather than
  condition-driven, so it cannot fail to fire the way a missing `go_back_condition` can.

So do not spend effort porting these, and do not tell a customer they lose the behaviour. What you
should tell them is the *reachability* consequence in `traps.md`: the trigger is offered on every
turn and the model chooses, so nothing guarantees your authored order. That is the real cost. Note also that
the closest thing to scoping is per-conversation rather than per-node: the procedure set can be narrowed
in conversation-initiation client data, where the workspace allows it.

Two more are narrower than usually stated rather than absent: hold music during a transfer exists but
is not configurable, and automated QA scoring exists per conversation and per turn, with latency,
interruption and hallucination scoring genuinely missing.

## SMS

Retell's SMS is a tool. ElevenLabs has a native two-way SMS channel, so an SMS-first agent needs no
external API — inbound SMS routing is on by default for an imported SMS-capable number. The one case
that still needs a webhook tool is sending a single SMS from inside a voice call.

## Sequencing a `conversation-flow` migration

1. Identify the shape and read the graph. Count nodes by type before deciding anything.
2. Handle credentials in every tool definition first (`SKILL.md`, step 2).
3. Decide what to collapse — see the folding trap in `reference/traps.md` before committing to it, and expect a
   faithful conversion to be roughly node-count-neutral. Semantic merging of duplicate nodes is a
   later, test-backed pass.
4. Create the agent shell directly, then port the base prompt and derive the first message.
5. Create the tools and record the id each returns, keyed by the Retell `tool_id` — a workflow node
   references a tool by id, and two Retell tools can share a name. See step 4 in `SKILL.md`.
6. Build nodes, then edges. Order only the conditional edges — unconditional ones are moved last for
   you.
7. Convert each `equation` transition with a type guard; convert each numeric comparison only after
   the variable is guaranteed numeric. Compose the guards from `reference/expressions.md` — most of a
   real flow's equations need one, and an unguarded `neq` fires on absent data.
8. Give every transfer node its failure edge.
9. Run the mocked smoke test (`SKILL.md` step 5) before reporting anything as done, then route the
   remaining config and rollout to the sibling skills.
