#!/usr/bin/env node
/**
 * Generate and check the reference examples against ElevenLabs' live OpenAPI spec.
 *
 * Why this exists: with no canonical example committed, a run looking for "what does a complete
 * agent config look like" goes and finds one — a sample in whatever repo is on disk, or a scratch
 * file from an earlier session. That is non-deterministic, it can be stale, and in a public install
 * there is nothing to find at all. So the shape lives here.
 *
 * The examples are curated on purpose (real-looking values, sensible combinations), which means they
 * can rot. This script is the thing that stops that happening quietly:
 *
 *     node check-examples.mjs --check              # every committed example against the live spec
 *     node check-examples.mjs --emit agent         # regenerate a skeleton when the API has moved
 *
 * The spec is deliberately NOT vendored. Its whole value is being current; a committed copy would be
 * a second source of truth that drifts, and a stale spec is worse than none because a missing field
 * reads as a field that does not exist.
 *
 * WHAT --check CANNOT DO, stated up front because it read as more than it is: this walks a JSON
 * schema, so it sees fields, types, enums and required-ness, and it is blind to every validator on
 * the models behind the schema. When these examples were first validated against the real request
 * models they were rejected with seven errors; this script catches one of the seven. The rest were a
 * numeric range, an `llm`/`reasoning_effort` pairing, a string-format rule and one mutual-exclusion
 * rule hit three times — none expressible here. Treat a green run as "the fields exist and have the
 * right types", never as "the API will accept this".
 *
 * Read-only, unauthenticated, no API key: the only network call is a GET of the public spec.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_URL = "https://api.elevenlabs.io/openapi.json";
const REFERENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "reference");

// Example file -> the schema it claims to be an instance of.
const EXAMPLES = {
  "example-agent.json": "Body_Create_Agent_v1_convai_agents_create_post",
  "example-webhook-tool.json": "WebhookToolConfig-Input",
};

// Pure presentation, ~50 fields, and irrelevant to building or migrating an agent. Excluded from the
// example on purpose so the file stays readable; excluded from the check so its absence is not drift.
const SKIP_KEYS = new Set(["widget"]);

// Deep enough to reach a webhook tool's api_schema, which sits five levels down and is the single
// most useful thing in the file. Cycles are caught by the stack guard, not by this.
const MAX_DEPTH = 10;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

async function fetchSpec(url = SPEC_URL) {
  // Bounded rather than open-ended: a hung fetch in CI is a job that never fails, which reads as a
  // pass. Matches the 30s the Python version used.
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

/** Follow $ref one hop at a time. The spec nests refs, so callers loop until stable. */
function deref(node, schemas) {
  let seen = 0;
  while (isObject(node) && "$ref" in node && seen < 20) {
    node = schemas[node.$ref.split("/").pop()] ?? {};
    seen += 1;
  }
  return isObject(node) ? node : {};
}

/** anyOf/oneOf: take the first variant that is not the null branch. */
function pickVariant(node, schemas) {
  for (const key of ["anyOf", "oneOf"]) {
    for (const variant of node[key] ?? []) {
      const resolved = deref(variant, schemas);
      if (resolved.type !== "null") return resolved;
    }
  }
  return node;
}

/** Key-sorted JSON, so the cycle marker below is stable across runs. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    const body = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Build a plausible instance of one schema node. Values are placeholders, shapes are real. */
function exampleFor(node, schemas, depth = 0, stack = new Set()) {
  node = deref(node, schemas);
  if (node.anyOf || node.oneOf) node = pickVariant(node, schemas);
  if ("default" in node) return node.default;
  if (node.enum?.length) return node.enum[0];

  const t = node.type;
  if (t === "object" || "properties" in node) {
    if (depth >= MAX_DEPTH) return {};
    const out = {};
    for (const [key, sub] of Object.entries(node.properties ?? {})) {
      if (SKIP_KEYS.has(key)) continue;
      const marker = `${key}:${stableStringify(sub).slice(0, 60)}`;
      if (stack.has(marker)) continue; // cycle: a node type that contains itself
      out[key] = exampleFor(sub, schemas, depth + 1, new Set(stack).add(marker));
    }
    const extra = node.additionalProperties;
    if (isObject(extra) && Object.keys(out).length === 0) {
      out["<key>"] = exampleFor(extra, schemas, depth + 1, stack);
    }
    return out;
  }
  if (t === "array") {
    const items = node.items;
    return items ? [exampleFor(items, schemas, depth + 1, stack)] : [];
  }
  if (t === "integer") return 0;
  // JSON has one number type in JS, so a spec default of 8.0 emits as 8. Cosmetic, and only in
  // --emit output: the checker treats an integer as a valid "number".
  if (t === "number") return 0;
  if (t === "boolean") return false;
  if (t === "null") return null;
  return "";
}

/** Report keys the schema does not declare, and values whose type contradicts it. */
function check(instance, node, schemas, path = "") {
  node = deref(node, schemas);

  if (node.anyOf || node.oneOf) {
    const variants = (node.anyOf ?? node.oneOf).map((v) => deref(v, schemas));
    // Permissive by design: a union passes if any branch accepts it. Reporting every branch's
    // complaint would bury the real drift in noise.
    let best = null;
    for (const v of variants) {
      if (v.type === "null" && instance === null) return [];
      const errs = check(instance, v, schemas, path);
      if (errs.length === 0) return [];
      if (best === null || errs.length < best.length) best = errs;
    }
    return best ?? [];
  }

  const t = node.type;
  const where = path || "<root>";

  if (isObject(instance) && (t === "object" || "properties" in node)) {
    const props = node.properties ?? {};
    const ap = node.additionalProperties;
    const extraOk = ap !== false && (Object.keys(props).length === 0 || Boolean(ap));
    const errs = [];
    for (const [key, value] of Object.entries(instance)) {
      if (key in props) {
        errs.push(...check(value, props[key], schemas, path ? `${path}.${key}` : key));
      } else if (!extraOk) {
        errs.push(`${where}: '${key}' is not a field the schema declares`);
      }
    }
    // `required` was not checked at all until an example was validated against the real request
    // models and rejected — a check that only inspects the keys that ARE present cannot tell a
    // complete payload from a truncated one.
    for (const key of node.required ?? []) {
      if (!(key in instance) && !SKIP_KEYS.has(key)) {
        errs.push(`${where}: required field '${key}' is missing`);
      }
    }
    return errs;
  }

  if (Array.isArray(instance) && t === "array") {
    return instance.length && node.items ? check(instance[0], node.items, schemas, `${path}[0]`) : [];
  }

  if (node.enum?.length && !node.enum.includes(instance)) {
    return [`${where}: ${JSON.stringify(instance)} is not one of ${JSON.stringify(node.enum)}`];
  }

  // A null branch accepts ONLY null. Without this, `t === "null"` fell through to the checks below,
  // matched nothing, and returned no errors — so the null half of every `anyOf: [X, null]` accepted
  // any value at all, and most interesting fields are nullable. That is how
  // `response_filter: "hide_all"` passed while the schema wanted a ResponseFilter object.
  if (t === "null") {
    return instance === null ? [] : [`${where}: is ${typeName(instance)}, schema says null`];
  }

  const ok = {
    string: (v) => typeof v === "string",
    integer: (v) => Number.isInteger(v),
    number: (v) => typeof v === "number",
    boolean: (v) => typeof v === "boolean",
    object: isObject,
    array: Array.isArray,
  }[t ?? ""];
  if (ok && !ok(instance)) {
    return [`${where}: is ${typeName(instance)}, schema says ${t}`];
  }
  return [];
}

function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function usage() {
  console.error(
    "Usage: node check-examples.mjs [--check | --emit <name>]\n" +
      "  --check          validate committed examples against the live spec (default)\n" +
      "  --emit <name>    print a fresh skeleton: agent | webhook-tool",
  );
}

async function main(args) {
  let emit = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--check") continue;
    if (args[i] === "--emit") {
      emit = args[i + 1];
      i += 1;
      if (!emit) {
        usage();
        return 2;
      }
      continue;
    }
    usage();
    return 2;
  }

  let schemas;
  try {
    schemas = (await fetchSpec()).components.schemas;
  } catch (err) {
    console.error(`could not fetch ${SPEC_URL}: ${err.message}`);
    return 2;
  }

  if (emit) {
    const stem = emit.replace(/^example-/, "").replace(/\.json$/, "");
    const name = `example-${stem}.json`;
    const schemaName = EXAMPLES[name];
    if (!schemaName) {
      console.error(`unknown example '${emit}'; know: ${Object.keys(EXAMPLES).sort().join(", ")}`);
      return 2;
    }
    const skeleton = exampleFor({ $ref: `#/components/schemas/${schemaName}` }, schemas);
    console.log(JSON.stringify(skeleton, null, 2));
    return 0;
  }

  let failed = false;
  for (const [filename, schemaName] of Object.entries(EXAMPLES).sort()) {
    const path = join(REFERENCE, filename);
    let payload;
    try {
      payload = JSON.parse(await readFile(path, "utf8"));
    } catch {
      console.log(`MISSING  ${filename}`);
      failed = true;
      continue;
    }
    if (!(schemaName in schemas)) {
      console.log(`DRIFT    ${filename}: schema '${schemaName}' no longer exists in the spec`);
      failed = true;
      continue;
    }
    const errors = check(payload, { $ref: `#/components/schemas/${schemaName}` }, schemas);
    if (errors.length) {
      failed = true;
      console.log(`DRIFT    ${filename} (${errors.length}) vs ${schemaName}`);
      for (const e of errors.slice(0, 40)) console.log(`           - ${e}`);
    } else {
      console.log(`ok       ${filename} vs ${schemaName}`);
    }
  }

  if (failed) {
    console.error(
      "\nThe examples are curated, so drift means one of two things: the API moved and the file " +
        "needs updating (`--emit` gives a fresh skeleton), or the file was edited into a shape the " +
        "API does not accept. Do not silence this by deleting the field.",
    );
  }
  return failed ? 1 : 0;
}

process.exit(await main(process.argv.slice(2)));
