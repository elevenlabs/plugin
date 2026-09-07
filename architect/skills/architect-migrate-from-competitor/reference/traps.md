# Import traps

These bite specifically because you are converting a foreign config, so no sibling skill covers them.
**Every one of them fails silently or misleadingly** — the payload is accepted, the graph renders, and
the agent is wrong on the first real call. That is why they are worth reading before you author rather
than after something breaks.

Grouped by what you are building when each one bites. Condition and edge semantics live in
`expressions.md` instead; read that one when you write conditions.

---

## Authoring tools

### A tenant id in a tool URL: use a path parameter, not the body

Source platforms interpolate variables straight into a tool URL —
`{{api_host}}/v2/{{account_id}}/customers`. ElevenLabs rejects `{{...}}` in a URL outright. The
instinct to move those values into the request body is wrong for a path segment, and following it
literally forces one hardcoded tool per tenant.

The right shape is a static host, a **single-brace** placeholder in the path, and a
`path_params_schema` keyed by the placeholder name:

```
url:                "https://api.example.com/v2/{account_id}/customers"
path_params_schema: {"account_id": {"type": "string", "dynamic_variable": "account_id"}}
```

Multi-tenancy is preserved and the tool stays single. Two things to get right:

- **The two params schemas are different shapes, next to each other.** `path_params_schema` is an
  object keyed by parameter name, and the keys must match the URL placeholders.
  `query_params_schema` is a single object with `properties` and `required`. Neither is an array of
  parameter objects. Passing the wrong one of the two is the `Input should be a valid dictionary`
  rejection.
- Each entry declares **exactly one** value source — `description`, `dynamic_variable`,
  `is_system_provided`, `constant_value`, or `is_omitted`. Setting two is rejected. **`description`
  is a member of that set**, which is the part that catches people: a parameter with a
  `constant_value` or a `dynamic_variable` may carry no description at all. That is the default
  mistake in a migration, because the source platform usually has both and copying the pair across
  looks like the careful thing to do. This applies to array `items` schemas too: a bare
  `items: {"type": "string"}` fails, because the items schema needs its own value source.
- **Response paths are dot notation. A carried-over JSONPath is rejected.** `reservation.status`, not
  `$.reservation.status`, in `assignments[].value_path` and in `response_filter.filters`. Sources
  commonly write the `$.` form, so this is a find-and-replace on every response mapping rather than a
  one-off.

### A tool parameter bound to a runtime variable fails at conversation start

Tool validation sees initiation variables and other tools' response assignments — but not the
placeholder set that prompt, first message and say nodes get. So a tool argument bound to a variable
populated later in the call fails at conversation start even though a placeholder is declared, and
nothing in the config shows the asymmetry.

**Declaring the placeholder is not the fix, and this is not a check you can pass by reading.** Do it
mechanically, before shipping:

1. List every tool parameter bound to a `dynamic_variable`.
2. Classify each source: an **initiation** variable, another tool's **response assignment**, or written
   **only** by an `update_state` node.
3. The third category is broken. Fix it — either promote the value to an initiation variable (often
   right when an upstream system already creates it), or populate it from a tool response assignment.

A single shared identifier bound across most of the tool set is the common shape here, so one missed
variable can take down nearly every tool call in the agent.

### Tool scoping is not a security boundary — or an ordering one

Attaching a tool to one procedure does not stop another from calling it: every tool referenced by
any attached procedure is in scope from the first turn. If the source relied on per-state tool
availability to gate a sensitive action — taking a payment, issuing a refund, releasing personal
data — that gate must be enforced by the tool's own endpoint against session state. Graph and
procedure structure route; they do not authorize.

**The same fact bites a second way, and this is the one that catches migrations.** A source flow that
collects details, reads them back, and only then writes is extremely common — bookings, orders,
cancellations. It is tempting to reproduce that with a deterministic procedure whose steps run in
order, and it does not work: the compiled step order governs the procedure's *progression*, not the
model's *access*. The write tool is in scope on every turn from the first, so the model calls it as
soon as it has plausible arguments — before the read-back. Making it deterministic does not help, and
removing the tool from the base set does not either, because a procedure that references a tool puts it
back in scope.

So **no agent configuration makes an irreversible action unreachable until a confirmation step.** The
gate is behavioural, held by three reinforcing pressures — a prompt section on irreversible actions,
preconditions written into the tool's own description, and the procedure's step order — and it holds
most of the time, not always. Measure it rather than assuming it, report the rate, and say plainly what
would make it absolute: the endpoint refusing a write that does not carry a token issued after the
read-back. That is a conversation to have with the customer during the migration, not after.

Do not spend rounds trying to configure your way out of this. One migration burned four fix rounds on
it and arrived at the same answer.

### Timeouts have two different ceilings

Configured ranges are `[5,120]` for webhook and code tools, `[1,120]` for client tools, and
`[5,300]` for MCP. But a code tool's sandbox refuses anything over **30 seconds** at execution time,
so a code tool configured at 60 is accepted by the API and then fails to run. Keep code tools within
`[5,30]`. Source platforms commonly default to a very long timeout; clamp rather than carrying it.

---

## Authoring nodes and graph shape

### A transfer node with no outgoing edge silently ends the call

A `phone_number` node is **not** terminal. It stops only when the transfer succeeds; when the
transfer fails it writes the outcome into `local::last_tool_dispatch_result_successful` and
re-evaluates its outgoing edges. Give every migrated transfer an outgoing edge so a failed transfer
has somewhere to go — the edge takes a `result` condition, so the fallback is deterministic rather
than an LLM judgment. Leaving it edgeless is what throws the failure path away.

The only genuinely terminal node type is `end`.

### `say` nodes silently ignore node-scoped tools and knowledge

`additional_tool_ids` and `additional_knowledge_base` exist on `say` nodes and the API accepts
writes to them, but only `override_agent` nodes actually apply them at runtime. If a source state
needs its own tools or its own documents, it must become an `override_agent` node.

### Appending versus replacing a node prompt

A node can either append to the base prompt or replace it. Porting a source state's prompt into the
replacing field discards the base personality, tone and guardrails with no error. Append is almost
always what a converted per-state prompt wants. `agent-review` and `agent-simplification` both call
this the single most common mistake on a node; confirm which field you are writing before you write.

### A source "global" node becomes reachable from every turn, and the model decides

Lowering an always-available source node onto a triggered procedure puts its trigger in a menu that
is re-injected into the system prompt **every turn**, and there is no per-node scoping to narrow it
afterwards — a node cannot restrict which procedures are offered the way it can restrict tools.

**But it does not take precedence over your graph, and the difference matters.** Activation is the
model calling a `start_procedure` system tool with the index it picked out of that menu; nothing
preempts the authored path automatically. So the property to design against is not "this outranks my
edges", it is "at every single turn the model *may* leave the path I authored, and whether it does is
not deterministic".

That is the harder version to test. A conversion that reasons "the verification node runs first
because it comes first" will pass every scripted run and still be bypassed in production, because the
bypass depends on what the caller says. If a step must happen before an irreversible action, the
guarantee has to live at the endpoint — see the tool-scoping trap above; graph position and step
ordering both fail here for the same reason.

Where the global node only transfers or hangs up, prefer the corresponding system tool plus a line in
the prompt.

### Folding a source branch node into its predecessor's edges

A dedicated branch/router node usually has no ElevenLabs counterpart — its logic belongs on the edges
leaving the node before it. Two mechanics make this possible, and neither is obvious:

- **Judgment and determinism mix in one condition.** The expression AST has an `llm` node type, so a
  single condition can conjoin a model judgment with a deterministic variable test. This is what makes
  folding viable at all rather than forcing a choice between the two.
- **A tool's success/failure is available as a variable.** A `result` condition is itself sugar over a
  comparison against the last tool dispatch result, which the runtime writes after every tool node. So
  a branch sitting downstream of a tool call can fold too — conjoin that comparison with the rest of
  the logic. It fails closed: on a node with no preceding tool node the fold never fires.

**When not to fold.** Because there is no `not` operator, splitting one source branch into two paired
edges means hand-writing the negation and keeping two copies in sync, and any LLM judgment inside gets
evaluated twice per turn. Count before committing: saving eight nodes at the price of a dozen
hand-negated conditions is usually the worse trade. Keeping the router as a silent `update_state` node
with no updates is a legitimate outcome — it advances without an LLM turn and the routing stays in one
place. Fold where it simplifies; keep the router where it does not.

---

## Agent-level config

### Deletion flags are silently switched off unless you set a retention window

Privacy config has a trap with the same shape as the transcriber one, and it fails in the direction
that keeps data. If `retention_days` is `-1` **or simply omitted**, then `delete_transcript_and_pii`
and `delete_audio` are forced to `false` before the payload is validated. No error is returned, and a
later read shows `false` exactly as though you had chosen it.

So lowering a source setting that means "keep everything except PII" into `delete_transcript_and_pii:
true` **and nothing else** silently retains the PII. Set a real `retention_days` in the same payload,
and re-read the saved config to confirm both fields survived. The validation error you might expect to
catch this is unreachable — the coercion runs first.

`zero_retention_mode` is the separate, stricter option: it requires `record_voice: false` and
`retention_days: -1`. Do not reach for it as a shortcut to "delete the PII" — it is a different
setting with different consequences, and it is the customer's decision, not a conversion detail.

### Other silent rewrites and caps

- An `update_state` node writes at most **10** updates. Split a larger source state-write block.
- **Procedures are silently dropped from an agent-create payload.** Pass them and the call returns 200
  with an empty procedure list. They must be created through the branch-scoped flow that
  `architect-manage-procedures` owns — route there rather than inlining it, because every source global
  node lands on a procedure.
- Post-call field extraction has no enum type — the types are boolean, string, integer and number. A
  source field with a fixed choice list has to fold those choices into its description.
- EL enforces catch-all-last by moving unconditional edges to the end of the edge order, so you only
  need to order the *conditional* edges.
- The default turn model triggers a validator that rewrites the transcriber choice. Reading the value
  back proves nothing — the rewritten value appears exactly as though you had chosen it. **Set the
  transcriber explicitly** rather than verifying by reading.
- Capturing something the caller said into a variable mid-call is done with an `update_state` node
  plus an LLM extraction expression. This is feature-flagged — confirm availability before designing
  around it.
