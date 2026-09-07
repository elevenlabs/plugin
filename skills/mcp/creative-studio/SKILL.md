---
name: creative-studio
description: Generate and edit media through the connected ElevenLabs MCP server — speech, images, video, music, and transcription. Use when the user asks to generate a voiceover, image, video, or soundtrack, edit an image, or transcribe audio directly, rather than writing application code. Requires the ElevenLabs MCP server bundled with this plugin.
license: MIT
---

# ElevenLabs Creative Studio (via MCP)

Workflow guidance for the `creative_*` tools on the ElevenLabs MCP server. Every
tool takes a `context` parameter — briefly state the user's goal in it. For
building media features into the user's own codebase (SDK, API), use the general
skills instead (`text-to-speech`, `music`, `sound-effects`, `speech-to-text`).

## How generations work

- `creative_generate_speech`, `creative_generate_image`, and
  `creative_generate_video` return immediately with a `flow_id`, `node_id`,
  `session_ids`, and a canvas `url` the user can open to keep editing. If the
  result doesn't render in a view, poll `creative_get_flow_run_status` until
  `all_completed` or `has_failures` is true.
- **Generations spend credits.** Pass `estimate_only: true` to price a long
  video or a batch of variations before committing. Never call a generation
  tool a second time to "retry" — that starts and charges a second generation.
- `generations_count` defaults to 4 variations so the user can pick; keep the
  default unless they ask for a specific number.

## Speech

- `voice_id` is required and only ever comes from `creative_list_voices` (or
  the user) — never from memory. Pick a voice matching what the user described;
  if they gave no hint, pick a clear general-purpose voice rather than asking.
- Default model: `eleven_multilingual_v2`. Use `eleven_v3` when the script uses
  inline audio direction tags like `[whispering]` or `[laughs softly]`.

## Images

- Default model: `gemini-2.5-flash-image`. Pick by need: `gpt-image-2` for
  rendered text, infographics, UI mockups, or reference-driven edits;
  `flux-2-pro` for fine detail and strict prompt adherence.
- `creative_get_flow_node_types` lists what the workspace can run;
  `creative_get_model_guide` explains how to prompt a specific model.

## Flows: combining generations

- Nodes on different flows cannot be connected. When one generation feeds
  another (lipsync, a voiceover over video), call `creative_create_flow` first
  and pass that `flow_id` to every related call.
- Wire upstream nodes with `connect_from`. A `node_id` only ever comes from a
  tool result or `creative_get_flow` — never invent one.
- `creative_edit_image` requires `connect_from`: a node from an earlier
  generation on the same flow, a library asset, or an upload.

## Reference files and transcription

- For a file already reachable (attached to the conversation, or a direct
  link): `creative_attach_reference_file` — returns a node with content.
- For a file on the user's machine: `creative_upload_flow_reference` — the node
  stays empty until the user picks a file, so confirm it has an asset (via
  `creative_get_flow`) before generating from it.
- Transcribe with `creative_transcribe_audio`, passing the audio node's id as
  `connect_from`; without it, a picker handles upload and transcription on its
  own — don't call the tool again or poll while it's open.
