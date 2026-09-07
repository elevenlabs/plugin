# ElevenLabs Plugin

Voice AI capabilities for your coding agent — powered by [ElevenLabs](https://elevenlabs.io). Works with **Cursor**, **Claude Code**, **OpenAI Codex**, and any client implementing the open [Agent Plugins](https://agent-plugins.org) standard (v1.0.0).

## What's included

### Skills

Skills live in three trees:

- **[skills/general/](skills/general/)** — general ElevenLabs product skills, copied from the official [elevenlabs/skills](https://github.com/elevenlabs/skills) repository. Don't edit these here; contribute upstream instead.
- **[skills/mcp/](skills/mcp/)** — plugin-native skills that teach agents how to drive the bundled ElevenLabs MCP server.
- **[architect/skills/](architect/skills/)** — Architect skills: opinionated workflows for building and iterating on ElevenLabs agents, mirrored from the internal Architect plugin. Shared payload examples live in [architect/reference/](architect/reference/).

| Skill | Description |
|-------|-------------|
| [agents](skills/general/agents/SKILL.md) | Build real-time voice AI agents and assistants |
| [dubbing](skills/general/dubbing/SKILL.md) | Dub audio and video into other languages, preserving the original speakers' voices |
| [music](skills/general/music/SKILL.md) | Generate instrumental tracks, songs with lyrics, background music, and jingles |
| [setup-api-key](skills/general/setup-api-key/SKILL.md) | Guide users through configuring an ElevenLabs API key |
| [sound-effects](skills/general/sound-effects/SKILL.md) | Generate sound effects and audio textures from text descriptions |
| [speech-engine](skills/general/speech-engine/SKILL.md) | Add real-time voice conversations to your own agent runtime |
| [speech-to-text](skills/general/speech-to-text/SKILL.md) | Transcribe audio to text with Scribe v2 |
| [text-to-speech](skills/general/text-to-speech/SKILL.md) | Convert text to natural speech in 70+ languages |
| [voice-changer](skills/general/voice-changer/SKILL.md) | Transform a recording into a different voice, preserving emotion and timing |
| [voice-isolator](skills/general/voice-isolator/SKILL.md) | Remove background noise and isolate speech from audio |

MCP skills:

| Skill | Description |
|-------|-------------|
| [agents-platform](skills/mcp/agents-platform/SKILL.md) | Create, configure, test, and deploy voice agents via the bundled MCP server |
| [creative-studio](skills/mcp/creative-studio/SKILL.md) | Generate speech, images, and video, and transcribe audio via the bundled MCP server |

Architect skills:

| Skill | Description |
|-------|-------------|
| [agent-simplification](architect/skills/agent-simplification/SKILL.md) | Simplify a complex workflow agent into a leaner architecture, proven equivalent by a test suite |
| [architect-agent-memory](architect/skills/architect-agent-memory/SKILL.md) | Persist facts an agent should remember, in a durable branch-scoped way |
| [architect-branches-versions-merge](architect/skills/architect-branches-versions-merge/SKILL.md) | Work with agent branches, versions, drafts, traffic splits, and merges |
| [architect-create-client-tool](architect/skills/architect-create-client-tool/SKILL.md) | Add a client tool that runs in the caller's browser, app, or SDK |
| [architect-create-llm-test](architect/skills/architect-create-llm-test/SKILL.md) | Create a single-turn test that checks what the agent says |
| [architect-create-simulation-test](architect/skills/architect-create-simulation-test/SKILL.md) | Create a multi-turn test where a simulated user talks to the agent |
| [architect-create-tool-test](architect/skills/architect-create-tool-test/SKILL.md) | Create a test asserting the agent calls, or avoids, a specific tool |
| [architect-create-webhook-tool](architect/skills/architect-create-webhook-tool/SKILL.md) | Give an agent a new webhook tool that calls an external API |
| [architect-edit-existing-tool](architect/skills/architect-edit-existing-tool/SKILL.md) | Change an existing tool on an agent safely |
| [architect-edit-string-fields](architect/skills/architect-edit-string-fields/SKILL.md) | Edit long text fields like system prompts without clobbering the rest |
| [architect-edit-workflows](architect/skills/architect-edit-workflows/SKILL.md) | Build or change an agent's workflow graph |
| [architect-explain-test-runs](architect/skills/architect-explain-test-runs/SKILL.md) | Explain why a test or test run passed or failed |
| [architect-explore-agent](architect/skills/architect-explore-agent/SKILL.md) | Map an agent's current setup before changing it |
| [architect-generate-agent](architect/skills/architect-generate-agent/SKILL.md) | Generate a new agent from a description |
| [architect-get-agent-ci-green](architect/skills/architect-get-agent-ci-green/SKILL.md) | Drive a red agent test suite to green |
| [architect-llm-selection](architect/skills/architect-llm-selection/SKILL.md) | Choose the right LLM for an agent |
| [architect-manage-procedures](architect/skills/architect-manage-procedures/SKILL.md) | Add, edit, rename, and inspect an agent's procedures |
| [architect-migrate-from-competitor](architect/skills/architect-migrate-from-competitor/SKILL.md) | Migrate a voice agent from Retell, Vapi, or Bland |
| [architect-migrate-to-procedures](architect/skills/architect-migrate-to-procedures/SKILL.md) | Move a system-prompt-driven agent to a procedure-driven setup |
| [architect-mock-all-tools](architect/skills/architect-mock-all-tools/SKILL.md) | Mock every tool call so simulation tests are deterministic |
| [architect-post-call-data](architect/skills/architect-post-call-data/SKILL.md) | Configure post-call data collection and evaluation criteria |
| [architect-review-live-calls](architect/skills/architect-review-live-calls/SKILL.md) | Review recent production conversations and route the findings |
| [architect-schedule-launch](architect/skills/architect-schedule-launch/SKILL.md) | Stage a change on a branch and hold the merge until go-live |
| [architect-secure-for-production](architect/skills/architect-secure-for-production/SKILL.md) | Make an agent safe, secure, and production-ready |
| [architect-structured-procedures](architect/skills/architect-structured-procedures/SKILL.md) | Author structured, deterministic procedures |
| [architect-troubleshoot-tool-errors](architect/skills/architect-troubleshoot-tool-errors/SKILL.md) | Diagnose a misbehaving tool from its exact error |
| [architect-turn-taking-latency](architect/skills/architect-turn-taking-latency/SKILL.md) | Tune turn taking and agent response latency |
| [architect-update-config-safely](architect/skills/architect-update-config-safely/SKILL.md) | Change agent settings with safe partial patches |
| [code-tools](architect/skills/code-tools/SKILL.md) | Generate JavaScript/TypeScript modules for ElevenLabs code tools |
| [fix-agent-qa-ticket](architect/skills/fix-agent-qa-ticket/SKILL.md) | Fix a QA triage ticket end to end with a verified, branch-scoped fix |

Architect also ships one command: [/thermo-nuclear-agent-triage-burndown](architect/commands/thermo-nuclear-agent-triage-burndown.md), which burns down an agent's whole conversation-triage queue — cluster tickets by root cause, fix each cluster, then comment on and resolve every ticket.

### MCP Server

The [ElevenLabs hosted MCP server](https://api.elevenlabs.io/v1/mcp) — no local install, no API key. Your agent authenticates with your ElevenLabs account over OAuth and gets access to agent management (create, update, list, duplicate, delete agents; inspect widget config, links, and knowledge base size; estimate LLM usage) and text-to-speech generation. Configured in [mcp.json](mcp.json) (Agent Plugins format); Cursor uses [.cursor-plugin/mcp.json](.cursor-plugin/mcp.json), which additionally pins Cursor's OAuth client and scopes.

## Installation

### Cursor

Install from the [Cursor marketplace](https://cursor.com/marketplace), or add this repo as a plugin. When Cursor connects to the MCP server, sign in with your ElevenLabs account to complete the OAuth flow.

### Claude Code

```
/plugin marketplace add elevenlabs/plugin
/plugin install elevenlabs@elevenlabs
```

Or install directly for development: `claude --plugin-dir /path/to/plugin`

### Codex

```
codex plugin marketplace add elevenlabs/plugin
```

Then install via `/plugins` in Codex, or invoke skills with `$skill-name`.

### Skills only (any agent)

```bash
npx skills add elevenlabs/skills
```

## Requirements

- An [ElevenLabs](https://elevenlabs.io) account — you'll sign in via OAuth when your agent connects to the MCP server
- Internet access
