# Shared reference: what a complete config actually looks like

Two example payloads and one lookup recipe, shared by every skill in this plugin.

They exist because of a measured behaviour: asked to build or convert an agent, a run that has no
canonical example goes and finds one. It reads a sample config out of whatever repo happens to be on
disk, or a scratch file from an earlier session. That is non-deterministic, the sample may be stale,
and **in a public install there is nothing to find at all** — so the same skill quietly performs worse
for an outside user than it does for us, in a way no internal test would reveal.

| File | What it is |
|---|---|
| `example-agent.json` | A complete agent create payload — ASR, turn, TTS, prompt, workflow, platform settings |
| `example-webhook-tool.json` | A complete webhook tool, including the whole `api_schema` |
| `../scripts/check-examples.mjs` | Checks both against the live OpenAPI spec; also emits fresh skeletons |

## Read these as a field catalogue, not a template

Every field carries a realistic value so you can see where it lives and what shape it takes. That is
the whole purpose. **Do not start from one.** An agent with every knob set is not a good agent, and a
tool with every option populated is not a good tool — copy one wholesale and you ship a maximalist
config whose settings nobody chose.

Three specific things they are here to settle, because each gets guessed wrong repeatedly:

- **`path_params_schema` is an object keyed by parameter name. `query_params_schema` is
  `{properties, required}`.** Different shapes, same neighbourhood. Passing an array for the first is
  the `Input should be a valid dictionary` rejection.
- **A property carries exactly one value source, and `description` is one of them.** That is the
  counterintuitive half. The exclusive set is `description`, `dynamic_variable`,
  `is_system_provided`, `constant_value`, `is_omitted` — so a property with a `constant_value` must
  carry **no description at all**, however much you want to explain it. The tool example has four
  properties precisely because each demonstrates a different one. Adding a description to a property
  that already has a value source is the `Can only set one of: ...` rejection, and it is the mistake
  a migration makes by default, because the source platform usually has both.
- **Response paths are dot notation, not JSONPath.** `reservation.status`, never
  `$.reservation.status`. This applies to a webhook tool's `assignments[].value_path` and to
  `response_filter.filters`. A leading `$.` carried over from another platform is rejected.

The values are invented. No real credential, host, or customer identifier appears in either file, and
none ever should — this plugin is published.

## For any field not shown: ask the spec

The examples are curated for readability, so they show the fields that matter for building an agent
and skip the ~50-field widget tree entirely. When you need a field they do not cover, or you want to
confirm one has not moved, the authority is the live spec:

```
https://api.elevenlabs.io/openapi.json
```

Public, unauthenticated, always current, about 2MB across ~1,470 schemas. It is deliberately **not**
vendored here: its whole value is being current, and a committed copy would be a second source of
truth that drifts. A stale spec is worse than none, because a field missing from an old snapshot reads
as a field that does not exist.

```bash
SPEC=/tmp/el-openapi.json
curl -s https://api.elevenlabs.io/openapi.json -o "$SPEC"

# What fields does the prompt object take?
jq -r '.components.schemas["PromptAgentAPIModel-Input"].properties | keys[]' "$SPEC"

# What are the legal values of an enum field?
jq -r '.components.schemas.TTSConversationalModel.enum[]' "$SPEC"

# What is the default the platform applies when you omit a field?
jq -r '.components.schemas.TurnConfig.properties | to_entries[] | "\(.key) = \(.value.default)"' "$SPEC"
```

**Expect `$ref` indirection.** Most interesting fields resolve to a reference rather than a shape, so
one lookup usually is not enough:

```bash
# This gives you a $ref, not the answer
jq -c '.components.schemas["WebhookToolConfig-Input"].properties.api_schema' "$SPEC"
#   => {"$ref":"#/components/schemas/WebhookToolApiSchemaConfig-Input", ...}

# Follow it
jq -r '.components.schemas["WebhookToolApiSchemaConfig-Input"].properties | keys[]' "$SPEC"
```

Note the `-Input` / `-Output` suffixes: request models and response models are separate schemas, and
they differ. When you are building a payload you want `-Input`.

## Keeping the examples honest

Because they are curated, they can rot — and a trusted stale example is worse than no example. So:

```bash
node scripts/check-examples.mjs --check          # both files against the live spec
node scripts/check-examples.mjs --emit agent     # a fresh exhaustive skeleton
```

`--check` reports any field the schema no longer declares, any required field missing, and any value
whose type or enum contradicts it, and exits non-zero, so CI catches drift rather than a user catching
it. It is read-only and needs no API key; the one network call is a GET of the public spec.

**`--check` is a drift detector, not an acceptance test, and the gap is wide.** It walks a JSON
schema, and the rules that reject most real payloads are not in one — they are validators on the
models behind it. Measured: when these two files were first validated against the actual request
models they were rejected with **seven** errors, and a corrected `--check` catches exactly **one** of
the seven. The other six were a numeric range, a field-pair rule between `llm` and `reasoning_effort`,
a string-format rule, and three instances of one mutual-exclusion rule. A green `--check` means the
fields exist and have the right types. It does not mean the API will take the payload.

`--emit` is the escape hatch when you need the exhaustive version: it walks the live schema and prints
every field with its real default. That is how these files were built, and it is how to rebuild them
when the API moves. **The generated skeleton is not directly usable as a payload** — it sets every
value source on every property at once, which the API rejects. Curation is what makes it valid.

When `--check` fails, the fix is one of two things: the API moved and the example needs updating, or
someone edited the example into a shape the API will not accept. Deleting the offending field to make
the check pass is neither.
