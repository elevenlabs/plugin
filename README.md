# ElevenLabs Plugin

Voice AI capabilities for your coding agent — powered by [ElevenLabs](https://elevenlabs.io). Works with **Cursor**, **Claude Code**, **OpenAI Codex**, and any client implementing the open [Agent Plugins](https://agent-plugins.org) standard (v1.0.0).

## What's included

### Skills

Skills live in two trees:

- **[skills/general/](skills/general/)** — general ElevenLabs product skills, copied from the official [elevenlabs/skills](https://github.com/elevenlabs/skills) repository. Don't edit these here; contribute upstream instead.
- **[skills/mcp/](skills/mcp/)** — plugin-native skills that teach agents how to drive the bundled ElevenLabs MCP server.

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
