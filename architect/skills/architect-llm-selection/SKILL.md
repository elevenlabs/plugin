---
name: architect-llm-selection
description: Use when choosing or recommending an LLM for an ElevenLabs agent, or answering "which model should this agent use", questions about region-restricted models, HIPAA/PCI/ZRM model eligibility, or latency/intelligence/cost tradeoffs between models.
---

# LLM selection for agents

Resolve constraints in this sequence. Each step narrows the candidate set; never widen it later. Everything is over the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`).

1. Explore the agent. Read the current LLM, workflow, and tools with `GET /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` first.
2. Region (infrastructural, non-negotiable). Determine deployment topology. EU and India customers hit isolated deployments with restricted model lists that apply to all tiers. A model hidden by region cannot be enabled; do not offer to.
3. Compliance entitlements (contract-gated). If the workspace requires HIPAA, PCI, or ZRM, filter to compliant models only. These are workspace-level flags managed by sales/CSMs, never self-serve.
4. Capability fit (intelligence / latency / cost). Within whatever survives steps 1-3, recommend on task requirements.

If a constraint in step 2 or 3 eliminates the model the user wanted, say so plainly and route to their CSM or a support form. Do not present a capability recommendation that violates a hard constraint.

## Step 1: region gate

| Region | Rule |
| --- | --- |
| US / default | Full model catalog, subject to compliance gates. |
| EU-isolated | Restricted list. Preview Gemini models and several others are hidden. |
| India-isolated | Heavily restricted: only `custom-llm`, `glm-45-air-fp8`, `gpt-4o`, `qwen3-30b-a3b`, `qwen36-35b-a3b`, `speech-engine`. |

Restriction is by deployment topology, not a toggle. Never offer to enable a region-hidden model.

## Step 2: compliance gate

Only relevant if the workspace has the corresponding entitlement. You cannot see workspace flags, so never assert an entitlement is active; the safe line is "your CSM can confirm this for your workspace." Never offer to enable HIPAA, PCI, or ZRM; they require contract changes.

- HIPAA requires all three: enterprise tier with `force_logging_disabled=true`, an LLM in the HIPAA-compliant set, and a signed BAA (a contract artifact you cannot verify; route BAA questions to sales). Approved families include Claude 3.5/3.7 Sonnet, Claude 3 Haiku, Claude Haiku 4.5, Claude Opus 4.7, Claude Sonnet 4 / 4.5 / 4.6, `custom-llm`, Gemini 1.5/2.0/2.5 flash and pro variants, `gemini-3.1-flash-lite`, and `speech-engine`. Models outside the list are not HIPAA-eligible regardless of tier; preview/GA-pending Gemini models are excluded.
- PCI is deny-by-default when on (`pci_compliance_required`). Only pre-approved telephony providers, webhook domains, MCP URLs, and integration IDs work. Adding an integration requires CSM review; offer a support form, do not promise self-serve.
- ZRM disables audio/transcript storage; effective only when `force_logging_disabled=true`. Custom LLM plus ZRM additionally needs `is_convai_custom_llm_with_zrm_allowed`. No Stripe SKU; part of the enterprise contract.

## Step 3: capability fit

Recommend within the surviving candidate set. Weigh three axes against the agent's job.

- Latency matters most for voice. In an STT to LLM to TTS loop, LLM time-to-first-token sits on the critical path and is the dominant lever on perceived delay. For real-time agents, bias toward the fastest tier that clears the quality bar.
  - Lowest latency: `gemini-3.1-flash-lite` / `nano` / small `qwen` / `*-mini` tiers and `speech-engine`.
  - Balanced: `gemini-3.5-flash`, `gpt-4o`, `gpt-5-mini`, `claude-haiku-4-5`.
  - Highest capability, higher latency: `claude-sonnet-4-6`, `claude-opus-4-7`, `gpt-5.x`, `gemini-3.x-pro` (where region/compliance permits).
- Intelligence. Reserve the top tier for genuinely hard reasoning, complex multi-tool orchestration, or nuanced instruction-following. Most transactional voice agents (booking, triage, FAQ, routing) run well on a mid tier and feel snappier. Over-provisioning intelligence usually costs latency the user will notice for quality they will not.
- Cost. Per-token price scales steeply with capability tier. Match tier to task; do not put a frontier model behind a deterministic IVR flow. For high-concurrency deployments, latency and cost compound.

### Quick heuristic

| Agent type | Priority | Typical pick (region/compliance permitting) |
| --- | --- | --- |
| Real-time phone / high concurrency | Latency, cost | `gemini-3.1-flash-lite` (ultra-low latency) or `gemini-3.5-flash` |
| Complex reasoning / multi-tool | Intelligence | `claude-sonnet-4-6`, `gpt-5.x`, `claude-opus-4-7` |
| HIPAA voice agent | Compliance, then latency | `claude-haiku-4-5`, `gemini-3.5-flash` (both in approved list) |
| India deployment | Region first | `gpt-4o` or `qwen36-35b-a3b` (catalog is tiny) |
| Custom/self-hosted model | Control | `custom-llm` (check ZRM + region eligibility) |

## Apply the choice

Set the model with `PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID` and body `{"conversation_config":{"agent":{"llm":"<model-id>"}}}`. This is branch-scoped and ships on merge.

## Output discipline

- State the binding constraint explicitly ("In the EU deployment, X is not available, so among allowed models...").
- Give one primary recommendation plus a fallback, with the reason (latency vs intelligence vs cost).
- For anything contract-gated, end with the route: CSM for entitlement confirmation, a support form for new integrations/documents, and https://compliance.elevenlabs.io/ for attestations and signed DPA/BAA/sub-processor requests.
- Never claim an entitlement is active, never offer to enable a contract feature or a region-restricted model.
