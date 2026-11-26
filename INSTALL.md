# Install the ElevenLabs plugin

The ElevenLabs plugin adds the hosted ElevenLabs MCP server and the ElevenLabs skills to a coding agent. Use the section for your agent. The last step signs in to the MCP server with an ElevenLabs account, in the browser.

If you are a coding agent following a setup prompt: use the section for the agent you are, run its terminal commands yourself, and leave the browser sign-in to the user. You cannot load the plugin into a session that is already open. Finish by telling the user what you installed and the one step left for them: typing `/reload-plugins` in Claude Code, or starting a new session in Codex.

## Claude Code

```bash
claude plugin marketplace add elevenlabs/plugin
claude plugin install elevenlabs@elevenlabs
claude mcp login plugin:elevenlabs:elevenlabs
```

The last command opens the sign-in in your browser. Then run `/reload-plugins` in Claude Code, or start a new session.

Inside Claude Code you can use `/plugin marketplace add elevenlabs/plugin` and `/plugin install elevenlabs@elevenlabs` instead, then `/mcp` to sign in.

## Codex

```bash
codex plugin marketplace add elevenlabs/plugin
codex plugin add elevenlabs@elevenlabs
codex mcp login elevenlabs
```

The last command opens the sign-in in your browser. Then start a new Codex session.

## Cursor

Install from the [Cursor marketplace](https://cursor.com/marketplace), or add this repo as a plugin. When Cursor connects to the MCP server, sign in with your ElevenLabs account to complete the OAuth flow.

## Skills only (any agent)

```bash
npx skills add elevenlabs/skills
```
