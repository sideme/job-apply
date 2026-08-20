---
id: agentic-discovery
title: Agentic discovery and fit judging
description: Configure bounded AI-planned searches and cached fit judgments for newly imported jobs.
sidebar_position: 6
---

# Agentic discovery and fit judging

## What it is

Job Ops has two optional, auditable agents:

- **Search Planner** chooses bounded search queries, while the server continues to
  enforce configured countries, cities, sources, blocked companies, source quotas,
  LinkedIn cooldowns, and deduplication.
- **Fit Judge** evaluates newly imported jobs after local scoring. The local score is
  used only as a provisional fallback; after DeepSeek completes, its judgment becomes
  the primary ATS score shown in job lists and headers.

Both features default to off. The verified v1 tool protocol is DeepSeek V4 Flash in
non-thinking mode. If the API key or compatible model is unavailable, deterministic
search and local scoring continue without an Agent call.

## Why it exists

Fixed role keywords are predictable but can miss related titles. Search Planner can
try adjacent queries without being allowed to change location or source policy. Fit
Judge can inspect required versus preferred qualifications. Local keyword, semantic,
role, seniority, and qualification signals remain stored as supporting evidence even
after the DeepSeek score becomes primary.

Hard limits cover daily starts, iterations, searches, source calls, judgments, input
and output Tokens, JD size, tool-result size, and request timeouts. Exact repeated
searches are cached for the current pipeline run. Completed Fit Judge results are
reused only when the normalized résumé, JD, model, prompt version, and application
constraints produce the same input hash.

Fit Judge sends one bounded JD with the initial request and requires one structured
judgment. Before storage, verbose model output is normalized to a 0–100 integer score,
one supported verdict, and at most six bounded strengths and gaps. A completed judgment
updates the primary ATS score and marks its source as `llm`; local supporting fields are
not deleted.

## How to use it

1. Open **Settings → Model** and select DeepSeek.
2. Add a valid DeepSeek API key and use `deepseek-v4-flash`.
3. Open **Settings → Agentic Discovery**.
4. Enable **Search Planner**, **Fit Judge**, or both.
5. Keep the default limits for the first run and save.
6. Run the normal job pipeline.
7. Inspect recent execution status, Token usage, stop reason, and sanitized steps under
   **Settings → Agent Runs**.
8. Open a job detail page to inspect the **DeepSeek ATS assessment** together with its
   local supporting signals, strengths, and gaps.

Saved provider credentials are loaded by both the web server and the standalone
pipeline scheduler after a restart, so scheduled Fit Judge runs use the same model
configuration as manual runs.

Only job IDs created by the current import are added to the Fit Judge queue. Existing
historical jobs are not bulk-enqueued or recomputed. Pending new jobs expire after
seven days by default.

## Common problems

- **Agent unavailable**: add an API key and select `deepseek-v4-flash`. Qwen and
  custom OpenAI-compatible models remain disabled for Agent tools until their exact
  tool protocol passes a recorded conformance probe. Restart older deployments after
  upgrading so the scheduler loads the saved credential.
- **Daily limit reached**: the normal deterministic pipeline still runs. Increase the
  daily limit only after reviewing Token usage.
- **No LLM Fit on an old job**: this is intentional. Automatic judging applies only to
  newly imported jobs while the feature is enabled.
- **Pending job became stale**: increase the pending lifetime if the daily judgment
  cap is lower than the number of new jobs.
- **A very long JD was truncated**: increase the Agent JD character limit within the
  configured safety bound. The detail page continues to keep the full locally stored
  JD even when the LLM receives a bounded copy.
- **Planner returned partial results**: successful searches are kept and imported once;
  the fixed search is not launched again, which avoids duplicate source usage.

## Related pages

- [Job level and screening roadmap](/docs/features/job-level-and-screening-roadmap)
- [Agentic Job Discovery design](/docs/superpowers/specs/2026-08-13-agentic-job-discovery-design)
- [Local embedding scoring design](/docs/superpowers/specs/2026-08-08-local-embedding-scoring-design)
