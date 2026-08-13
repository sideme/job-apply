# Agentic Job Discovery — Design

Date: 2026-08-13
Status: Approved design; not yet implemented

> This is the first genuinely *agentic* capability in job-apply. Everything today is a
> deterministic workflow (fixed pipeline steps; local rule/embedding scoring; discrete,
> single-shot LLM calls). This design adds two **bounded tool-calling agent loops** on the
> discovery/ranking side — the read-only, pre-submission surface — while preserving the
> project's core stance: opt-in, graceful degradation, hard budgets, and never auto-submit.

## 1. Background & Motivation

Discovery today (`pipeline/steps/discover-jobs.ts`) runs a **fixed set of search terms**
(`searchTerms`, ~5 strings) against the extractors, then `score-jobs.ts` ranks each job with
a **deterministic local score** (keyword coverage + ATS rules + optional embedding). Two
consequences:

- **Coverage is only as good as the hand-written search terms.** Adjacent-but-relevant roles
  ("Platform Engineer", "Kotlin backend", "Distributed systems") are missed unless Side
  manually adds the term; junk terms add noise. There is no feedback loop.
- **Fit is a number, not a judgment.** The blended score ranks well but cannot explain *why*
  a job fits Side's resume or *what's missing* — the reasoning that would actually save the
  manual triage effort.

Side wants the system to **find the right jobs on its own**: plan and refine its own searches,
and judge fit with reasoning rather than only a score. Primary goal is **real personal use**
(reduce manual effort), with the pre-submission surface as the agent's authority — the actual
submit click stays human, consistent with the rest of the app.

## 2. Goal & Non-goals

### 2.1 Goal
- An agent that **plans and iterates its own job searches** (a real tool-calling loop with
  reflection), replacing fixed search terms when enabled.
- An agent that **judges resume fit with reasoning** (verdict + fit points + gaps) for the
  most promising jobs, layered on top of the cheap local prefilter.
- Both **bounded** (hard budgets on iterations / searches / judgments) and **explainable**
  (every decision persisted as a trace).

### 2.2 Non-goals
- **No auto-apply / auto-submit.** The agent never fills or submits an employer form. Its
  entire surface is read-only discovery and ranking.
- **Not replacing the deterministic pipeline.** Agentic paths are opt-in; with the flag off
  or no LLM key, behavior is exactly today's pipeline.
- **Not a general chat co-pilot** (a conversational agent spanning the whole app is a possible
  later phase, explicitly out of scope here).
- **Not touching the application-prep side** (tailoring, cover letters, form answers) in this
  spec.

## 3. Approach (chosen: A — two bounded agent loops)

Two small, single-purpose agentic units rather than one large agent:

1. **Search Planner** — a tool-calling loop that decides what to search next.
2. **Fit Judge** — a bounded, per-job reasoning step (with one context-fetch tool) over the
   top-K locally-scored jobs.

Rejected alternatives:
- **B — single unified discovery agent** (one loop with all tools deciding search-vs-evaluate):
  more flexible but cost is hard to bound, behavior unpredictable, harder to test.
- **C — LLM-in-the-loop lite** (one-shot query expansion + one batched re-rank, no loop):
  cheapest but not actually agentic; fails the goal.

Approach A is genuinely agentic yet decomposes into bounded, independently testable units that
map cleanly onto the existing `discover` and `score` steps.

## 4. Prerequisite (must land first)

The configured chat model is `deepseek-chat`, which DeepSeek **retired on 2026-07-24**. All
four model roles (`model`, `modelScorer`, `modelTailoring`, `modelProjectSelection`) point at
it, so deep-analysis / tailoring — and therefore any agent — will fail until migrated to
`deepseek-v4-flash` (or `deepseek-v4-pro`). This is a Settings/config change (non-secret) and
is step 0 of implementation.

## 5. Architecture

```
discover-jobs.ts ──(agenticDiscoveryEnabled?)──► Search Planner agent ──► existing import/dedup
                                     │ no                                         │
                                     └────────── fixed searchTerms ───────────────┘

score-jobs.ts ──(local blended score, unchanged)──► top-K ──(agenticFitJudgeEnabled?)──► Fit Judge agent
                                                                        │ no
                                                                        └── local score only

services/agent/                (new)
  loop-runner.ts     provider-agnostic tool-calling loop + budget + trace
  tools/run-search.ts        wraps extractors, returns summaries
  tools/fetch-full-jd.ts     returns a job's full description on demand
  search-planner.ts  system prompt + tool wiring + stop rules
  fit-judge.ts       structured per-job judgment + fetch-jd tool
```

### 5.1 Agent Loop Runner — `services/agent/loop-runner.ts`
A minimal, provider-agnostic loop built on the existing `llm` chat client:

- **Input:** system prompt, initial user message, a **tool registry** (`{name, description,
  jsonSchema, handler}`), and a **budget** (`maxIterations`, `maxToolCalls`).
- **Loop:** call the LLM with the `tools` param → if the response contains `tool_calls`,
  dispatch each to its handler, append the tool result message, repeat → else return the final
  assistant message. Enforce budget: stop and return best-so-far when `maxIterations` or
  `maxToolCalls` is hit.
- **Trace:** record every step (`{iteration, toolName, args, resultSummary, stopReason}`) for
  persistence and UI.
- **Degradation:** if no LLM key, or the provider/model does not support tool calling, throw a
  typed `AgentUnavailable` error the callers catch to fall back to the deterministic path.

Single purpose, testable with a mock LLM that returns scripted `tool_calls`.

### 5.2 LLM tool-calling support — `services/llm/`
The current `llm` service does chat-only (messages → text); it does **not** pass `tools` or
parse `tool_calls`. Add a thin capability to the openai-compatible strategy (which backs
`deepseek`/`qwen`/`openai_compatible`) to:
- accept an optional `tools` array + `tool_choice`,
- surface `tool_calls` from the response (id, name, arguments),
- accept `role: "tool"` result messages.

DeepSeek is OpenAI-compatible and supports standard function calling, so this is additive and
does not change existing chat callers.

### 5.3 Search Planner agent — `services/agent/search-planner.ts`
- **Tools:**
  - `run_search({ query, sources?, location? })` — wraps the existing extractor call for one
    query, imports/dedups via existing logic, returns a **summary only**:
    `{ found, newAfterDedup, sampleTitles: string[] }` (never full job bodies — keeps context
    small and cost bounded).
  - `finish({ reason })` — ends the loop.
- **System prompt:** role = job-search planner; given a **resume summary**, Side's stated
  target (from settings), and **constraints**: prefer Indeed/Adzuna for exploration, use
  LinkedIn sparingly (circuit breaker), respect Adzuna's monthly quota.
- **Stop rules:** budget (below) **or** marginal `newAfterDedup` below `agentStopWhenNewBelow`
  for two consecutive searches.
- **Output:** the union of discovered jobs (already imported by the tool) + a persisted
  planner trace. Downstream `import`/`enrich`/`score` steps are unchanged.

### 5.4 Fit Judge agent — `services/agent/fit-judge.ts`
- Runs **after** local scoring, over the **top-K new jobs** by local blended score (cheap
  prefilter → only spend LLM on plausible jobs).
- **Tool:** `fetch_full_jd({ jobId })` — returns the full stored description when the truncated
  JD is insufficient; the model decides whether to call it before judging (keeps it agentic and
  improves quality without always paying for the full JD).
- **Structured output per job:**
  `{ verdict: "strong" | "possible" | "weak", llmFitScore: 0–100, fitPoints: string[], gaps: string[] }`.
- Persisted on the job; surfaced next to the ATS score in the UI (does not overwrite the ATS
  score — it's a second, explainable signal). Re-ranking policy: display both; optional blend
  is out of scope for v1.

## 6. Settings (new registry entries, all default OFF)

Mirrors the embedding safety-default pattern (opt-in, explicit).

| Key | Default | Purpose |
|---|---|---|
| `agenticDiscoveryEnabled` | `false` | Turn on the Search Planner path |
| `agentMaxSearchIterations` | `6` | Planner loop iteration cap |
| `agentMaxSearchesPerRun` | `10` | Total `run_search` calls per run |
| `agentMaxLinkedinSearches` | `2` | Protect the LinkedIn circuit breaker |
| `agentMaxAdzunaSearches` | `3` | Protect the Adzuna monthly quota |
| `agentStopWhenNewBelow` | `3` | Early-stop threshold (two consecutive) |
| `agenticFitJudgeEnabled` | `false` | Turn on the Fit Judge path |
| `agentMaxFitJudgments` | `20` | Max per-job judgments per run |
| `agentModel` | inherits `modelScorer` | Model for both agents |

## 7. Data model

### 7.1 Jobs table — new columns (Drizzle migration)
- `llm_fit_score` INTEGER null
- `llm_fit_verdict` TEXT null (`strong|possible|weak`)
- `llm_fit_points` TEXT null (JSON string[])
- `llm_fit_gaps` TEXT null (JSON string[])
- `llm_fit_model` TEXT null (provenance)

### 7.2 New `agent_runs` table (trace store)
- `id` TEXT PK, `pipeline_run_id` TEXT (FK-ish), `kind` TEXT (`search_planner|fit_judge`),
  `started_at`/`completed_at` TEXT, `status` TEXT, `steps` TEXT (JSON trace),
  `stop_reason` TEXT, `searches_used`/`judgments_used` INTEGER, `token_usage` TEXT (JSON).
- Keyed by `pipeline_run_id` so a run's agent activity is inspectable and demo-able.

## 8. Integration points
- `pipeline/steps/discover-jobs.ts`: branch on `agenticDiscoveryEnabled && llmAvailable` →
  Search Planner; else fixed-term discovery (unchanged).
- `pipeline/steps/score-jobs.ts`: after local scoring, if `agenticFitJudgeEnabled &&
  llmAvailable` → Fit Judge over top-K.
- Client: show `llm_fit_verdict`/points/gaps on the job detail beside the ATS breakdown; a
  Settings section for the toggles/budgets; an optional "agent run" trace viewer.

## 9. Safety, degradation & observability
- **Opt-in**: both flags default off; with them off or no LLM key, the pipeline is byte-for-byte
  today's behavior.
- **Hard budgets**: enforced in the loop runner and the tool wrappers, not just the prompt.
- **Source-aware limits**: LinkedIn/Adzuna caps honored by `run_search` regardless of what the
  model asks for (the tool refuses over-quota calls and tells the model why).
- **Read-only**: no tool can submit or mutate an employer form.
- **Explainable**: every decision persisted in `agent_runs`.

## 10. Cost model (reference)
Per run with default budgets: Search Planner ~25K in / ~2K out; Fit Judge (20 jobs) ~34K in /
~5K out → **~60K in / ~7K out per run**. On DeepSeek V4 Flash (2026-08 pricing: cache-miss in
$0.14/M, output $0.28/M, cache-hit in $0.0028/M): **~$0.006–0.01 per run**; ~$0.15–0.25/month
at once-daily cadence. Binding constraints are Adzuna quota, LinkedIn rate limits, and added
latency (~1–3 min/run), not money.

## 11. Testing strategy
- **Loop runner**: mock LLM returning scripted `tool_calls`; assert tool dispatch, budget
  enforcement (iterations & tool-call caps), trace shape, and `AgentUnavailable` fallback.
- **run_search tool**: mock extractors; assert summary shape, dedup-new counting, and
  source-cap refusal.
- **Search Planner**: scripted loop; assert early-stop on low marginal new, and that discovered
  jobs flow into existing import unchanged.
- **Fit Judge**: mock LLM; assert top-K bounding, structured-output parsing, `fetch_full_jd`
  dispatch, and persistence.
- **Fallback**: no-key / flag-off path yields identical results to the current pipeline.
- **LLM tool-calling**: provider strategy unit test for `tools`/`tool_calls`/`role:"tool"`.

## 12. Rollout / phasing
1. Prerequisite: migrate DeepSeek model IDs.
2. LLM tool-calling support + Loop Runner (+ tests).
3. Fit Judge (smaller, no discovery risk) behind `agenticFitJudgeEnabled`.
4. Search Planner + `run_search` behind `agenticDiscoveryEnabled`.
5. Client surfacing (verdict/gaps + settings + optional trace viewer).
6. Docs + rebuild.

## 13. Open questions
- Re-ranking: keep ATS and LLM-fit as two displayed signals (v1), or blend into one ordering
  later? (v1 = display both.)
- Resume summary for prompts: reuse the existing profile text (truncated) vs. a cached
  LLM-generated summary. (v1 = truncated profile text; revisit if prompt cost matters.)
