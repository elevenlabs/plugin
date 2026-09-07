# Writing expression conditions safely

This file is ElevenLabs-side, so it applies to a migration from any source platform.

This is the whole authority on conditions and edges: what can be expressed, why a carried-over
condition silently inverts, and the shapes to emit so you compose guards rather than re-derive them on
every edge. On a graph with a few hundred edges, hand-writing each condition is where the silent
inversions get in. Read it before you author any condition, not after one misbehaves.

## Two ways an expression fails to be an expression

Get these wrong first and everything below is unreachable. Both are worth knowing before you write a
single condition, because one wastes a lot of time and the other does not fail at all.

**An expression is a structured object, never a string.** Passing the condition as text — even
perfectly formed text — is rejected with `Input should be a valid dictionary or object to extract
fields from`. That message does not mention expressions, strings, or which field was wrong, so it is
easy to read as a problem with the enclosing payload and start bisecting the wrong thing. In one real
migration this single error was hit fourteen times. If you see it, check that every `expression` value
is an object.

**An empty expression is not an empty condition.** `expression: {}` is accepted and silently
normalises to `boolean_literal` false, so the edge never fires and nothing reports a problem. Any code
path that can emit an absent or empty condition object produces a dead edge that looks authored.

While you are here: an **LLM** condition carries its text in `condition`. A `label` field also exists
on conditions and is *not* the condition — it is a display name. Setting only `label` gives you an
edge with no condition, which is the same silent dead end as the empty expression.

## What you can express at all, and what inverts

Read this before writing a single condition: the first part decides whether a source condition can be
translated, and the next two are why a translated one silently does the opposite of what it says.

### Most source operators have no ElevenLabs equivalent at all

Before worrying about how a condition behaves, check whether it can be expressed. The complete
expression operator set is: `or`, `and`, `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `add`, `sub`, `mul`,
`div`, `conditional`. That is all of it.

So there is **no `contains`**, no `not_contains`, no `exists`, no `not_exists`, and **no `not`**.

- `contains` / `not_contains` — no mechanical translation exists. Each one is a **semantic rewrite**,
  usually into an LLM condition describing the intent. In real exports these are common, often the
  majority of a graph's equations, so budget for it: this is hand work per condition, not a pass you
  can automate.
- `exists` / `not_exists` — express as a comparison against `null_literal`. `x neq null` is true
  exactly when the variable is populated, because null-vs-null takes the equal-types path.
- **No `not` operator.** Negation must be written out by hand — an `and` of negated leaves rather than
  a negation of the `and`. This matters most when you split one source branch into two paired edges:
  you are maintaining a De Morgan negation by hand, and the two copies drift.

### Equality conditions invert when a variable is absent or differently typed

EL's equality operators short-circuit on a **type** mismatch before comparing values. An absent
dynamic variable resolves to null, so against a string literal:

- `eq` returns **false** — the edge never fires.
- `neq` returns **true** — the edge fires on no data at all.

The same happens for a *populated* variable whose runtime value is a boolean or number while the
condition compares against a string, which is the normal case when the source exported its
comparison values as JSON strings. So a gate meaning "if plan is not free, take the premium path"
opens for every call whose variable failed to populate.

When lowering a source equality test, guard it:

- For a value that could arrive as a bool or number, accept both typings:
  `(flag eq "true") or (flag eq true)`.
- For any `neq`, prefix a null guard: `(plan neq null) and (plan neq "free")`. Null-vs-null takes the
  equal-types path, so the guard is false exactly when the variable is missing.

Both guards are below as composable builders — use those rather than hand-writing each condition.

### Numeric comparisons do not mis-route, they end the turn

`gt`, `lt`, `gte` and `lte` coerce through a numeric conversion that **raises** — both for a string
and for an absent variable. Source platforms overwhelmingly export variable defaults as strings, so
a threshold gate carried across mechanically is an outage rather than a wrong branch. Convert the
value at its source (a tool response assignment, or an `update_state` write) so the variable holds a
real number before any comparison reads it.

## The node types

An expression condition is a tree of typed nodes. Leaves name a variable or carry a literal:

```js
const V    = (name)  => ({ type: 'dynamic_variable', name });
const S    = (value) => ({ type: 'string_literal',   value });
const N    = (value) => ({ type: 'number_literal',   value });
const B    = (value) => ({ type: 'boolean_literal',  value });
const NULL = ()      => ({ type: 'null_literal' });

const eq  = (left, right) => ({ type: 'eq_operator',  left, right });
const neq = (left, right) => ({ type: 'neq_operator', left, right });
const or  = (...children) => ({ type: 'or_operator',  children });
const and = (...children) => ({ type: 'and_operator', children });
```

Note the shape difference: comparisons take `left`/`right`, boolean combinators take a `children`
array. `gt`, `lt`, `gte`, `lte` follow the comparison shape.

## The four guards

Each of these exists because the naive lowering is wrong in a way that does not announce itself.

```js
// A source `== "true"` (or `contains "true"`) against a value that arrives as a real boolean.
// Equality short-circuits on a TYPE mismatch before comparing values, so accept both typings.
const boolGuard = (name, want = true) =>
  or(eq(V(name), B(want)), eq(V(name), S(String(want))));

// A source `== "1"` against a value that may arrive as a number. Same reason.
const numOrStrGuard = (name, value) =>
  or(eq(V(name), N(value)), eq(V(name), S(String(value))));

// Any inequality. A bare `neq` is TRUE when the variable is ABSENT, which inverts the gate on
// missing data. Null-vs-null takes the equal-types path, so this is false exactly when unpopulated.
const neqGuard = (name, value) =>
  and(neq(V(name), NULL()), neq(V(name), S(value)));

// No `exists` operator exists, so a null-or-empty-or-sentinel test becomes an explicit disjunction.
const isBlank = (name, ...sentinels) =>
  or(eq(V(name), NULL()), eq(V(name), S('')), ...sentinels.map((s) => eq(V(name), S(s))));
```

`neqGuard` is the one to apply without exception. An unguarded inequality is the single most common
way a migrated graph routes calls down a path the source never would have — and it only fires when a
variable fails to populate, so it survives every happy-path test.

Negation has no operator, so `neqGuard` is also the only way to express "not this". When you need to
negate a conjunction, write the De Morgan expansion by hand and keep the two edges of a split branch
next to each other in your working notes; they drift otherwise.

## Make the guards unnecessary where you can

A guard accommodates a type you do not control. Better, where the variable's value originates in a
tool response or an `update_state` write, is to fix the type at the source:

- On a response assignment, set `preserve_native_type: true` so a JSON boolean or number stays one.
  Then `boolGuard`'s native arm is the arm that matches, rather than relying on stringification.
- For any variable a numeric comparison will read, make it a real number **before** the comparison
  exists. `gt`/`lt`/`gte`/`lte` raise on a string and on an absent variable — that ends the turn
  rather than mis-routing, so there is no guard shape that rescues it.

A guard is also worthless if the assignment feeding it never resolves, and a response `value_path`
carried over from another platform usually does not. Two rewrites are mechanical:

- **Array indexing is dotted.** `items[0].id` must be written `items.0.id`. A bracketed path does not
  resolve, so the variable stays unset and every condition reading it takes the absent-variable path.
- **The response envelope has to be included.** A path written against the bare payload needs whatever
  prefix the API actually returns — for a GraphQL endpoint that is `data.`. A source platform that
  strips or renames the envelope leaves you a path that is valid on the old platform and inert here.

Check each assignment against a real response body rather than against the source's path. These fail
silently: an unresolvable path is indistinguishable at runtime from an API that returned nothing.

## Filling tool parameters from variables

Related trap, same origin. Source platforms often encode "fill this parameter from a variable" by
putting the template text in the parameter's *description*. Carried across literally, that asks the
model to invent a value from a template string.

A property may declare **exactly one** value source. So a description that is purely `{{some_var}}`
becomes a `dynamic_variable` binding and drops the description entirely:

```js
const PURE_VAR = /^\s*\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}\s*$/;

function leafProp(desc, type = 'string') {
  const m = (desc || '').match(PURE_VAR);
  if (m) return { type, dynamic_variable: m[1] };      // bound, no description
  const d = (desc || '').trim();
  if (!d) return null;                                  // zero sources is invalid — handle upstream
  return { type, description: d };                      // genuine guidance, LLM-filled
}
```

Mixed text that merely mentions a variable stays an LLM-filled property — the prose is real guidance.
Only a description that is *nothing but* a binding gets converted.

## Refuse to emit a credential

Before writing any payload, assert the source's literal credential is absent from it. Source exports
frequently carry a token in two places at once — a variable default *and* an example header pasted
into prompt text — and the prompt copy is the one that gets missed:

```js
function assertClean(payload, seedToken) {
  if (!seedToken) return;
  if (JSON.stringify(payload).includes(seedToken)) {
    throw new Error('REFUSING TO EMIT: credential present in payload');
  }
}
```

Keep an `Authorization` header as a **reference**, not a resolved literal. Where the token is
legitimately swapped mid-call, flattening it to whatever value was present at migration time pins
every later request to the bootstrap credential, silently and permanently.

Use the typed locator, never a template string: **a header string is transmitted verbatim**, so
`Basic {{vault_token}}` sends those literal characters and authenticates nothing. Write
`{"variable_name": "vault_token"}` for a dynamic variable or `{"secret_id": "<id>"}` for a workspace
secret. A locator supplies the whole header value, so a scheme word like `Basic ` lives inside the
value — create the secret holding `Basic <token>` rather than trying to prefix the locator. See
`SKILL.md` step 2.
