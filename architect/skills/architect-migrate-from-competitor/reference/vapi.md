# Vapi → ElevenLabs

## Read this first: Vapi Workflows are retired

Vapi's own documentation states that Workflows were retired on **18 August 2026**, that from 19 August
2026 existing workflows no longer run, and that new workflows can no longer be created. Vapi directs
customers to migrate to Assistants or Squads.

Two consequences:

1. **Classify the source as an Assistant or a Squad.** Those are the live shapes.
2. **If you are handed a Workflow, its node vocabulary is dead.** Say / Gather / Condition / API
   Request were legacy Workflow node names. Do not describe them to the user as current Vapi, and be
   suspicious of any mapping table built on them — several in circulation are. A Workflow export is
   still worth reading as a description of intent; it just no longer describes anything running.

A customer on Vapi Workflows is being forced to re-platform anyway, which usually makes this an easier
conversation than a normal migration.

## Identifying the shape

- **Assistant** — a single agent. `model.messages` holds the system prompt (as a message entry, not a
  top-level string), `model.toolIds` or inline `model.tools` hold tools.
- **Squad** — `members[]`, each a saved assistant (`assistantId`) or a transient inline one
  (`assistant`). Handoff tools carry the topology.
- **Workflow** (legacy) — `nodes[]` of type `conversation` or `tool`, plus `edges[]`.

## Construct mapping

| Vapi | ElevenLabs | Notes |
|---|---|---|
| Assistant | Agent | — |
| Squad | one agent with `override_agent` nodes, **or** several agents | Decide per member, not per squad — see below. |
| Squad member, transient (inline `assistant`) | `override_agent` node | Exists only for this flow. |
| Squad member, saved (`assistantId`) | `standalone_agent` node pointing at a separate EL agent | Keeps the reuse boundary. |
| Handoff tool | an **edge**, or a `standalone_agent` node / `transfer_to_agent` | Depends on destination type — see below. |
| `members[n].assistantOverrides`, `membersOverrides` | `override_agent` node overrides | Precedence is **inverted**: in Vapi the squad-wide override wins; in EL the node override wins. |
| `transferCall` tool | `transfer_to_number` / `transfer_to_agent` | A `Sip` destination maps to a SIP URI, not a phone number. |
| `dtmf` tool | `play_keypad_touch_tone` system tool | `sipInfoDtmfEnabled` ↔ the out-of-band DTMF flag, which only takes effect on SIP-trunk-imported numbers. |
| `endCall` tool | `end_call` system tool | `endCallMessage` maps across; `endCallPhrases` has no field equivalent and becomes prompt guidance. |
| `voicemailDetection` (setting or tool) | `voicemail_detection` system tool | Tool→tool. The backoff/beep-await tuning has no field equivalent. |
| Code tool | `code` tool | EL runs TS/JS in a sandboxed isolate with npm deps. Feature-flagged — confirm availability; a webhook tool is the fallback. |
| Function / `apiRequest` tool | `webhook` tool | See the parameter-partitioning trap. |
| MCP tool | an MCP **server**, a separate workspace resource | See the approval-policy trap. |
| `ConversationNode.variableExtractionPlan` | `override_agent` node then an `update_state` node | **Not** data collection — that is post-call and not per-node. |
| `Edge.condition` (`type: "ai"`) | `llm` edge condition | EL also has `unconditional`, `result` and a typed `expression` AST, so it is strictly more expressive here. |
| Legacy Workflow `tool` node | `tool` node | EL has a dedicated node type; you do not need to call a tool from an agent node. |
| Legacy Workflow Say node | `say` node | EL has a real `say` node taking literal text *or* an LLM prompt. Do not downgrade it to an agent node. |
| `apiRequest` static `parameters` (Liquid) | per-node `schema_overrides` | — |
| Knowledge base | knowledge base | Vapi's are file-based; EL also accepts `url`, `text` and `folder`, so scraped-page KBs can often be re-pointed at the source URL. |
| `query` tool | RAG with optional retrieval enabled | See the RAG trap. |
| Custom knowledge base (webhook retrieval) | an ordinary tool | EL has no pluggable retrieval backend — see gaps. |
| `compliancePlan` | per-agent privacy config | Retention is per agent. Route the model-eligibility half to `architect-llm-selection`. |
| Evals / mock conversations | `llm` tests plus `tool` tests | Not simulation tests — those are the multi-turn kind. |
| System prompt in `model.messages` | agent prompt (+ per-node `additional_prompt`) | Vapi prompts run long; expect to split rather than paste. |
| `firstMessage` | `first_message` | Text only in EL — see gaps if the source is an audio URL. |
| `voice.speed` | TTS speed | Carry it, or the agent sounds different. |

## Handoff tools are both topology and a callable function

This is the most commonly mis-mapped construct. A Vapi handoff tool is a real LLM-visible function
*and* its `destinations` array encodes the graph. So the unit of conversion is a **destination**, not
a tool:

- destination `assistant` naming a member **inside the same squad** → an edge into an `override_agent`
  node.
- destination `assistant` pointing at a **saved** assistant, or destination `squad` → a
  `standalone_agent` node, or the `transfer_to_agent` system tool.
- destination `dynamic`, where a webhook chooses the target at runtime → **no edge equivalent**. See
  gaps.

One handoff tool with three destinations becomes three EL constructs, possibly of different kinds.

Assistant-to-assistant transfer crosses an agent boundary; workflow edges only move between nodes
*inside* one agent. Mapping it to an edge flattens a multi-assistant setup into a single agent and
loses the boundary. In the other direction, EL adds two things Vapi has no counterpart for: landing on
a specific `node_id` of the destination agent, and a push/pop call stack — which is how you express
"go do this and come back".

## Traps specific to a Vapi import

- **A migrated MCP call appears to hang.** Each tool discovered from an EL MCP server carries an
  approval policy that defaults to requiring approval. A Vapi assistant whose MCP tools just worked
  will look broken until you set it. MCP servers are also capped at 10 per agent.
- **Transfer type defaults differ.** EL's transfer type defaults to conference (warm). A Vapi blind
  transfer must set blind explicitly, or a cold handoff silently becomes a warm one.
- **Only `voice.provider == "elevenlabs"` carries a reusable voice id.** Every other provider —
  including Vapi's own branded voices — needs a substitute chosen by hand; there is no id mapping.
  Older exports may also name Vapi voices retired in early 2026 that no longer resolve even on Vapi.
- **Tool parameters must be partitioned.** EL splits a webhook tool's inputs into path, query and body
  schemas, so a single flat Vapi `function.parameters` object has to be divided by where each value
  belongs in the request. Where the source has `apiRequest` tools, migrate from those instead — they
  already separate body from headers.
- **RAG changes cost and latency profile.** A Vapi `query` tool is something the model chooses to
  call. EL's default RAG retrieves every turn. Enable optional retrieval to preserve the original
  behaviour, or the migrated agent quietly gets slower and more expensive.
- **Override precedence is inverted**, as noted in the table. A squad-wide override that used to win
  will now lose to the node override.
- **PCI and HIPAA are enforced server-side.** EL rejects a non-compliant model in HIPAA mode, and PCI
  validation extends to the post-call webhook URL. Porting a compliance-enabled assistant with its
  existing webhook will produce a validation error, not a warning.

## Where the real gaps are

Treat any "Vapi has X and ElevenLabs does not" claim as wrong until you have searched and failed to
find the feature. Most such assertions are. These hold up:

- **Context engineering between members.** Vapi lets each handoff destination choose how much history
  the next member sees — all, none, the last N messages, and so on. EL passes the full conversation
  context to every node and agent. A member that was configured to see *nothing* will see everything
  after migration. This is the gap most likely to change behaviour, and it needs to be raised with the
  customer rather than worked around.
- **Field-level encryption of tool arguments.** Vapi can encrypt named paths of a tool's request body
  with the customer's own public key before the request leaves Vapi. EL has no field-level payload
  encryption; it offers secret references and transport security instead.
- **ASR confidence is not exposed.** There is no low-confidence event or hook to trigger a
  re-prompt. The score exists internally but never reaches the agent.
- **No pluggable retrieval backend.** A Vapi custom knowledge base becomes an ordinary tool, which
  means retrieval stops being automatic and becomes a call the model must decide to make.
- **`sipRequest`.** Sending arbitrary SIP INFO/MESSAGE/NOTIFY with model-filled headers has no EL
  equivalent. SIP REFER is unrelated — in EL that is a transfer type.
- **`dynamic` handoff destinations.** A webhook choosing the handoff target at runtime has no edge
  equivalent.
- **`firstMessage` as an audio URL.** EL's first message is text. If the source points at an audio
  file, that is a real loss — tell the customer rather than silently transcribing it.
- **No per-end-user container spanning conversations.** Vapi Sessions group chat and SMS interactions,
  though not voice calls. EL has no first-class equivalent, so continuity across conversations has to
  be carried by the customer's own system.

One more worth checking on the source side before you migrate it: `rejectionPlan` lets Vapi veto a
tool call by regex or template. If the source relies on it to block an action, that protection does
not come across, and per the tool-scoping rule in `reference/traps.md` it needs to be enforced at the endpoint.

## How far to trust this file

The mappings above are drawn from Vapi's published API schema and documentation, so they are reliable
about what a construct **is** and what it maps to. They are not a description of what real Vapi
configs look like in practice — field nesting, which fields are actually populated, how a typical
squad is arranged.

So treat this as **mapping rules**. Read the customer's export for shape, and when it disagrees with
something here about shape, the export wins. Say so plainly rather than forcing the config to match
the table.
