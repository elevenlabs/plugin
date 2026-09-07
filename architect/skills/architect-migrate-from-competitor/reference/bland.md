# Bland → ElevenLabs

## How far to trust this file

The mappings below are drawn from Bland's current public documentation, so they are reliable about
what a Bland construct **is** and what it maps to. They do not describe serialized shape — which
fields a real export actually carries, how they nest, or what a typical pathway looks like.

So treat this as **mapping rules**, and read the customer's export for shape. Where the export
disagrees with anything here about shape, the export wins; say so rather than forcing it to match.
Do not write example Bland JSON — you would be inventing a shape and presenting it as observed.

## Bland has six node types

Bland's documentation states there are currently six: **Default**, **Webhook**, **Knowledge Base**,
**End Call**, **Transfer Call**, and **Wait for Response**.

Two node types that appear in circulating mapping tables **do not exist**: there is no "Dialogue
Node" (the conversational one is `Default`) and no "Route Node" (branching lives on the edge between
nodes; "Route" is only a label in Bland's own call logs). If a customer or a document refers to
either, clarify what they actually mean before converting anything.

## Construct mapping

| Bland | ElevenLabs | Notes |
|---|---|---|
| Web agent | Agent | — |
| Inbound phone agent | Agent + imported phone number | Bland configures the prompt or pathway **on the number record**; EL imports a number and assigns an agent to it. |
| Prompt | agent prompt | The field name differs by surface: `task` on the call endpoint, `prompt` on inbound numbers and web agents. |
| First sentence | `first_message` | EL also supports an empty first message, meaning the agent waits for the caller — no documented Bland analogue. |
| Pathway | workflow | — |
| Default node | `override_agent` node | The conversational node. Shown as an agent node in the dashboard. |
| Edge label / condition | edge `forward_condition` / `backward_condition` | EL edges are keyed on the unordered node pair and carry both directions on one object. |
| Webhook node (in-call) | webhook tool, or a `tool` node | — |
| Call-level `webhook` param (post-call) | post-call webhook | **Not** the same thing as the webhook node. Mapping both to "a webhook tool" loses the post-call path. |
| Knowledge Base node | `override_agent` node with `additional_knowledge_base` | Must be `override_agent`; a `say` node accepts the write and ignores it. |
| End Call node | `end` node | The only genuinely terminal EL node type. |
| Transfer Call node | `phone_number` node | **Not** one-way — see below. |
| Cold transfer | `blind` transfer | EL's default is `conference`, so blind must be set explicitly. |
| Warm transfer | `conference` transfer | Enterprise-gated on Bland, so a non-Enterprise source will not contain one. |
| Wait for Response node | `entry_behavior: "wait_for_user"` on the target node | — |
| Tools (visual builder) | webhook / client / code / MCP tools | Bland's older "Custom Tools" are legacy; current product is the visual Tools builder. |
| `dynamic_data` | conversation-initiation webhook + webhook tool | Bland's per-call `cache` flag has no EL equivalent. |
| `request_data` | dynamic variables via the initiation payload | See the unanswered-call trap below. |
| Citations / post-call analysis | data collection + evaluation criteria | Route to `architect-post-call-data`. |
| BYO Twilio (`encrypted_key`) | imported Twilio number (SID + auth token) | See gaps — the credential does not transfer. |

## Traps specific to a Bland import

- **A Transfer Call node is not a dead end in ElevenLabs.** Bland's documentation describes its
  transfer node as ending the dialogue at that node. EL's `phone_number` node stops only on a
  *successful* transfer; on failure it evaluates its outgoing edges. So the migration should *add* a
  failure edge that the source never had. This is an improvement available for free, and it is the
  single most commonly mis-stated fact about EL transfers.
- **`request_data` is not populated on unanswered calls.** Anything the source reads from it assumes
  the call was answered. If a migrated flow depends on those values, it needs the same assumption made
  explicit, or a fallback.
- **The prompt field name depends on which Bland surface produced the config.** Do not assume `prompt`.
- **Warm transfer and SIP are entitlement-gated on Bland.** Their absence from an export does not mean
  the customer does not use them; ask.

## Where the real gaps are

Treat any "Bland has X and ElevenLabs does not" claim as wrong until you have searched and failed to
find the feature. Nearly all of them are. ElevenLabs has guardrails, a categorised native integration
library covering the major CRMs and calendars, code tools, per-agent retention and zero-retention
mode, branches and versions with diff previews, workflow analytics, per-node background sound,
simulation-test generation from a real conversation, node layout coordinates, and native SIP trunk
configuration — every one of which has been claimed as missing.

Only two gaps hold up:

- **Bland's built-in `{{prevNodePrompt}}` and `{{lastUserMessage}}` have no ElevenLabs equivalent.**
  EL's system variables are a fixed set — agent id, caller id, called number, call duration,
  conversation id, call SID, time, timezone — and neither of Bland's is among them. This matters
  because a common Bland idiom is to quote the previous node's goal or the caller's last utterance
  inside a node prompt. Rebuild that intent explicitly: write the value into a dynamic variable with
  an `update_state` node, or restate the context in the node's own prompt.
- **A BYO Twilio `encrypted_key` cannot be migrated.** It is an opaque Bland-side handle over the
  customer's Twilio SID and auth token, and Bland shows it only once. ElevenLabs needs the raw SID and
  auth token to import the number. The customer must retrieve those from Twilio directly — a lost
  `encrypted_key` cannot be reversed into them.

Two more are narrower than usually claimed rather than absent: EL's guardrails exist but have no
transfer-on-trigger or jump-to-node action, and voice multiplicity exists — the genuine gap is
random per-call voice rotation.

## What to ask for before you start

Get both a Persona export and a pathway export. A Persona bundles identity, voice, language,
background noise, modalities, prompt, routing, knowledge base, analysis and versions, with tools
attached separately — so a Persona alone does not show you the conversation graph, and a pathway alone
does not show you the agent's configuration. You need both to convert either faithfully.
