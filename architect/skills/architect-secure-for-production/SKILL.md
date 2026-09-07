---
name: architect-secure-for-production
description: "Use when a customer asks how to make their agent safe, secure, or production-ready, or how to roll it out without risk. Walks through the layered safety model across authentication, guardrails, testing, gradual rollout, real-time monitoring, and privacy."
---

# Secure an agent for production

Walk the customer through ElevenLabs' layered safety model. The guiding principle: protections at every stage, before the agent goes live, while it is running, and after each conversation. This is the same lifecycle behind ElevenLabs' AIUC-1 certification (the first safety/security/reliability standard purpose-built for AI agents, which also underpins agent insurance eligibility). Do not quote certification percentages, coverage terms, or pricing from memory; point the customer to their account team or current docs for anything commercial.

Most of the settings below are configured in the agent's Security, Advanced, and Privacy config and can be inspected or set over the ConvAI REST API (host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`) with `GET`/`PATCH /v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID`. Read the current config before advising.

## Stage 1: control who can reach the agent (authentication)

Restrict access first. Configure one method per agent:

- Signed URLs, recommended for client-side apps. Your server requests a temporary signed WebSocket URL using your API key, the client connects with it, and it expires after fifteen minutes. This authenticates sessions without exposing the API key client-side.
- Allowlists, to restrict connections to approved hostnames (up to ten, exact-match, so add subdomains separately). Best for hostname-based access control.

Do not configure both on one agent; pick the one matching the deployment model. The signed-URL mechanism confirms the request came from an authorized source; to restrict to specific users, authenticate them in your own app before requesting the signed URL. Never expose the API key in client code.

## Stage 2: shape and constrain behavior (guardrails)

Guardrails protect at three levels:

- System prompt hardening plus the Focus guardrail, the foundation. Put the most critical rules under a `# Guardrails` heading in the system prompt (models attend to it specifically), and enable the Focus guardrail to keep the agent on-topic across long conversations.
- Manipulation guardrail, which validates user input, detecting prompt injection and instruction-override attempts and terminating risky conversations before the agent responds.
- Content and Custom guardrails, which independently validate the agent's replies before delivery. Content blocks inappropriate material; Custom lets the customer define business-specific rules in plain language (for example, "block specific financial advice", "no refunds unless eligibility is confirmed"). For the most critical rules, put them in both the system prompt and a custom guardrail: defense in depth, so a response validator catches drift even if the model slips.

Tradeoffs to convey: streaming mode adds no latency but may emit a little output before a block (recommended for voice); blocking waits for validation (~200-500ms, recommended for text) and is the only mode that supports retry as an exit strategy. Focus/Manipulation/Content are included; Custom guardrails incur usage-based LLM cost per response. Guardrails are currently in alpha; advise validating and monitoring logs as the feature evolves.

## Stage 3: prove it works before going live (testing)

Do not ship on intuition. The testing framework supports:

- Scenario tests, single-turn, evaluating a response against plain-language success criteria with success/failure examples.
- Tool-call tests, verifying the agent calls the right tool with correct parameters (exact match, regex, or LLM evaluation). Essential for high-stakes actions like transfers.
- Simulation tests, full multi-turn conversations against a simulated user, with tool mocking so live systems are not hit.

Recommend turning real failed conversations into tests, testing prompt-injection attempts explicitly, and using probabilistic testing (run a test 3x/5x/15x via `repeat_count` on the run) to get a pass rate rather than a single pass before shipping a change. Integrate into CI/CD. Over REST, create tests with `POST /v1/convai/agent-testing/create`, attach with `POST /v1/convai/agents/$AGENT_ID/testing/attach-test`, and run with `POST /v1/convai/agents/$AGENT_ID/run-tests` (which takes `repeat_count`).

## Stage 4: roll out gradually

When rolling out an agent for the first time, and when shipping new behavior to a live agent, do it gradually behind a feature flag. Do not flip the new agent on for 100% of traffic at once. Gate the new agent or behavior and ramp exposure (small cohort, then wider, then full), watching monitoring and guardrail logs at each step, with the flag as instant rollback. Versioning and Experiments (A/B on production traffic) support comparing the new configuration against the current one with data before fully committing. Branches and traffic splits over the API let you stage a new version and shift traffic to it gradually rather than merging straight to full exposure.

## Stage 5: watch it live (real-time monitoring, enterprise)

For high-stakes deployments, real-time monitoring (enterprise-only) streams live conversation events over a WebSocket and lets an operator send control commands mid-call: end the call, transfer to a number, inject a contextual update, or trigger human takeover in chat. Enable it in Advanced settings; it needs `ElevenLabs Agents Write` scope and EDITOR workspace access. Use it for QA, human escalation, and call-center oversight. Limits: text/metadata only (no audio), roughly the last 100 events cached, connect only after the conversation starts.

## Stage 6: control what is retained (privacy)

Match data handling to the customer's compliance needs:

- Retention: how long transcripts and audio are stored (down to 0 days for immediate deletion).
- Audio saving: whether call recordings are kept at all.
- Conversation history redaction (enterprise): strips sensitive entities from stored transcripts (placeholders) and audio (bleeps); Zero Retention Mode (enterprise) for the strictest cases.

Give conceptual guidance only on regulatory specifics. For HIPAA/GDPR retention periods, point the customer to current docs and their own compliance/legal team rather than asserting requirements.

## How to walk a customer through this

Diagnose where they are. "Just built it, how do I make it safe?" points to all six stages in order. "Worried about it saying the wrong thing" points to guardrails (Stage 2) plus testing (Stage 3). "How do I launch safely?" points to gradual rollout (Stage 4) plus monitoring (Stage 5). Ground every step in its config location, and route commercial questions (insurance, AIUC-1 scope, custom guardrail pricing) to the account team rather than answering from memory.
