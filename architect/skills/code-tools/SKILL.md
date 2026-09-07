---
name: code-tools
description: "Generate JavaScript/TypeScript modules for ElevenLabs code tools — sandbox tools that export a default async (ctx) => function, call APIs via fetch with ctx.secrets / ctx.config / ctx.auth_connections, and return a minimized result to the agent. Use when the user says 'write a code tool', 'code tools', 'ElevenLabs code tool', 'create a code tool', 'egress with auth connection', 'code tool allowed domains', 'X-With-Auth-Connection', or pastes a brief for custom JS/TS tool logic that should run on ElevenLabs infrastructure."
---

# ElevenLabs Code Tools

Generate paste-ready JS/TS for ElevenLabs **code tools**: custom logic that runs on ElevenLabs infrastructure, not a customer webhook.

## Canonical runtime model

Your code is a single JavaScript/TypeScript module that exports one default async function. It receives a `ctx` object and returns the tool result (same downstream uses as a server tool response: agent, transcript, dynamic variables).

```ts
export default async (ctx) => {
  const { city } = ctx.args;
  return { message: `Hello from ${city}!` };
};
```

Helpers and top-level variables outside the default export are fine.

### `ctx` API (use these names only)

| Property | Description |
|---|---|
| `ctx.args.<paramName>` | Tool-call parameters from the LLM, already typed (string, number, boolean, object). |
| `ctx.secrets.<NAME>` | Workspace secret mapped into this tool's Context object. |
| `ctx.config.<NAME>` | Plain string env/config value mapped into Context. |
| `ctx.auth_connections.<NAME>` | Auth-connection reference. Pass as the `X-With-Auth-Connection` header on outbound `fetch`; ElevenLabs attaches the credential — the raw secret never enters your code. |

Which secrets, auth connections, and config values appear under `ctx` (and under what name) is configured in the tool's **Context object** section in the studio — same idea as headers/params on a webhook tool.

### Naming gotchas (do not emit)

| Wrong | Right |
|---|---|
| `ctx.pargs` | `ctx.args` |
| `ctx.authConnections` | `ctx.auth_connections` |

### Hard constraints

- **No npm packages.** Built-in JavaScript + Web APIs only (`fetch`, `Promise`, `setTimeout`, `JSON`, `URL`, `encodeURIComponent`, etc.). No `import` from external packages.
- **Network allowlist.** Outbound requests only succeed for domains listed under the agent's **General Settings → Code tool allowed domains** (wildcards like `*.example.com` OK). Only workspace **admins** can add domains — flag that if the user is not an admin.
- **Timeout.** Each run must finish within the tool's response timeout (**1–30 seconds**). Cap any poll loops so total wait fits under that budget.
- **Return value = LLM context.** Everything you return is read by the model. Project to the few fields the agent needs — never dump full DB rows, internal notes, risk scores, audit logs, or other PII/internal fields.
- **Auth.** API keys → `ctx.secrets`. Plain URLs/base strings → `ctx.config`. OAuth / managed credentials → `ctx.auth_connections` + `"X-With-Auth-Connection"` header. Never hardcode secrets or put raw OAuth tokens in code.
- **Errors.** Both a structured return and a throw "work" — the difference is control. A structured `{ error: "..." }` return is always visible to the agent; `throw new Error(...)` lets you decide whether the failure reason surfaces to the LLM at all. Prefer structured returns for expected failures (not found, bad input); throw for unexpected upstream failures where a loud transcript failure helps debugging. Either way, try/catch and return or throw something meaningful. Best-effort side effects (logging) should swallow errors so they never break the tool.

## Intake

Ask only for what's missing:

1. **Tool name** + one-line purpose
2. **Parameters** (name, type, description) the LLM will fill → become `ctx.args`
3. **Upstream APIs / domains** to call
4. **Auth style** — secret vs auth connection vs plain config — and suggested Context object names
5. **Return shape** — fields the agent should see

If the brief is already complete, skip questions and generate.

## Output template (always)

Produce all six sections every time:

### 1. Code

Complete default-export module ready to paste into the studio code editor.

### 2. Parameters

Table for Setup params UI:

| Name | Type | Description |
|---|---|---|
| … | string / number / boolean / … | … |

### 3. Context object mapping

| `ctx` path | Kind | Maps to |
|---|---|---|
| `ctx.secrets.EXAMPLE_API_KEY` | secret | workspace secret … |
| `ctx.config.SUPABASE_URL` | value | literal / config string … |
| `ctx.auth_connections.EXAMPLE_CRM` | auth connection | configured connection … |

### 4. Allowed domains checklist

Exact hostnames or wildcards an admin must add under **General Settings → Code tool allowed domains**. Call out that only admins can edit this list.

### 5. Run-in-editor test plan

- Sample **Params** values
- Expected **Output**
- Optional: `console.log(ctx)` / specific fields if debugging

### 6. Agent-facing notes

One short tool description / trigger guidance for when the LLM should call this tool.

## Generation patterns

Keep recipes short here; full sources live in [examples.md](examples.md). Read that file when implementing a matching pattern.

1. **Field-minimizing REST lookup** — fetch a rich row; return only agent-safe fields.
2. **Parallel fan-out** — independent calls via `Promise.all`.
3. **Bounded poll / long-running job** — start work, poll with capped attempts + delay; return `still_*` + id if not done.
4. **Best-effort side-effect via auth connection** — `X-With-Auth-Connection`; try/catch so logging never fails the tool.
5. **Secret-based API key call** — `Authorization` / `apikey` from `ctx.secrets`.

## Anti-patterns (reject or fix)

- Returning entire upstream JSON blobs — return only the fields strictly necessary for the agent; if it's genuinely unclear which fields matter, returning the rest of the object is fine (sometimes that's the intended behavior), but PII/internal fields (notes, risk scores, audit logs) still must never be returned, per the hard constraint above
- Hardcoding secrets or base URLs that belong in Context
- Calling domains without listing them in the Allowed domains checklist
- Polling without attempt/time caps relative to the 30s ceiling
- Putting real OAuth tokens in code instead of `X-With-Auth-Connection`
- Adding npm `import`s
- Using `ctx.pargs` or `ctx.authConnections`

## Minimal egress example (secret)

```ts
export default async (ctx) => {
  const orderId = String(ctx.args?.order_id ?? "").trim();
  if (!orderId) return { error: "order_id is required" };

  const response = await fetch(
    `https://api.example.com/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        Authorization: `Bearer ${ctx.secrets.EXAMPLE_API_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Upstream error: ${response.status}`);
  }

  const order = await response.json();
  return { orderId: order.id, status: order.status };
};
```

Map `EXAMPLE_API_KEY` in Context; allowlist `api.example.com`. Return only the fields the agent needs.

## Minimal OAuth / auth-connection example

```ts
export default async (ctx) => {
  const customerId = String(ctx.args?.customer_id ?? "").trim();
  if (!customerId) return { error: "customer_id is required" };

  const response = await fetch(
    `https://api.example.com/customers/${encodeURIComponent(customerId)}`,
    {
      headers: {
        "X-With-Auth-Connection": ctx.auth_connections.EXAMPLE_CRM,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Upstream error: ${response.status}`);
  }

  const customer = await response.json();
  return { customerId: customer.id, name: customer.name };
};
```

Map `EXAMPLE_CRM` to a configured auth connection in Context. Return only the fields the agent needs.

## Testing reminder

Before saving in the studio, use **Run** in the code editor:

- **Params** — test values for each defined parameter
- **Output** — returned result or error
- **Logs** — `console.log` / `warn` / `error`, plus build and execution timing

Optional pre-studio check: `node local-executor.mjs <tool-file> <ctx.json>` (see [README.md](README.md#run-locally-before-pasting-into-the-studio)) runs the module locally against a mocked `ctx`, enforcing the same 1–30s timeout.
