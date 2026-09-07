# code-tools

A skill for generating JavaScript/TypeScript modules for ElevenLabs **code tools** — custom logic that runs on ElevenLabs infrastructure, exports `export default async (ctx) => { ... }`, calls APIs with `fetch`, and returns a minimized result to the agent.

Triggers: "write a code tool", "code tools", "ElevenLabs code tool", "egress with auth connection", "code tool allowed domains", "X-With-Auth-Connection", or pasting a brief for sandbox JS/TS tool logic.

## Files

| File | Purpose | Loaded by |
|---|---|---|
| `SKILL.md` | Entrypoint. Canonical `ctx` API, constraints, intake questions, fixed output template, anti-patterns. | Claude Code, Cowork, Cursor — when triggered |
| `examples.md` | Five full patterns: field-minimizing lookup, bounded poll, `Promise.all`, auth-connection logging, secret-based API key. | On demand when implementing a matching pattern |
| `local-executor.mjs` | Runs a generated tool module locally against a mocked `ctx`. | Manually, via `node local-executor.mjs ...` |
| `ctx.example.json` | Sample `ctx` fixture (`args` / `secrets` / `config` / `auth_connections`) for `local-executor.mjs`. Copy to `ctx.local.json` (gitignored) to fill in real values. | Loaded by `local-executor.mjs` by default |
| `README.md` | This file. |

## What it produces

For each request, a paste-ready package:

1. **Code** — default-export module for the studio editor
2. **Parameters** — Setup params table
3. **Context object mapping** — secrets / auth connections / config values
4. **Allowed domains checklist** — admin-only network allowlist entries
5. **Run-in-editor test plan** — sample Params + expected Output
6. **Agent-facing notes** — short tool description / when to call

## Three ways to use it

### 1. Claude Code (CLI)

Clone or symlink this skill directory into your Claude Code skills folder. Claude Code auto-discovers it and triggers on the phrases above.

```bash
# example — adjust to your Claude Code skills path
mkdir -p ~/.claude/skills
ln -s /path/to/plugin/architect/skills/code-tools ~/.claude/skills/code-tools
```

### 2. Claude Cowork (desktop app)

1. Drop this skill directory into a folder Cowork can access, or zip it as `code-tools.skill` and open it in Cowork.
2. Enable the skill in Cowork skill settings.
3. Trigger with phrases like "write a code tool that looks up orders in Supabase".

No API keys are stored in this skill. Credentials are mapped in the ElevenLabs UI **Context object** when you configure the tool.

### 3. Cursor

Cursor discovers project skills under `.cursor/skills/`. Symlink or copy:

```bash
mkdir -p .cursor/skills
ln -s /path/to/plugin/architect/skills/code-tools .cursor/skills/code-tools
# or: cp -r /path/to/.../skills/code-tools .cursor/skills/
```

Cursor reads `SKILL.md` frontmatter and pulls the skill in when the chat matches. `examples.md` loads on demand when the skill instructs the agent to read it.

## Requirements

- Access to an ElevenLabs workspace where you can create a **code tool**
- An **admin** to add domains under **General Settings → Code tool allowed domains** if the tool needs egress
- Workspace secrets / auth connections already configured (or create them in the UI) before mapping them in the tool Context object

## Run locally before pasting into the studio

`local-executor.mjs` runs a generated tool module against a mocked `ctx`, so you can iterate without round-tripping through the studio editor for every change.

```bash
node skills/code-tools/local-executor.mjs path/to/tool.mjs skills/code-tools/ctx.example.json
```

- The tool file must be valid ESM with `export default async (ctx) => {...}`.
- Copy `ctx.example.json` to `ctx.local.json` (gitignored) and fill in `args` / `secrets` / `config` / `auth_connections` — never commit a filled-in fixture, and never fill in `ctx.example.json` itself.
- Enforces the same 1–30s tool timeout as production (aborts the in-flight request on timeout; override within that range with `--timeout=<ms>`, e.g. `--timeout=5000`).
- Real `fetch` calls still hit the network. `ctx.secrets` works like production — a real API key behaves the same locally as in the studio. `ctx.auth_connections` does not: the `X-With-Auth-Connection` credential swap only happens inside ElevenLabs' sandbox network, so locally that header is just whatever string you put in the fixture — fine for exercising your tool's logic, but it won't authenticate against the real upstream API the way it would in production.

## Security notes

- Never put raw secrets or OAuth tokens in generated code.
- Prefer `ctx.auth_connections` + `X-With-Auth-Connection` for any auth connection (OAuth or otherwise) so the sandbox never sees the live credential.
- Always project return payloads — tool results are LLM-visible.

## Notes

- No npm dependencies in the sandbox — stick to built-in JS and Web APIs (`fetch`, etc.).
- Tool timeout is 1–30 seconds; poll loops must be capped.
- Canonical property names are `ctx.args` and `ctx.auth_connections` (not `ctx.pargs` / `ctx.authConnections`).
