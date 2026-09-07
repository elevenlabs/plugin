---
name: architect-migrate-from-competitor
description: Use when the user wants to move a voice agent onto ElevenLabs Conversational AI from another platform — Retell AI, Vapi, or Bland — or hands over an export from one of them to work from. Fires on "migrate my Retell agent", "convert this Vapi assistant", "move from Bland to ElevenLabs", "port my agent to ElevenLabs", "here is my agent JSON", or when the user pastes a JSON blob containing response_engine, squadId, transportConfigurations, or pathway. Not for unrelated database, codebase, or framework moves.
---

# Migrate a voice agent from another platform to ElevenLabs

## What this skill is for

The user has an agent built on Retell, Vapi, or Bland and wants it running on ElevenLabs. This skill
owns the parts of that job specific to *importing*: identifying the export, handling credentials
inside it, mapping foreign constructs onto ElevenLabs ones, naming what genuinely has no equivalent,
and sequencing the work.

It does **not** re-teach ElevenLabs authoring. This plugin has ~30 skills that own that, and they
are more detailed and better maintained than a summary here would be. Your job is to translate and
to route.

**What counts as finished: an agent that demonstrably runs.** Not an optimal one — a conversion that
starts, resolves its variables, calls a tool successfully and reaches an end. Aim to get there in one
pass and one round of fixes, which means the checking in step 5 is part of the work rather than
something offered afterwards. The finish line is a run, never a re-read of your own config, and "I
converted everything" is not a status report.

Assume an authenticated EL workspace with `$API_KEY` set, as every skill in this plugin does.

## What to delegate, and to whom

Route each step rather than reimplementing it. Most migrations touch six or seven of these; read one
when you reach its step, not up front.

| Step | Skill |
|---|---|
| Read the target agent's current state | `architect-explore-agent` |
| Choose the model | `architect-llm-selection` |
| Port prompt text and first message | `architect-edit-string-fields` |
| Build the workflow graph, nodes, edges | `architect-edit-workflows` |
| Author step-by-step logic as procedures | `architect-structured-procedures`, `architect-manage-procedures` |
| Recreate tools | `architect-create-webhook-tool`, `architect-create-client-tool`, `code-tools` |
| Fix a tool that misbehaves | `architect-edit-existing-tool`, `architect-troubleshoot-tool-errors` |
| Post-call fields and evaluation criteria | `architect-post-call-data` |
| Remaining config, turn-taking, latency | `architect-update-config-safely`, `architect-turn-taking-latency` |
| Auth, guardrails, retention | `architect-secure-for-production` |
| Stage and ramp the rollout | `architect-branches-versions-merge`, `architect-schedule-launch` |
| Mock tools before any test run | `architect-mock-all-tools` |
| The smoke run that proves it works (step 5) | `architect-create-simulation-test` |
| Parity tests, CI | `-llm-test`, `-tool-test`, `architect-get-agent-ci-green` |
| Score the agent — only once asked, see step 6 | `agent-review`, then `agent-simplification` |
| Check it once real calls exist (step 6) | `architect-review-live-calls` |

**Do not create the agent through `architect-generate-agent`.** Its own documentation warns that its
flow regenerates the prompt instead of installing the one you just converted. Create the shell
directly with `POST /v1/convai/agents/create`, then install the converted content.

**Reading a sibling skill is not the same as routing to it, and the difference costs you at write
time.** The temptation is to skim the two or three you think you need and hand-roll the rest, which is
faster right up to the first rejected payload — a real migration reimplemented tool creation, post-call
data, model selection and all testing inline, and hit its schema surprises while writing to the live
workspace rather than while reading. Each of these skills owns field-level detail this one deliberately
does not restate. Before you report, account to yourself for which skill covered each step: a step you
cannot attribute is a step you improvised. That accounting is for you, not for the report — a customer
has no use for a list of internal skill names.

## Step 1 — identify the platform

Dispatch on a field that is always present, not on one that merely often is:

| Signature | Platform | Read next |
|---|---|---|
| `response_engine.type` | Retell | `reference/retell.md` |
| `squadId`, `members[]`, `transportConfigurations`, `model.toolIds` | Vapi | `reference/vapi.md` |
| `pathway`, `nodes[].type` with a `Default` node, or a Persona payload | Bland | `reference/bland.md` |

Ask the user which platform it came from if the blob is ambiguous. Never guess from prose in the
prompt text.

## Step 1b — audit the export before converting it

Cheap, mechanical, and it routinely finds live bugs in the source agent. A migration is the first time
anyone reads the whole graph at once, so do this before deciding what to build:

- **Dangling edges** — a condition with no destination. These are silent dead ends on paths that look
  wired in the editor, and they land on happy paths as often as error paths.
- **Orphaned nodes** — nothing routes in, or nothing routes out. A whole feature that has never run.
- **Variables read but never assigned** — spoken in a prompt, written nowhere. The caller hears a
  literal placeholder or a blank. **Scan code-node bodies, not just template syntax.** A variable read
  as `dv.account_ref` inside a JavaScript node is invisible to a `{{...}}` search, so an export with a
  dozen code nodes will under-report badly on the exact check that matters most. Rank what you find by
  how many tools bind it: a variable bound on every tool that nothing supplies fails every tool call at
  conversation start.
- **One identifier, two different definitions.** Check whether any two tool entries share an id or a
  name while disagreeing on url or method. This is not tidiness — one export reused a single tool id
  across a main-flow tool and a component tool pointing at *different environments*, so the agent read
  from one and wrote to the other. Report it: an agent whose write paths leave the environment its name
  claims is a finding the owner will want, and it decides how you key the id map in step 4.
- **Response paths that cannot resolve** — an assignment reading a field the API does not return, or a
  path whose shape is wrong for the response (array indexing and object prefixes are the usual
  offenders). These carry across silently and break the same way on the new platform.
- **Branch conditions with a null target** and no else path.

### Do the audit in full. Do not report it in full.

This is the part that decides whether a migration feels like arriving somewhere or like being handed a
bill. Run every check above at full depth — the accuracy is the point, and nothing else in this skill
finds these. Then write the findings to a file, and bring **two** things back to the user:

1. **What their agent does** — the intents it handles, the tools it calls, the shape it is in. A dozen
   lines, and a diagram of the source graph where one helps. Name the phases using the source's own
   node names so they can check you. This is the only evidence they have that you understood their
   agent before you started rewriting it, and it is the cheapest trust available in the whole job.
2. **Only what you cannot proceed correctly without.** The test is mechanical: *would a wrong guess
   here break the migration?* A variable that every tool binds and nothing supplies, a voice that does
   not port, an environment that two halves of the graph disagree about. On a real 123-node export that
   list was **two items**. It is normally one to three.

Everything else goes in the file with a one-line pointer. Not because it does not matter — it is the
most valuable thing in this step — but because of *when* it arrives. A defect ledger delivered before
anything runs reads as "here is how much work you have bought," and the findings are almost all
pre-existing bugs in an agent that has been in production for months. Lead with a wall of red and a
first-time user concludes the platform is the problem, closes the tab, and stays where they are.

So do not open with a count of defects. When nothing blocks the conversion, **say that first** — it is
usually true and it is the single most useful sentence you can write.

**Separate the three registers, in the file and in anything you say aloud.** They read completely
differently and mixing them is what makes a short list feel long:

- **Blocks the conversion** — needs an answer now. This is the only category that goes inline.
- **Already broken in the source** — live today, reproduced faithfully. Say so explicitly. "Your
  current agent reads a placeholder to the caller here" is a gift; the same fact in an undifferentiated
  list is an accusation.
- **Does not port** — the genuine gaps, from `reference/<platform>.md`.

Never silently fix a defect and never silently carry one across. Logging it in the file is not silence;
it is where the mapping log and gap list already live, from step 4.

### Check the source's claims against its own endpoints

Everything above reads the export. Some of the worst defects are not in it — a prompt asserts a fact,
the backend it calls disagrees, and no amount of reading the JSON can tell you. Say a prompt instructs
the agent to offer same-day slots up to 5 p.m. while the scheduling endpoint refuses anything after
4:30. Both halves look right on their own, and the agent offers a slot its own tool then rejects.

So where the export hands you an endpoint, verify the facts the prompt states about it. This means
calling a third party's production API, so it is fenced:

- **Ask the user first, naming the endpoints.** They may not own that backend, and it may be someone
  else's live system.
- **Read-only endpoints only** — a lookup, an availability check, a status query. Never one that books,
  pays, cancels, sends, or writes, whatever its name suggests.
- **Synthetic values only.** A probe is not the place for a real name, number, or booking reference.
- **Skip it if the endpoint needs a credential you recovered from the export.** Using that credential
  to explore is a wider use than its owner authorised.

What you learn joins the findings. A prompt fact the backend contradicts is a caller-visible bug in the
source agent, and it is the kind nobody has reported, because it only shows up on the calls that hit it.

## Step 2 — credentials, before anything else touches the export

Exports embed live credentials: bearer tokens, Basic auth headers, API keys in tool headers, and
sometimes a secret inside a webhook URL's query string. Handle these first, because every later step
copies fields around.

1. Scan every tool for header values, URLs with embedded userinfo or query secrets, and any field
   whose name contains `auth`, `token`, `key`, `secret`, or `bearer`.
2. For each real credential found, create an ElevenLabs secret and reference it — never paste the
   literal value into a tool definition:

   ```
   POST /v1/convai/secrets
   {"type": "new", "name": "billing_api_token", "value": "<the value from the export>"}
   ```

   The response carries a `secret_id`. Reference it in the tool's `request_headers` as
   `{"secret_id": "<that id>"}`. Rotation is `PATCH /v1/convai/secrets/{secret_id}` with a body of
   `{"type": "update", "name": ..., "value": ...}` — note the id is in the path, not the collection
   endpoint you created against.

   **Secrets are workspace-scoped, so check what else uses one before you touch it.**
   `GET /v1/convai/secrets/{secret_id}/dependencies/{resource_type}` lists the resources depending on
   a secret. Rotating or deleting a secret that other agents reference breaks them, and a migration is
   exactly the context where someone tidies up a credential that looked unused.
3. Tell the user which credentials you found and that they are now live in a third system, so they
   can decide whether to rotate at the origin. A credential sitting in an export file has usually
   been shared more widely than its owner realises.
4. A value that is already a `{{template}}` reference is not a credential — do not resolve it to a
   literal, which is how an agent ends up authenticating as the wrong principal for the rest of a call.
   But do not carry the template across as a **string** either. **ElevenLabs substitutes nothing in a
   header string** — a header given as text is sent exactly as written, so `"Basic {{vault_token}}"`
   transmits those literal characters and the request is simply unauthenticated. It is a credential
   reference that does nothing, and it fails on every call rather than visibly at build time. Use the
   typed forms:

   - a dynamic variable — `{"variable_name": "vault_token"}`
   - a workspace secret — `{"secret_id": "<id>"}`
   - an environment variable — `{"env_var_label": "<label>"}`

   A locator supplies the **whole** header value, so it cannot be composed with a literal prefix. That
   sounds like a problem for `Basic <token>` and is not: **put the scheme word inside the secret.**
   Create the secret with value `Basic <token>` and reference it with `{"secret_id": ...}`. The header
   is then complete on its own, and the credential never appears in the agent config. If you find
   yourself wanting `"Basic {{vault_token}}"`, that is the sign to make a secret holding the whole
   header value.
5. **Watch for one variable that plays two roles.** A single name is often both a *static seed*
   credential used by early calls and a *per-user token* that a later tool overwrites mid-call. They
   need different treatment and it is easy to see only one of them:

   **The test is mechanical: does any tool write that variable during the call?** Look for a response
   assignment on any tool whose target is the variable name — not just on the tool you are holding,
   since the tool that issues a token is rarely the tool that uses it. Then:

   - **Nothing writes it → static.** Its value lives in the agent's variable defaults, so a
     `{"variable_name": ...}` locator would leave a live credential sitting in agent config in
     plaintext. Make a secret holding the complete header value and reference it with
     `{"secret_id": ...}`.
   - **Some tool writes it → swapped.** Use `{"variable_name": ...}`. A secret cannot change mid-call,
     and the locator leaks nothing because the value only ever exists at runtime.

   Because the locator supplies the whole header, a swapped variable has to hold the whole header value
   too. If the endpoint issuing that token returns a bare token, the assignment writing it cannot add
   the scheme word — so either have that endpoint return the complete value, or confirm the receiving
   API accepts a bare token. That is a short, concrete question for the customer, and it is worth asking
   before you build rather than after the first unauthenticated call.

   Handling only the swap leaves a placeholder in the agent's variable defaults, which invites someone
   to paste a live credential into agent config in plaintext. Say explicitly which of the two you have
   done.

Do not write the raw export, or any redacted copy containing real values, into a repo or a log.

## Step 3 — pick the shape

One decision to state and one to ask. What gets *shipped* has a sensible default and should not be put
to the user at all; what *shape* it takes is worth their judgement, and this is the moment for it —
after the audit, before anything is built.

### The deliverable is a default, not a question

**The rebuild ships. A faithful port gets built quietly alongside it as an oracle.** State that in one
line and move on. Do not open someone's migration by asking them to choose a migration philosophy —
they came to get their agent working, and the trade only means something to a person who already knows
what fidelity costs.

- **The rebuild is the agent.** The source is the specification, not the blueprint: pick the shape that
  fits, fix what the audit found, hand them something callable.
- **The faithful port is built and then not mentioned again.** It mirrors the source construct for
  construct, it is never deployed, and it is one converter pass now that the audit exists. It is the
  oracle — what parity tests are written against, and what `agent-simplification` wants before it will
  touch anything. One line in the report's file list is the whole of its visibility.

Two things change this, and both come from the user rather than from your reading of the export. If
they ask how they can tell the new agent matches, the port stops being silent — that is its purpose and
it is already built. If they say plainly that they are done with the source platform, skip it.

Findings are simply fixed in the rebuild and reproduced in the port. There is no per-finding question
to ask; the report says which ones you fixed.

### The shape is the question

This is the one decision worth putting to the user before you build, because it is the one they can
actually judge — they know their own call flow.

Four options, in increasing order of cost. **Recommend one** — with the reason, in a sentence they can
disagree with — rather than presenting a menu and waiting:

- **A single agent with a prompt.** Right for a source that is one big prompt with a few tools, and
  right more often than the source's node count suggests.
- **An agent with procedures.** Right for step-by-step logic — verification sequences, intake,
  scripted disclosures — where the order matters but the graph does not branch much.
- **An agent with a workflow.** Right when the source genuinely has distinct states with different
  tools, models, or voices per state.
- **A mix.** Common and often correct: a prompt or a small workflow for the spine, procedures for the
  sequences that hang off it. Do not treat the three above as exclusive.

Do not mirror the source's topology out of loyalty. Competitor editors encourage many small nodes, and
every node you carry over multiplies the configuration surface that can go wrong. Say what the shape
buys in terms of *their* agent — "your three queue components run the same algorithm, so they become one
paragraph and three procedures" — not in terms of node counts, which mean nothing to them. Every real
reduction comes from that kind of semantic merge; a mechanical conversion is roughly
node-count-neutral, which is exactly why the port is not the thing that ships.

## Step 3b — get the shapes right before anything is watching

Discovering the API's shape rules by being rejected by it is slow, and it burns the patience of whoever
is watching — a customer on a call, or someone who just uploaded their own export and is waiting. It is
avoidable: nearly every rejection below is a known shape rule, and the rest can be learned somewhere
harmless.

Three habits, in order of how much they save:

1. **Build every payload locally first, then write.** Do not alternate authoring and API calls
   node-by-node. Compose the whole set — tools, nodes, edges — check it against the rules in this
   skill and `reference/expressions.md`, and only then start writing. A shape mistake made once in a
   local draft is one fix; the same mistake discovered on call forty is forty.
2. **Do any genuine schema discovery somewhere disposable.** If you truly do not know whether a field
   is accepted, find out on a scratch agent rather than on the one being migrated. Ask which workspace
   to use for it — a workspace holding production agents is not disposable, and tools and knowledge-base
   documents are workspace-global, so a probe that creates one is not confined to your scratch agent.
   Delete only what you created in this session, by id you captured at create time. Never learn on the
   customer's agent, and never learn on a branch they are reading.
3. **Re-read a rejection before changing anything.** The messages below name a *symptom*, not the
   field at fault, so the instinct to bisect the payload is wrong and expensive. One of these cost a
   real migration fourteen identical failures.

| Rejection | What it actually means |
|---|---|
| `Input should be a valid dictionary or object to extract fields from` | An `expression` was passed as a **string**. Conditions are structured objects — see `reference/expressions.md`. |
| `Input should be a valid dictionary` | A `path_params_schema` was passed as an **array**. It is an object keyed by parameter name. |
| `Can only set one of: description, dynamic_variable, is_system_provided, constant_value, or is_omitted` | A property declares **two or more** value sources. Exactly one. |
| `Must set one of: description, dynamic_variable, ...` | A property declares **none**. Most often an array's `items` schema, which needs its own source. |
| `Invalid URL format` | A `{{...}}` source interpolation survived in a tool URL. Static host, single-brace path placeholder, `path_params_schema`. |
| `Duplicate edge found between X and Y` | An edge already exists for that node **pair**. Edges are keyed on the unordered pair, so the reverse transition becomes that edge's `backward_condition`. |
| `Input should be 'generate_immediately', 'wait_for_user' or 'auto'` | `entry_behavior` got something outside its enum. |
| `Input should be 'auto', 'force' or 'off'` | `pre_tool_speech` was given filler text. It is an enum, and it cannot carry a line — use `forced_tool_name` on an `override_agent` node instead. |

And one that never rejects at all, so no message will tell you: **`expression: {}`** is accepted and
silently becomes `boolean_literal` false, so the edge never fires.

And two on the **test** payloads, which is where people are still guessing after everything else has
gone in clean: `success_conditions` is a list of strings, and `simulation_scenario` is a plain string —
not the nested `simulated_user_config` object its name suggests. Both reject, and both only bite at
step 5, so they read as a broken smoke run rather than as two schema rules.

If something does go wrong in front of the customer, say what you are checking rather than narrating
surprise. "That field takes an object, fixing" is fine. A string of "oh, that didn't work" is what
makes a routine schema rule look like a broken migration.

## Step 4 — build in dependency order, and keep the id map

**Read `reference/traps.md` before you author anything here, and `reference/expressions.md` before the
first condition.** They are short and they are the failure list for exactly this step: every item in
them is a thing that is accepted by the API and wrong at runtime, so nothing later in this skill will
catch it for you. Read them now rather than after a rejection, because these do not reject.

**For the payload shapes themselves, read `../../reference/` — not a sample config you found in the
working repo.** A complete agent and a complete webhook tool live there, every field populated. The
sample you would otherwise grep for may be stale, may be someone's scratch file, and outside
ElevenLabs does not exist at all, which is how a skill passes internally and fails in the field.

Most of the order here is forced by what references what. Getting it wrong does not produce a clear
error; it produces a graph with references to things that do not exist yet.

1. **Create the agent shell.** Everything else needs its id. Do not use
   `architect-generate-agent` (see above).
2. **Create every tool, and record the id each one comes back with.** This is the step people skip
   the bookkeeping on, and it is unrecoverable later: a workflow's `tool` node references a tool by
   **id**, not by name, and so does `additional_tool_ids` on an `override_agent` node. You cannot build
   any node that calls a tool until its id exists.
3. **Create procedures through the branch-scoped flow** that `architect-manage-procedures` owns.
   Passing them in the agent-create payload returns 200 and silently drops them.
4. **Build nodes, then edges.** Edges reference node ids, so the nodes have to exist. Order only the
   conditional edges — the unconditional one is moved last for you.
5. **Then the rest of the config** — model, privacy, turn-taking — and only then step 5.

**Key the id map by something that is genuinely unique, which is neither the name nor the id alone.**
Exports break both keys, and each failure is silent:

- **Same name, different tools.** Routine. Once you have renamed one to satisfy uniqueness, a
  name-keyed map cannot tell them apart and quietly points several nodes at one tool.
- **Same id, different definitions.** Worse, and the case step 1b tells you to look for. An id-keyed map
  collapses the two, and half the graph then calls the wrong host — which nothing rejects, because both
  hosts answer.

So key on the **definition**: the source id together with the fields that decide where a call lands,
url and method at minimum. Two entries are the same tool only when those agree. When they do not,
create two ElevenLabs tools and record in the mapping log why one source tool became two — that split
is exactly the kind of thing a reader will otherwise assume was a mistake.

### Leave a coverage proof, for the rebuild and the port alike

Two local files. They are the difference between output someone can audit and output they have to take
on trust, and they cost almost nothing because you are making each of these decisions anyway:

- **A mapping log** — one entry per source behaviour: what it was, where it landed, and why. In a
  faithful port this is the fix log. In a rebuild it is the *only* thing that answers "did you drop
  something?", which is the rebuild's one genuine weakness against a port.
- **A gap list** — every construct you could not map and what you did instead. This is also what the
  user needs in order to sign off on the approximations, rather than discovering them later.

Write both to a scratch directory, never into a repo, and never let either hold a credential value or a
verbatim copy of the export.

### Then check your own output, not your intentions

Run a mechanical pass over what you actually emitted. Re-derive the things that are cheap to re-derive:
every edge's endpoints exist, every tool id referenced was really created, every node is reachable,
every variable a tool binds is assigned somewhere.

This is not ceremony. On one real migration that pass caught a bug in the converter its own author had
just written: where a node pair carried an edge in only one direction, the edge was emitted reversed and
unconditional, silently orphaning five nodes and one whole lookup path. Re-reading the code would not
have found it, and every validator in the chain accepted the payload. Report the check's result
alongside the payload; a clean result you can point at is worth more than an assurance.

## Model choice

Do not carry the source model across by name, and do not use any static table of compliant models.
`GET /v1/convai/llm/list` returns the models available to *that* workspace, filtered by the
deployment's data residency and the workspace's compliance entitlements. Call it, then hand the
choice to `architect-llm-selection`, which owns the region, HIPAA/PCI/ZRM and latency tradeoffs.

## Step 5 — prove it runs, before you tell anyone it is done

This is a step, not a formality at the end, and it is the difference between a migration that *looks*
finished and one that works. Every failure mode in `reference/traps.md` is silent: nothing rejects your
payload, the agent exists, the graph renders, and it is broken on the first real call. A migration
reported as complete without this has not been checked — it has been *hoped about*.

**The bar for "working" is five things, and all of them are observable:**

1. Every tool was created — no payload was rejected and quietly skipped.
2. The agent starts and delivers its first message.
3. Every dynamic variable a tool binds is actually supplied at conversation start.
4. At least one tool call executes and comes back successful.
5. At least one path reaches a terminal node.

Nothing there is about quality. A first migration should be judged on whether it runs at all; tuning
comes after, and confusing the two is how a broken agent gets shipped with a confident summary.

### Mock the tools for the first run, or you will transact against production

**Tool mocking defaults to off.** A simulation with default settings calls the customer's real
endpoints — so on the agent you just migrated, a smoke test books the appointment, charges the card,
and mutates the cart, for real. Nothing warns you.

So run it in two passes:

- **Pass 1 — everything mocked.** This is the cheap, side-effect-free run that proves the *graph* is
  alive: first message fires, variables resolve, edges route, a terminal node is reached. It catches
  the conversation-start binding trap outright — a variable a tool needs but nothing supplies fails the
  run with a `missing_dynamic_variables` error naming it, which is exactly the check that is
  impossible to pass by reading.
- **Pass 2 — read-only tools live, everything that mutates still mocked.** One real lookup is what
  proves auth actually works, and auth is the thing most likely to be silently wrong after a
  migration. Do not unmask a tool that books, pays, cancels, sends, or writes.

**Mocking everything is not the same as defining mocks, and the difference will waste your first run.**
When no mock matches a call the default is to raise, not to fall through to the real tool. That default
is the right one — an unmatched call is visible instead of quietly hitting production — but it means
"mock all" with no mock bodies makes every tool call fail, and you learn nothing about the graph. Give
each tool one mock with no parameter conditions, which makes it always match, and a `mock_result`
holding the minimal successful response shape that tool's consumers read. Where a response assignment
pulls a field out, the mock has to contain that field or the variable silently stays unset and you are
debugging the mock instead of the migration. A mock can also be marked as an error deliberately, which
is how you exercise a failure path once the happy one works.

`architect-mock-all-tools` owns the mocking setup and `architect-create-simulation-test` owns building
the run; route to them rather than hand-rolling. The current endpoints are
`POST /v1/convai/agent-testing/create` and `POST /v1/convai/agents/{agent_id}/run-tests` —
`simulate-conversation` still exists but is deprecated.

### Report what the run showed, not that you ran one

Give the five items above with their actual outcome, and name anything you could not verify. "Smoke
test passed" is not a result; "first message fired, three edges traversed, `fetch_profile` returned 200,
checkout still mocked and untested" is.

**Two rounds is the budget for fixing.** If a third would be needed, the failure is probably not a
conversion defect, and grinding on it is how a one-hour job becomes four. Stop fixing and work out
which of these it is: a success condition that does not match what the agent was asked to do, a mock
missing a field its consumer reads, or a real platform behaviour. Then say which, with the measurement,
and stop. **A behavioural gate that holds two runs in three is a finding, not a bug** — non-determinism
does not converge under repetition, so report the rate and what would make it absolute rather than
re-running until it looks better. Between rounds, re-run only what failed; run the whole suite once at
the end.

### The closing report

This is the artifact the migration is judged on, and its job is to leave someone confident enough to
move. Order matters more than content here — the same facts in the wrong order read as a warning.

1. **What it does, and what it became.** The phases and tools, and a before/after diagram of the source
   graph against the new shape. This goes first because it is the only section that says *I understood
   your agent*.
2. **That it runs.** The five checks with their outcomes.
3. **Mapped directly · Handled natively by ElevenLabs · Needs you.** Three groups, in that order. The
   middle one matters more than it looks: a construct the source built by hand that this platform does
   for you is a *win*, and filed as "difference" it reads as a loss. The third group is the only one
   that asks anything of them, and it should be short.
4. **Decisions and why.** Every judgement call you made that they might have made differently — one
   line each, with the reason and the alternative. A voice chosen as a placeholder, a model held at the
   source's for comparability, an environment resolved one way. This is what makes the migration
   reviewable rather than a black box, and it is the section people actually read.
5. **Not migrated, on purpose.** Everything net dropped: orphaned nodes nothing routed to, edges that
   led nowhere, tools referenced by nothing, constructs with no equivalent. Say why for each, in a
   clause. An unexplained absence is the thing that erodes trust later, when they go looking for a
   feature and cannot find it — and most of these were already dead in the source, which is worth
   stating plainly.
6. **The files, in one line each** — the audit findings, the mapping log, the gap list, the port.
7. **What to do next, and it is not a review.** If they have transcripts or recordings from the source
   platform, this is the moment they are worth the most: real scenarios replayed against the new agent
   find in an afternoon what invented ones will not find at all. Invite that. It is a better next step
   than any score, and it is the one that turns a migration into their agent.

Do not lead with a defect count, do not grade the agent, and do not attach a scorecard. The step 1b
findings live in a file with a pointer, and `agent-review` is step 6's business and gated there.

## Before you call it done

**These five can only be answered by running something.** Do not substitute a re-read of your own
config for any of them.

- **A mocked smoke run passed** — first message delivered, variables resolved, a terminal node reached.
- **One read-only tool executed live and succeeded**, so auth is proven rather than assumed.
- **No `missing_dynamic_variables` error**, the only real proof that every bound variable is supplied
  at conversation start.
- **Every tool was created**, counted against the source's tool list. A payload rejected and skipped
  leaves a graph routing to nothing.
- **The self-check over your emitted output ran and you are reporting its result** (step 4) — not the
  validator's, which passes payloads that are structurally wrong.

**Then the report, which is what the migration is actually judged on.**

- It leads with what the agent does and that it runs — not a defect count, not a score. The step 1b
  findings are in a file with a pointer, and `agent-review` was not handed over unasked.
- It says what was dropped and why, and what you decided and why.
- Only what genuinely blocked the conversion was put to the user as a question. One to three is normal;
  eleven means you moved the audit into the conversation.
- The mapping log and gap list exist and the user has them.
- Every credential you found is a secret reference and you said so — including any variable carrying
  both a static seed and a swapped token. You **ran** the scan rather than reasoning over the tool list.

**Then the silent failures — and check them against the files, not against a summary.** Re-open
`reference/traps.md` and `reference/expressions.md` and read what you emitted against them: headers,
tool URLs, conditions, transfer nodes, node-scoped attachments. This file used to restate that list,
which meant two copies to keep in sync, and they drifted. One instruction is safer than a duplicate.

Parity tests are the one item that is genuinely follow-up rather than part of a working migration. Say
so plainly instead of implying the agent is test-covered when it has had one smoke run, and point at the
customer's own transcripts, which is where real coverage comes from.

## Step 6 — hand off, because "runs" is not "good"

This skill's finish line is deliberately low: a conversion that runs. Say that plainly and name who
answers the next question, rather than leaving the user thinking a smoke test was a quality review.

**But do not hand a scorecard to someone who has just arrived.** `agent-review` is an operator's tool.
Pointed at a fresh migration it returns a page of structural findings that read as a verdict on the
decision to switch — and it lands right after the audit and the test results, which is three documents
in a row telling a new user their agent is broken. That sequence is how a migration gets abandoned at
the last step. So gate it: run it when the user asks, or once they have confirmed the agent does what
they need. Not by default, and not in the same breath as the report.

1. **`agent-review`** — scores prompt quality and workflow structure, which is the axis this skill
   defers on purpose. Right for an operator tuning an agent they already trust.
2. **`agent-simplification`** — acts on the structural findings. A faithful one-node-per-source-state
   port is exactly its input, and it proves behaviour is preserved with a ground-truth suite rather
   than asserting it.
3. **`architect-review-live-calls`** — once real traffic exists, finds what is actually failing in
   production. Nothing before this point can tell you that.

**When the review does run, it is scoring the rebuild, so a bad score is a real finding.** You already
made the structural calls `agent-simplification` would have made, which means a pile of structural
findings says the shape was wrong — not that the review is being unfair to a migration. Do not reach
for "it's a migration" to excuse a score you earned.

The exception is if someone points a review at the **port**. That is supposed to score badly: it
mirrors the source's topology because that is what fidelity means, and the findings are a backlog
rather than defects. Refactoring them away before anyone has confirmed the new agent matches the old
one destroys the only thing the port was for.

## Reference files, and when each one is due

Four files matter to any one migration, and three of them are not optional reading. The point of the
split is that each is short enough to actually read at the moment it applies, rather than skimmed as a
wall up front.

| File | Read it | What it holds |
|---|---|---|
| `reference/<platform>.md` | at step 1, once you know the platform | construct-by-construct mapping, the genuine gaps, export shape. Read only yours — you do not need the other two. |
| `reference/traps.md` | **before step 4**, and again while authoring each surface | every way a migrated agent breaks silently, grouped by whether you are authoring tools, nodes, or config |
| `reference/expressions.md` | **before you write any condition** | what can be expressed at all, why a carried-over condition inverts, and the guard builders to emit |
| `../../reference/` | **before you write the first payload** | a complete agent and a complete webhook tool, every field populated, plus the jq recipes for anything they do not show |

That last one is the plugin's shared example directory, not this skill's. Go there rather than
looking for a sample config in the working repo: the one you find may be stale, may be a scratch file
from another session, and in an install outside ElevenLabs does not exist at all. Read it as a field
catalogue — it shows where each field lives and what shape it takes. Do not start a migration by
copying it, or you ship a maximalist config whose settings nobody chose.

`traps.md` and `expressions.md` are ElevenLabs-side, so they apply whichever platform you came from.
If you are about to author a condition or a tool and have not read them, you are about to make one of
the mistakes in them — they exist because a real migration hit these with the mapping table open.
