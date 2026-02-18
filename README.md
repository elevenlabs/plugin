# ElevenLabs Cursor Plugin

Voice AI capabilities for Cursor — powered by [ElevenLabs](https://elevenlabs.io).

## What's included

### Skills

| Skill | Description |
|-------|-------------|
| [text-to-speech](skills/text-to-speech/SKILL.md) | Convert text to natural speech in 74+ languages |
| [speech-to-text](skills/speech-to-text/SKILL.md) | Transcribe audio with speaker diarization and timestamps |
| [agents](skills/agents/SKILL.md) | Build real-time voice AI agents and assistants |
| [music](skills/music/SKILL.md) | Generate music from text prompts |
| [sound-effects](skills/sound-effects/SKILL.md) | Generate sound effects from descriptions |

### MCP Server

Direct access to the full ElevenLabs API via the [elevenlabs-mcp](https://github.com/elevenlabs/elevenlabs-mcp) server — voice management, audio generation, conversational AI, and more.

## Setup

1. Get an API key from [elevenlabs.io](https://elevenlabs.io)
2. Set the `ELEVENLABS_API_KEY` environment variable
3. Install [uv](https://docs.astral.sh/uv/) (required for the MCP server):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

## Requirements

- `ELEVENLABS_API_KEY` environment variable
- Internet access
- [uv](https://docs.astral.sh/uv/) (for MCP server)
