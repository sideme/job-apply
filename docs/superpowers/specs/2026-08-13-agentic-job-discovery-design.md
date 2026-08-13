# Agentic Job Discovery — Revised Design

Date: 2026-08-13
Status: Hardened design; ready for phased implementation (risk register in §19)

> This design adds two bounded, read-only agent capabilities to job discovery and
> ranking while preserving the existing deterministic pipeline. The agents are
> opt-in, use explicit capability checks and budgets, never submit an application,
> and degrade to the current local workflow without requiring an LLM API key.

## 1. Background and motivation

Discovery currently runs configured search terms through the extractor registry and
then imports, deduplicates, enriches, and locally scores only the newly created jobs.
The local score combines ATS rules, keyword coverage, and optional embeddings.

This works reliably but has two limitations:

- Search coverage depends on manually maintained terms, so adjacent roles can be
  missed and weak terms can repeatedly return noise.
- A numeric score is useful for ordering, but it does not provide a concise judgment
  of fit, evidence, and important gaps.

The goal is to reduce manual discovery and triage while keeping external searches,
LLM usage, and side effects tightly controlled.

## 2. Goals and non-goals

### 2.1 Goals

- Plan and refine job searches through a bounded tool-calling loop.
- Judge resume fit for promising jobs with a verdict, evidence, and gaps.
- Keep the existing local scorer as the cheap first-stage filter.
- Persist sanitized, inspectable traces and token usage.
- Process new or pending jobs without repeatedly spending tokens on unchanged input.
- Preserve the current no-key local mode as the default.

### 2.2 Non-goals

- No form filling, application submission, employer messaging, or other write action
  outside this application's own database.
- No replacement of the deterministic pipeline.
- No general-purpose chat agent.
- No tailoring, cover-letter, project-selection, or application-answer changes.
- No blending of ATS and LLM-fit into one opaque score in v1.

## 3. Chosen approach

Use two independently bounded units:

1. **Search Planner** decides which configured search to run next and observes a small
   summary of each result.
2. **Fit Judge** evaluates locally prefiltered jobs and may fetch a bounded full-JD
   excerpt before submitting a structured judgment.

This separation keeps cost, permissions, fallback behavior, and testing clearer than
one agent with access to every discovery and ranking operation.

## 4. Prerequisite: supported model configuration

The current local configuration resolves to provider `deepseek` and model
`deepseek-chat`. DeepSeek discontinued the legacy `deepseek-chat` and
`deepseek-reasoner` identifiers on 2026-07-24. Migrate the configured model to
`deepseek-v4-flash` by default, with `deepseek-v4-pro` as an optional higher-quality
choice.

Migration requirements:

- Update only non-secret model settings; do not write API keys to the repository.
- Preserve empty per-task overrides so they continue to inherit the main model.
- Validate the selected model and tool-calling capability before starting an agent
  run.
- If validation fails, use the deterministic path and record a sanitized reason.

### 4.1 Empirical tool-calling conformance probe (gating)

The entire design assumes the configured provider/model supports reliable tool
calling. That is an assumption, not a verified fact, so it is validated empirically
**before any runner, agent, or schema code is written**. As the first implementation
action, run a throwaway, read-only probe that loads the configured (encrypted) key
from settings and issues one real tool-calling request per target model (DeepSeek V4
Flash first), exercising: a single tool call, argument delivery, `tool_call_id`
round-tripping, whether assistant `content` may be null, whether `tool_choice` is
accepted, and — for DeepSeek thinking mode — whether `reasoning_content` must be
replayed across tool rounds. The raw responses become the recorded conformance
fixtures that back §6.2 and §16.1. If a target model cannot satisfy the protocol it
returns `AgentUnavailable` and is excluded until fixtures exist. No further work
starts until the probe passes for at least DeepSeek V4 Flash. The probe writes
nothing except its own sanitized result and never persists the key.

## 5. Corrected pipeline architecture

```text
load profile
    |
    v
discover-jobs
    |-- agent eligible and available --> Search Planner --> CreateJobInput[]
    |-- otherwise ----------------------> fixed terms ----> CreateJobInput[]
    |
    v
existing import-jobs (the only database import/dedup boundary)
    |
    +--> createdJobIds
    v
posting-date enrichment
    v
existing local score for createdJobIds
    |
    +--> mark eligible LLM-fit work pending
    v
Fit Judge, when its daily budget is available, over top pending jobs
    v
existing notification/selection/processing flow
```

### 5.1 Single import boundary

`run_search` must **not** write jobs to the database. Each successful tool call keeps
its `CreateJobInput[]` result in a coordinator-owned in-memory accumulator and returns
only a bounded summary to the model. When the planner stops, `discoverJobsStep`
returns the accumulated union to the existing `importJobsStep`.

This preserves the current invariant:

- `importJobsStep` is the only job import/dedup boundary.
- `createdJobIds` remains the source of truth for newly created jobs.
- Posting-date enrichment and local scoring continue to receive the correct IDs.

At planner start the coordinator seeds its identity set with a single **read-only**
query of existing job canonical URLs and dedup identities
(title/employer/location/date), so `novelCandidates` reflects genuine novelty against
the database instead of treating every result as new — otherwise the low-yield
early-stop in §8.4 never fires and the model misreads its own progress. Within one
planner run the coordinator additionally tracks in-run candidate identities. This read
imports and mutates nothing and does not weaken the single import boundary.
`novelCandidates` remains an estimate before the authoritative `importJobsStep` dedup;
the exact `created` count comes only from `importJobsStep`.

## 6. Agent protocol and provider compatibility

### 6.1 Message types

Extend the LLM service with a discriminated message union rather than adding only
`role: "tool"` to the current text message type:

```ts
type AgentMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: ToolCall[];
      reasoningContent?: string | null;
    }
  | { role: "tool"; toolCallId: string; content: string };
```

For every tool round, preserve the complete assistant message before appending tool
results. Each tool result must include the matching `tool_call_id` on the wire.

### 6.2 Provider capability adapter

Tool support is a provider/model capability, not a property of every chat model. Add
a capability adapter with at least:

- whether tools are supported;
- whether `tool_choice` is supported in the selected mode;
- whether assistant `content` must be non-null;
- whether `reasoning_content` must be replayed across tool rounds;
- how tool calls and usage are extracted;
- whether structured output and tools can be requested together.

DeepSeek V4 thinking mode requires replaying `reasoning_content` for tool-calling
turns and may reject parameters that work in ordinary OpenAI-compatible non-thinking
mode. Do not assume that one generic request body works for DeepSeek, Qwen, custom
OpenAI-compatible endpoints, and local models.

The first implementation targets the existing `deepseek`, `qwen`, and
`openai_compatible` Chat Completions strategies. Other providers return
`AgentUnavailable` until they have explicit conformance tests.

### 6.3 Tool argument validation

Every tool has both a JSON Schema sent to the provider and a server-side Zod schema.
The loop runner must:

1. reject unknown tool names;
2. parse JSON defensively;
3. validate and normalize arguments before dispatch;
4. reject extra fields;
5. match every result to its tool-call ID;
6. refuse calls that exceed the remaining budget before any handler starts.

Provider-side strict schemas are an optimization, not a security boundary.

## 7. Loop runner

Create `services/agent/loop-runner.ts` with:

- a provider/model capability preflight;
- an explicit tool registry;
- iteration, tool-call, token, size, and timeout budgets;
- sequential dispatch by default so a single model response cannot overspend by
  emitting many parallel calls;
- cancellation through one `AbortSignal` propagated to the LLM and extractors;
- incremental sanitized trace persistence;
- typed stop reasons and partial-result handling.

The runner appends the complete assistant tool-call message, validates and executes
accepted tools, appends their bounded results, and repeats. Terminal tools end the
loop explicitly; a plain assistant response is treated as `completed_without_tool`
and must still satisfy the caller's completion policy.

### 7.1 Hard budgets

The following are enforced in code, not only in prompts:

| Budget | Default | Enforcement |
|---|---:|---|
| Planner iterations | 6 | Before each LLM request |
| Search calls | 10 | Before handler dispatch |
| LinkedIn source-query calls | 2 | Inside search policy |
| Adzuna source-query calls | 3 | Inside search policy |
| Fit judgments | 20 | Before candidate dispatch |
| Input tokens per agent run | 100,000 | Usage ledger before next request |
| Output tokens per agent run | 12,000 | Usage ledger before next request |
| Resume/profile characters | 8,000 | Initial prompt construction |
| Initial JD excerpt characters | 3,000 | Initial prompt construction |
| JD characters returned to model | 12,000 | Tool-result truncation |
| Sample titles per search | 8 | Tool-result construction |
| Characters per sample title | 160 | Tool-result construction |
| Tool-result characters | 16,000 | Before message append |
| Persisted trace bytes | 256 KiB | Repository boundary |
| LLM request timeout | 60 seconds | Abort controller |
| Extractor search timeout | existing extractor timeout | Extractor boundary |

Before every request, estimate the complete serialized input and reject a request that
would cross the remaining input budget. Set the provider's per-request output-token
parameter to no more than the remaining output budget. When reliable provider usage is
unavailable, use a conservative character-based estimate and stop early. Reaching a
budget produces a successful bounded stop or a partial status; it must not crash the
deterministic pipeline.

## 8. Search Planner

Create `services/agent/search-planner.ts` and
`services/agent/tools/run-search.ts`.

### 8.1 Tools

- `run_search({ query, sourceHints? })`
  - `query` is trimmed, length-bounded, and deduplicated per pipeline run.
  - `sourceHints` can only narrow the runtime-approved source set.
  - Country, locations, and cities come from settings and cannot be invented by the
    model.
  - Returns `{ found, novelCandidates, sampleTitles, sourcesUsed }` to the model.
  - Stores raw candidates only in the coordinator accumulator.
- `finish({ reason })`
  - Terminal tool with a bounded reason string.

The planner's initial context contains only a bounded normalized resume/profile
summary, configured target roles and skills, approved sources and locations, and the
current run budget. Later turns receive only the bounded summaries from executed
searches—never full job descriptions or raw extractor payloads.

### 8.2 Shared discovery policy

Extract the existing discovery constraints into reusable policy code used by both
fixed discovery and agent search:

- intersect requested sources with `mergedConfig.sources`;
- enforce country/source compatibility;
- enforce selected cities and blocked-company filters;
- honor LinkedIn cooldown and failure recording;
- honor scheduler-provided sources, including daily-only Adzuna availability;
- pass cancellation and progress callbacks;
- sanitize source errors and continue with healthy sources.

Limits count **source-query executions**, not only tool calls. A single tool call that
uses Indeed and LinkedIn consumes one general search call plus one unit from each
relevant source ledger.

### 8.3 Idempotency and fallback

The normalized key `(pipelineRunId, query, sortedSources, configuredLocations)` is
executed at most once per run. LLM retries receive the cached summary instead of
repeating an external search.

Fallback rules:

- Capability/key/model preflight failure: run fixed discovery normally.
- Failure before any successful search tool call: run fixed discovery normally.
- Failure after one or more successful calls: keep accumulated candidates, mark the
  agent run `partial`, and do not restart all fixed searches in the same run.
- One source failure does not discard results from other sources.

These rules prevent a degraded agent from doubling LinkedIn or Adzuna usage.

### 8.4 Early stop

Stop when a hard budget is reached, `finish` is called, cancellation is requested, or
`novelCandidates < agentStopWhenNewBelow` for two consecutive executed searches.
Cached duplicate tool requests do not count toward this early-stop rule.

## 9. Fit Judge

Create `services/agent/fit-judge.ts` and
`services/agent/tools/fetch-full-jd.ts`.

### 9.1 Candidate selection

- Local scoring always runs first.
- Newly scored jobs become eligible for LLM fit when the feature is enabled.
- The judge selects the highest locally scored pending jobs, up to the remaining daily
  and per-run budget.
- Pending work can be processed on the next eligible day, so jobs discovered after
  the daily agent window are not permanently missed.
- Applied, skipped, expired, duplicate, or unchanged already-completed jobs are not
  judged again automatically.
- Pending work has a staleness cutoff (`agentFitPendingTtlDays`, default 7): a job that
  is still only `discovered`/`pending` past the cutoff is dropped from the queue. This
  bounds the backlog when daily discovery exceeds the daily judgment budget, so tokens
  are never spent judging now-stale postings and the queue cannot grow without limit.

The initial judgment prompt contains bounded profile text, title, employer, location,
job level, ATS breakdown, and only the first 3,000 characters of the JD. The model may
call `fetch_full_jd` when this is insufficient.

### 9.2 Tools

- `fetch_full_jd({ jobId })`
  - accepts only the job ID bound to the current judge;
  - returns at most `agentMaxJdChars` characters;
  - treats JD text as untrusted data, never as instructions;
  - does not expose unrelated profile or job data.
- `submit_judgment({ verdict, llmFitScore, fitPoints, gaps })`
  - terminal tool;
  - validated with Zod;
  - score is an integer from 0 to 100;
  - arrays and individual strings have explicit size limits.

Using a terminal `submit_judgment` tool avoids mixing response-format JSON with tool
calling and gives the server one validated persistence boundary.

### 9.3 Cache identity and invalidation

Compute `llm_fit_input_hash` from:

- normalized resume/profile text hash;
- normalized title and JD hash;
- provider and model;
- prompt version;
- relevant application constraints used in the judgment.

Reuse a completed judgment only when this hash matches. A changed resume, JD, model,
or prompt creates pending work; unchanged historical jobs are not reprocessed.
`prompt_version` is a code constant deliberately incremented whenever the judge prompt
or its output contract changes — that increment is what makes a prompt edit invalidate
the cache; nothing infers it automatically.

The ATS score remains independent. The UI displays ATS and LLM fit as separate signals
with their own explanations.

## 10. Scheduling and cost control

The current scheduler runs at 10:00, 12:00, 14:00, 16:00, and 18:00 on weekdays.
Deterministic discovery and local scoring continue at every slot.

By default, each agent kind may start only once per configured local day:

- Search Planner runs on the first eligible pipeline run of the day.
- Fit Judge processes the top pending queue on the first run with remaining daily
  budget.
- Later pipeline runs remain deterministic and can add pending Fit Judge work for the
  next day.
- Manual and scheduled runs share the same persisted daily usage ledger.

The application atomically reserves daily capacity in a persisted usage row before an
agent run starts. A run that reaches its first LLM request counts toward the daily run
limit even if it later fails or is cancelled; preflight-unavailable attempts do not.
This prevents retries, restarts, concurrent processes, and manual runs from bypassing
the limit. A future UI action may support an explicit user-confirmed override; it is
out of scope for v1.

With the default maximum of one run per agent kind per weekday, the reference workload
of about 60K input and 7K output tokens per day is approximately $0.23 per 22-workday
month at the documented DeepSeek V4 Flash cache-miss prices. Without the daily guard,
five scheduled runs per weekday would be roughly $1.14 per month at the same maximum
workload. Actual usage must be displayed from provider-returned usage, not inferred
only from estimates.

## 11. Settings

All feature flags default off.

| Key | Default | Purpose |
|---|---:|---|
| `agenticDiscoveryEnabled` | `false` | Enable Search Planner |
| `agenticFitJudgeEnabled` | `false` | Enable Fit Judge |
| `agentModel` | inherit `modelScorer` | Model for both agents |
| `agentMaxRunsPerLocalDay` | `1` | Per-kind daily start limit |
| `agentMaxSearchIterations` | `6` | Planner request cap |
| `agentMaxSearchesPerRun` | `10` | Search tool cap |
| `agentMaxLinkedinSearches` | `2` | LinkedIn source-query cap |
| `agentMaxAdzunaSearches` | `3` | Adzuna source-query cap |
| `agentStopWhenNewBelow` | `3` | Low-yield early-stop threshold |
| `agentMaxFitJudgments` | `20` | Fit judgments per run |
| `agentFitPendingTtlDays` | `7` | Drop stale pending Fit Judge work |
| `agentMaxInputTokensPerRun` | `100000` | Input-token hard stop |
| `agentMaxOutputTokensPerRun` | `12000` | Output-token hard stop |
| `agentMaxJdChars` | `12000` | JD context ceiling |
| `agentRequestTimeoutMs` | `60000` | Per-LLM-request timeout |

Numeric settings use bounded registry schemas. Settings UI explains that API keys are
optional for the rest of the application but required for these two agent features.

## 12. Data model

The project uses Drizzle schema definitions plus idempotent SQL in
`server/db/migrate.ts`; implementation must update both.

### 12.1 Jobs columns

- `llm_fit_score` INTEGER null
- `llm_fit_verdict` TEXT null (`strong|possible|weak`)
- `llm_fit_points` TEXT null (bounded JSON string array)
- `llm_fit_gaps` TEXT null (bounded JSON string array)
- `llm_fit_status` TEXT null (`pending|running|completed|failed`)
- `llm_fit_error` TEXT null (sanitized and truncated)
- `llm_fit_provider` TEXT null
- `llm_fit_model` TEXT null
- `llm_fit_prompt_version` TEXT null
- `llm_fit_input_hash` TEXT null
- `llm_fit_at` TEXT null

Add an index supporting pending candidate selection by status and local score.

### 12.2 `agent_runs`

- `id` TEXT primary key
- `pipeline_run_id` TEXT nullable foreign key to `pipeline_runs`
- `kind` TEXT (`search_planner|fit_judge`)
- `status` TEXT (`running|completed|partial|failed|cancelled|unavailable`)
- `provider`, `model`, `prompt_version` TEXT
- `started_at`, `completed_at` TEXT
- `local_date`, `time_zone` TEXT
- `stop_reason`, `error_code`, `error_message` TEXT
- `searches_used`, `judgments_used`, `input_tokens`, `output_tokens` INTEGER

Index `(kind, local_date, status)` for daily limits and `pipeline_run_id` for run
inspection.

### 12.3 `agent_run_steps`

- `id` TEXT primary key
- `agent_run_id` TEXT foreign key with cascade delete
- `job_id` TEXT nullable foreign key with set-null delete
- `iteration`, `sequence` INTEGER
- `step_type` TEXT (`llm|tool|stop|error`)
- `tool_name`, `tool_call_id` TEXT nullable
- `args_summary`, `result_summary` TEXT nullable
- `input_tokens`, `output_tokens`, `duration_ms` INTEGER nullable
- `created_at` TEXT

Persist one sanitized step at a time. Never store API keys, authorization headers, raw
resume text, full JD bodies, raw upstream errors, or unbounded tool payloads in traces.

### 12.4 `agent_daily_usage`

- `kind` TEXT (`search_planner|fit_judge`)
- `local_date`, `time_zone` TEXT
- `runs_started`, `input_tokens`, `output_tokens` INTEGER
- `searches_used`, `judgments_used` INTEGER
- `updated_at` TEXT
- primary key `(kind, local_date, time_zone)`

Reserve and increment this ledger with a genuinely **atomic** write, because the main
application and the scheduler are **separate processes writing the same SQLite file**.
Use a `BEGIN IMMEDIATE` transaction (or a single conditional
`UPDATE ... SET runs_started = runs_started + 1 WHERE runs_started < :limit` gated by
the affected-row count, upserting the row first) so two concurrent processes cannot both
observe free capacity and both proceed. A plain deferred transaction is **not** sufficient
under this two-writer topology. This ledger is the source of truth for daily admission;
`agent_runs` remains the audit history. Reconcile token counters from the run when it
ends, including failed and cancelled runs that consumed provider usage.

## 13. Prompt-injection and privacy boundaries

Job titles, descriptions, company text, and extractor output are untrusted external
data. Prompts must delimit them as data and explicitly state that instructions inside
them are not authoritative. Tool handlers, not the model, enforce permissions.

- The Fit Judge can fetch only its bound job.
- The Search Planner can search only approved sources and configured locations.
- Tool output is whitelisted, truncated, and sanitized.
- Trace summaries follow the shared redaction and truncation rules.
- LLM prompts send only the minimum resume/job fields required for judgment.
- Retention and deletion of agent traces follow the pipeline-run retention policy; if
  no policy exists at implementation time, add an explicit configurable retention
  period before enabling trace UI.

## 14. Failure, cancellation, and recovery

- Every LLM request and extractor call receives the pipeline cancellation signal.
- Cancellation marks the active run and running fit work `cancelled` or returns it to
  `pending` as appropriate.
- Startup recovery marks stale `running` agent runs failed and stale fit jobs pending.
- Agent failure never removes a local score or blocks the rest of the deterministic
  pipeline.
- Partial Search Planner results proceed through the one normal import boundary.
- Per-job Fit Judge failures are isolated; other candidates continue within budget.
- Sanitized errors include `pipelineRunId`, `agentRunId`, and `jobId` where available.

## 15. API and client surface

- Add settings controls for both flags, model, daily cap, and budgets.
- Show LLM-fit verdict, score, evidence, gaps, model, and timestamp beside—but not
  merged into—the ATS breakdown.
- Clearly label `pending`, `failed`, and stale judgments.
- Add a minimal Agent Runs view in v1 because inspectability is a stated requirement,
  not an optional extra.
- Paginate run steps and return only sanitized summaries.
- All new `/api/*` routes use the shared `{ ok, data/error, meta.requestId }` contract.

## 16. Testing strategy

### 16.1 Protocol and runner

- Complete assistant tool-call replay, `tool_call_id`, nullable content, and DeepSeek
  reasoning-content replay.
- Qwen and generic OpenAI-compatible conformance fixtures.
- Unknown tools, invalid JSON, schema violations, extra arguments, and duplicate IDs.
- Multiple tool calls in one response cannot exceed the remaining budget.
- Token, size, iteration, timeout, and cancellation stops.
- Per-request output limits cannot exceed the remaining run budget.

### 16.2 Search Planner

- Existing country, city, blocked-company, source, and LinkedIn cooldown behavior is
  identical in fixed and agent paths.
- `run_search` performs no database writes.
- One import occurs after planner completion and produces correct `createdJobIds`.
- Retry idempotency avoids duplicate external searches.
- Partial failure does not launch the full fixed search again.
- Daily-only Adzuna availability and source-query accounting.

### 16.3 Fit Judge

- Top pending selection, daily cap, per-run cap, and backlog processing.
- Bound job ID enforcement and JD truncation.
- Structured terminal judgment validation.
- Input-hash cache hit and invalidation after resume/JD/model/prompt changes.
- Per-job failure isolation and stale-running recovery.
- Atomic daily admission across scheduled, manual, and concurrent processes.

### 16.4 Regression and observability

- Flags off and no-key paths use the same deterministic discovery and local scoring
  code paths as today.
- Agent trace payloads are sanitized and bounded.
- Migrations work for empty and existing databases and are idempotent.
- Full CI-parity checks pass.

## 17. Rollout plan

Because this spec spans four new tables, a provider adapter, two agents, recovery, and
UI, it is decomposed into separate implementation plans — each its own
plan → build → verify cycle rather than one oversized plan. A throwaway conformance
probe (§4.1) gates everything.

**Plan 0 — Probe & prerequisite (gating).**
1. Empirical DeepSeek V4 tool-calling conformance probe (§4.1); record fixtures.
2. Migrate the configured model identifier and add capability validation.

**Plan 1 — Foundations.**
3. Schema/migrations, repositories, recovery, and bounded settings (update both the
   Drizzle schema and idempotent SQL in `migrate.ts`).
4. Provider message/tool support and conformance tests (backed by Plan 0 fixtures).
5. Loop Runner with cancellation, atomic daily usage ledger, validation, and trace
   persistence.

**Plan 2 — Fit Judge** (lower risk, no discovery side effects) behind its default-off
flag: candidate selection, `fetch_full_jd`/`submit_judgment` tools, cache identity,
recovery.

**Plan 3 — Search Planner** + extracted shared discovery policy behind its default-off
flag: coordinator accumulator, DB-seeded novelty, idempotency, early-stop, fallback.

**Plan 4 — Surfacing:** Settings controls, job-detail LLM-fit explanations, and the
Agent Runs view; then full CI, rebuild, restart, and setup/cost documentation.

## 18. Decisions deferred beyond v1

- ATS and LLM-fit remain separate; no blended ordering in v1.
- Resume prompts use bounded normalized profile text; a cached generated summary can
  be evaluated later using measured cost and quality.
- Explicit user-confirmed extra daily runs can be added later.
- Additional providers become available only after protocol conformance tests.

## 19. Risk register

Each row is a risk identified in review and the mitigation now folded into this spec.

| # | Risk | Mitigation | Where |
|---|---|---|---|
| A | Provider tool-calling is assumed, not verified; DeepSeek V4 thinking mode has quirks (`reasoning_content` replay, `tool_choice`, non-null `content`). Discovering this after building the runner is expensive. | Gating empirical probe recorded as conformance fixtures **before** any runner/agent/schema code; unsupported models return `AgentUnavailable`. | §4.1, §6.2, §16.1, Plan 0 |
| B | `novelCandidates` is estimated without a DB read, so low-yield early-stop never fires and the model misreads progress. | Seed the coordinator's identity set from a **read-only** query of existing URLs/dedup identities at planner start. | §5.1, §8.4 |
| C | The main app and scheduler are two processes on one SQLite file; a non-atomic daily reservation lets concurrent/retried runs bypass the cap. | `BEGIN IMMEDIATE` / conditional `UPDATE ... WHERE runs_started < limit` gated by affected rows. | §10, §12.4 |
| D | Fit Judge backlog grows unbounded when daily discovery exceeds the daily judgment budget. | `agentFitPendingTtlDays` (default 7) drops stale pending work. | §9.1, §11 |
| E | `prompt_version` in the cache hash is inert unless bumped, so a prompt edit silently reuses stale judgments. | It is a code constant deliberately incremented on prompt/contract change. | §9.3 |
| F | The spec is too large for a single implementation plan. | Decomposed into Plan 0–4, each its own build/verify cycle. | §17 |

None of these mitigations weaken the core invariants: opt-in by default, single import
boundary, read-only agent surface, and graceful degradation to the deterministic
pipeline without an LLM key.
