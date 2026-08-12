# ElevenLabs Plugin

Voice AI capabilities for your coding agent — powered by [ElevenLabs](https://elevenlabs.io). Works with **Cursor**, **Claude Code**, **OpenAI Codex**, and any client implementing the open [Agent Plugins](https://agent-plugins.org) standard (v1.0.0).

## What's included

### Skills

| Skill | Description |
|-------|-------------|
| [text-to-speech](skills/text-to-speech/SKILL.md) | Convert text to natural speech in 70+ languages |
| [speech-engine](skills/speech-engine/SKILL.md) | Add real-time voice conversations to your own agent runtime |
| [agents](skills/agents/SKILL.md) | Build real-time voice AI agents and assistants |

Skills are synced from the official [elevenlabs/skills](https://github.com/elevenlabs/skills) repository.

### MCP Server

The [ElevenLabs hosted MCP server](https://api.elevenlabs.io/v1/mcp) — no local install, no API key. Your agent authenticates with your ElevenLabs account over OAuth and gets access to agent management (create, update, list, duplicate, delete agents; inspect widget config, links, and knowledge base size; estimate LLM usage) and text-to-speech generation. Configured in [mcp.json](mcp.json) (Agent Plugins format).

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
