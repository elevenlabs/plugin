---
name: architect-explain-test-runs
description: Use when the user asks why a test or test run passed or failed, why one run in a repeat set differs, which procedures or tools were used during a run, or wants a summary of test suite history. Fires on "why did 1 of the 3 runs fail", "why is this test failing", "which procedures were used in that run", "explain this simulation test result", or "summarize my test suite history".
---

# Explain why a test run passed or failed

The user wants for a test run what they already get for a conversation: which procedures fired, which tools were called, and what actually happened turn by turn. Read the test invocation, find the divergence, and answer with it.

Host `https://api.elevenlabs.io`, header `xi-api-key: $API_KEY`. The engineer supplies `$API_KEY` and `$AGENT_ID`.

## Order of investigation

1. **List recent runs.** Fetch recent suite invocations, optionally filtered by agent, to find the invocation in question and to compare runs across time. To surface "frequent offenders", compare recent invocations and identify which specific tests fail repeatedly; those need fixing most.
2. **Read the invocation.** `GET /v1/convai/test-invocations/{suite_id}` returns `test_runs[]`, each with `status`, `condition_result.result`, and `condition_result.rationale`. The rationale per run is often specific enough on its own. For most "why did X fail" questions this is enough; stop here if the rationale already names the divergence.
3. **Read the full transcript only when the rationale is too vague.** The invocation also carries the turn-by-turn transcript per run: messages, tool calls (including the procedure-start calls, so you can see which procedures fired), and tool errors. This is what answers "why did it fail" or "which procedures ran in each pass and fail run". On a suite with many tests and a `repeat_count` above 1, this payload can be large enough to overflow context. Check the test and run count first; if it covers more than a handful of tests or repeats, do not dump the full detail. Instead tell the user the suite is too large and offer to (a) look at just the failing test's rationale, or (b) point them to the Tests tab in the UI.
4. **Read the test definition** for the criteria, scenario, and mocking config when you need to see exactly what was asserted.
5. **For a repeat set, compare a passing run against a failing run of the same test.** The divergence is the answer: if the runs called different procedures, that is a routing problem; if they called the same procedures and tools, that is an eval or non-determinism problem.

## Answer with the divergence, not the criterion

"It failed because it did not meet criterion X" restates what the user can already see and answers nothing. Instead:

- Name the specific turn where the failing run differs and what it did differently. "In the failing run the agent updated the ticket to solved before the customer-facing reply; in the passing runs it replied first."
- Quote the clause of the criterion that was violated, not the criterion's name.
- Lead with the answer in the first sentence and keep the whole explanation under about six lines of prose.

## When the config is identical

Same config and input, different outcome, is the most common version of this question. Say so directly: the model made a different choice on that run, which is LLM non-determinism, not a config bug. Then give the actionable fix: tighten the criterion if it is ambiguous at that boundary, or move the requirement into a deterministic procedure if the ordering must be guaranteed. Never present a sampling difference as though the failing run had a distinct root cause.

## Summarizing suite history

When the user wants a history summary, present the overall pass/fail counts, a dedicated section for critical issues (critical tests are often tagged in the title, otherwise infer from context and content), and a section for recurring failures (tests that failed across multiple recent runs). Then diagnose specific failures from the invocation detail and suggest concrete fixes.

## Honesty

If a read errors, a transcript is truncated (check for a truncation flag and the total turn count), or a suite is too large to fetch in full, say which read failed or what was cut off, and offer to point the user to the Tests tab in the UI. Never fabricate a turn-by-turn account you could not read, and never present the evaluator's rationale as though it were the transcript.
