#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = MAX_TIMEOUT_MS;
const __dirname = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error(
    "Usage: node local-executor.mjs <tool-file.mjs> [ctx.json] [--timeout=<ms>]\n" +
      "  <tool-file.mjs>  Path to a module with `export default async (ctx) => {...}`\n" +
      "  [ctx.json]       Path to a ctx fixture (default: ctx.example.json next to this script)\n" +
      "  --timeout=<ms>   Override the tool timeout (default: 30000; must be 1000–30000 to match production)",
  );
}

function parseTimeoutMs(raw) {
  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `--timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (1–30s production range), got: ${raw}`,
    );
  }
  return timeoutMs;
}

async function loadCtx(ctxPath) {
  const raw = await readFile(ctxPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    args: parsed.args ?? {},
    secrets: parsed.secrets ?? {},
    config: parsed.config ?? {},
    auth_connections: parsed.auth_connections ?? {},
  };
}

// Route every fetch through the timeout controller so a timeout actually
// cancels in-flight requests. `AbortSignal.any` keeps a caller-supplied
// signal working — including one that is already aborted, which a plain
// "abort" listener would miss.
function patchFetchWithAbort(controller) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const signal = init.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal;
    return originalFetch(input, { ...init, signal });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function withTimeout(promise, ms, controller) {
  let timer;
  // Always settle to a value so an abort (or any late tool failure) after the
  // timeout wins cannot surface as an unhandled rejection.
  const settled = promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `Timed out after ${ms}ms (production tool timeout is 1-30s). In-flight requests were aborted, ` +
            `but any already delivered to the server may still have taken effect.`,
        ),
      );
    }, ms);
  });
  try {
    const result = await Promise.race([settled, timeout]);
    if (result.ok) return result.value;
    throw result.error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const positional = [];
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (const arg of process.argv.slice(2)) {
    const timeoutMatch = arg.match(/^--timeout=(\d+)$/);
    if (timeoutMatch) {
      timeoutMs = parseTimeoutMs(timeoutMatch[1]);
    } else if (arg.startsWith("--timeout=")) {
      throw new Error(
        `--timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (1–30s production range), got: ${arg.slice("--timeout=".length)}`,
      );
    } else {
      positional.push(arg);
    }
  }

  const [toolPath, ctxPath = resolve(__dirname, "ctx.example.json")] = positional;
  if (!toolPath) {
    usage();
    process.exit(1);
  }

  const ctx = await loadCtx(resolve(ctxPath));
  const module = await import(pathToFileURL(resolve(toolPath)).href);
  const toolFn = module.default;
  if (typeof toolFn !== "function") {
    throw new Error(`${toolPath} has no \`export default async (ctx) => ...\` function`);
  }

  const controller = new AbortController();
  const restoreFetch = patchFetchWithAbort(controller);
  try {
    const result = await withTimeout(toolFn(ctx), timeoutMs, controller);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    restoreFetch();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
