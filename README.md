# ElevenLabs Plugin

Voice AI capabilities for your coding agent — powered by [ElevenLabs](https://elevenlabs.io). Works with **Cursor**, **Claude Code**, and **OpenAI Codex**.

## What's included

### Skills

| Skill | Description |
|-------|-------------|
| [text-to-speech](skills/text-to-speech/SKILL.md) | Convert text to natural speech in 70+ languages |
| [speech-to-text](skills/speech-to-text/SKILL.md) | Transcribe audio with Scribe v2 — diarization, speaker roles, timestamps |
| [speech-engine](skills/speech-engine/SKILL.md) | Add real-time voice conversations to your own agent runtime |
| [agents](skills/agents/SKILL.md) | Build real-time voice AI agents and assistants |
| [music](skills/music/SKILL.md) | Generate music from text prompts and composition plans |
| [sound-effects](skills/sound-effects/SKILL.md) | Generate sound effects from descriptions |
| [voice-changer](skills/voice-changer/SKILL.md) | Transform a recording into a different voice, preserving delivery |
| [voice-isolator](skills/voice-isolator/SKILL.md) | Remove background noise and isolate speech |
| [setup-api-key](skills/setup-api-key/SKILL.md) | Guided setup and validation of your ElevenLabs API key |

Skills are synced from the official [elevenlabs/skills](https://github.com/elevenlabs/skills) repository.

### MCP Servers

Direct access to the full ElevenLabs API via the [elevenlabs-mcp](https://github.com/elevenlabs/elevenlabs-mcp) server — voice management, audio generation, conversational AI, and more. Runs locally via `uvx` with your `ELEVENLABS_API_KEY`.

The **ElevenLabs hosted MCP** (`https://api.elevenlabs.io/v1/mcp`) exposes agent-building operations as direct tools — read and edit config, branches and versions, tools, tests, and procedures — authenticated per user over OAuth (browser sign-in on first use; no key to paste). The [agents](skills/agents/SKILL.md) skill and its [iterating](skills/agents/references/iterating.md) reference use it.

Both are configured in [mcp.json](mcp.json).

## Installation

### Cursor

Install from the [Cursor marketplace](https://cursor.com/marketplace), or add this repo as a plugin. Set your API key under **Plugins → ElevenLabs → Configure**.

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

- `ELEVENLABS_API_KEY` environment variable — get a key at [elevenlabs.io](https://elevenlabs.io) (the [setup-api-key](skills/setup-api-key/SKILL.md) skill can walk you through it)
- Internet access
- [uv](https://docs.astral.sh/uv/) for the MCP server:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
