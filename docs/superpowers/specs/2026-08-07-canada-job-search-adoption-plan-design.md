# Canada Job Search — job-ops Adoption Plan

Date: 2026-08-07
Status: Implemented; retained as historical adoption rationale

## 1. Background & Motivation

Side is a senior backend engineer (ex-Kingsoft, 2016–2024) actively interviewing in Toronto, currently holding a Canadian **open work permit** valid until **2029-03-23** (no employer-tied sponsorship required). He wants to reduce the manual effort of finding and applying to matching roles on Canadian job platforms, prioritizing **LinkedIn, Indeed, and Glassdoor**.

Initial direction was to build a custom Python agent (discovery → scoring → tailored materials → human-gated apply). During design, we found an existing self-hosted open-source project already cloned locally — [`job-ops`](https://github.com/DaKheera47/job-ops) — that covers most of the same ground with more polish than a from-scratch build would reasonably achieve. This document records the requirements, evaluates job-ops against them, and lays out the plan to adopt and customize it instead of building new.

**Implementation update (2026-08-08):** the project is now a standalone application at `/Users/Side/code/job-apply`, containing only JobSpy (Indeed, LinkedIn, Glassdoor) and optional Adzuna discovery. UK extractors and UK visa-sponsor matching are no longer part of the active flow. The current application uses a local uploaded PDF resume rather than RxResume, performs free keyword scoring by default, and has an optional Docker scheduler. The remaining sections document the original adoption decision and should not override the current README.

## 2. Requirements

### 2.1 Functional

- Discover job postings from LinkedIn, Indeed, and Glassdoor, targeting the Canadian market.
- Prioritize freshly-posted roles — a multi-day discovery lag is unacceptable because it puts Side out of contention as an early applicant.
- Score each discovered job against Side's resume/profile for fit, with a human-readable rationale.
- Generate tailored application materials (resume, ideally cover-letter-equivalent content) per job.
- Track applications through outcome stages (applied → response → interview → offer/reject) to measure which sources are worth the effort.
- Surface new high-fit matches to Side promptly, including when he's away from his main machine.

### 2.2 Non-functional / safety

- **No unattended full auto-submit.** A human must always be the one to actually submit an application. This is both a deliberate product boundary (per-application review avoids templated/spam-looking submissions) and matches operating constraints Claude itself follows (form submission is never a fire-and-forget automated action).
- **Account-ban risk must be actively managed, especially for LinkedIn.** LinkedIn is Side's real professional identity; losing it to an automation ban is a materially worse outcome than losing a scraping session. Indeed/Glassdoor carry lower identity risk.
- **Prefer official/lower-risk data sources over raw scraping** where a viable one exists for the target market (e.g., an API-based provider over crawling a logged-in search page).
- Whatever the eligibility/answer logic ends up being, it must not silently guess on **work-authorization / sponsorship** screening questions — Side's status (open work permit, not needing sponsorship) should be an explicit, fixed value, not an inferred one.

### 2.3 Non-goals (for this iteration)

- No UK-specific functionality (visa-sponsor tracking, UKVisaJobs extractor) — irrelevant given Side's Canadian open work permit.
- No automated form-fill/submit assistant in this iteration. job-ops's existing model (generate tailored PDF → human applies manually → human marks "applied") already satisfies the human-in-the-loop requirement, and is more conservative than the browser-automation "fill but pause before submit" idea discussed earlier. That idea is captured as a deferred option in §5.5, not committed.
- No new cloud infrastructure. Everything runs on Side's own machine(s), consistent with keeping platform login/session state off third-party infrastructure.

## 3. Decision: Adopt and customize job-ops

**Verdict: adopt.** job-ops already implements the large majority of the requirements above, to a higher standard than a green-field build would hit in comparable time:

- Multi-source discovery, including a purpose-built `JobSpy` extractor covering Indeed/LinkedIn/Glassdoor, and an **API-based `Adzuna` extractor that officially supports Canada** — a materially lower-risk source than scraping, and one we should lean on.
- A `JOBSPY_HOURS_OLD` control (default 72h) that directly satisfies the "avoid multi-day discovery lag" requirement once tuned down.
- LLM-based suitability scoring with a written fit rationale per job.
- Tailored PDF resume generation per job description (via Reactive Resume), which exceeds the original ask.
- A job lifecycle state machine (`discovered → processing → ready → applied → skipped → expired`) plus an analytics dashboard (response rate by source, funnel progression) that satisfies the outcome-tracking requirement.
- Gmail OAuth-based inbox monitoring that auto-links recruiter replies to the right job record — this goes beyond what was originally scoped.
- The apply step is already human-only: job-ops prepares the tailored PDF; Side applies manually on the platform and marks the job `applied` afterward. This satisfies the "no unattended auto-submit" requirement without any extra code.
- Existing webhook hooks (pipeline-run completion, job-marked-applied) that we can point at a phone-reachable relay to satisfy the "notify me even when away from my machine" requirement.
- Self-hosted, single Docker Compose stack, SQLite-backed, no required cloud dependency.

What job-ops does **not** cover, and what we plan to add, is in §5.

## 4. Requirement → job-ops capability mapping

| Requirement | job-ops capability | Status |
|---|---|---|
| Discover LinkedIn/Indeed/Glassdoor jobs | `JobSpy` extractor (`extractors/jobspy/`) | Available, needs config |
| Lower-risk Canadian source | `Adzuna` extractor — Canada is in its supported country list | Available, needs API key |
| Fresh postings (avoid multi-day lag) | `JOBSPY_HOURS_OLD` (default 72h) | Available, needs tuning down |
| Fit scoring + rationale | Orchestrator scoring pipeline + "Fit Assessment" | Available, needs LLM provider key |
| Tailored application materials | Reactive Resume integration, PDF generation per job | Available, needs RxResume account |
| Human-gated submission | `ready` → manual apply → mark `applied` flow | Available as-is |
| Outcome tracking | Job status funnel + Overview analytics dashboard | Available as-is |
| Recruiter-reply tracking | Gmail OAuth inbox linking | Available, optional, needs OAuth setup |
| Notify Side of new matches while away | Pipeline/job-completion webhooks (Settings → Webhooks) | Available, needs a receiving relay |
| Fixed, non-guessed work-authorization answer | — | Not directly modeled; handled via resume/profile content, not a screening-question field (job-ops doesn't auto-fill application forms at all) |
| Recurring/periodic discovery runs | `npm run pipeline:run` — explicitly built to be "triggered by n8n or cron" | Not scheduled internally; needs external cron |
| LinkedIn-specific caution (back off on block signals) | — | Not present; planned addition |

## 5. Gaps & planned customizations

These are concrete additions on top of configuration, grounded in the actual code layout (`orchestrator/src/server/...`, `extractors/jobspy/...`).

### 5.1 Recurring discovery runs (config/ops, not new code)

job-ops ships `orchestrator/src/server/pipeline/run.ts` as a standalone script (`npm run pipeline:run`) explicitly intended to be triggered by an external scheduler — it is **not** run automatically on an interval today. Plan: add a system-level cron/launchd job on Side's machine that invokes this on a cadence tuned per source risk (see 5.2), rather than building a new in-app scheduler. `orchestrator/src/server/utils/scheduler.ts` exists but is a fixed-hour-once-daily scheduler used for backups, not a fit for multi-hour interval runs — no changes needed there, we simply won't reuse it for this purpose.

### 5.2 LinkedIn-aware run cadence and circuit breaker (new code)

Given LinkedIn is Side's real identity and the highest-risk source, treat it distinctly from Indeed/Adzuna:

- Run LinkedIn-inclusive pipeline runs on a more conservative cadence (e.g. every 2–3 hours) than Adzuna/Indeed-only runs.
- Add a lightweight failure-signal check around the JobSpy invocation (`extractors/jobspy/src/run.ts` / `scrape_jobs.py`): if a run against LinkedIn comes back empty/erroring in a pattern consistent with a block or CAPTCHA challenge (as opposed to "no new postings"), automatically disable the LinkedIn source for a cool-down window and fire the existing pipeline-status webhook so Side is notified rather than having the schedule blindly retry into a worsening block.
- This is new, scoped code — not present in upstream job-ops today.

### 5.3 Notification relay — WhatsApp (config + small glue script)

Side wants notifications on WhatsApp specifically. job-ops's webhooks POST a JSON payload to any URL — WhatsApp itself has no such inbound webhook endpoint, so we need something in between. Two realistic options:

- **CallMeBot** (default/recommended): a free personal-use API built exactly for "send myself a WhatsApp message from a script." One-time manual setup (message their bot once from Side's own WhatsApp to get a personal API key), then it's a single authenticated GET/POST call. No business verification, no cost, good enough for a personal notification stream.
- **Twilio WhatsApp Business API**: official, more robust, but requires business template message approval for anything beyond a 24h reply window and has per-message cost — overkill for a single-user personal notifier.

Plan: build a small shim (a tiny local HTTP endpoint or serverless function that job-ops's webhook calls, which then reformats and forwards to CallMeBot) since job-ops's raw webhook JSON won't match CallMeBot's expected query params directly. This is genuinely new (small) code, not pure config.

### 5.4 Canada-tuned defaults, nationwide scope

Side wants nationwide Canada coverage, not specific cities. This needs to reconcile with one real constraint found in job-ops: **Glassdoor (via JobSpy) is only selectable when at least one "search city" is set** — it has no pure country-wide mode. Plan:

- For JobSpy's Indeed/LinkedIn search (which accepts a free-form location string): set location to `"Canada"` directly — both sites accept a country-level location for a broad search, no per-city looping needed.
- For Glassdoor specifically: set **search cities** to a small fixed list of major Canadian tech hubs (Toronto, Vancouver, Montreal, Ottawa, Calgary, Waterloo) as a practical stand-in for "nationwide," since the extractor has no country-only mode. This runs Glassdoor once per listed city. Side can adjust the city list later; defaulting to these six keeps first-run scope reasonable.
- Adzuna's country-level API query needs no city at all — runs nationwide natively.
- Other defaults: `JOBSPY_HOURS_OLD` tuned down from the 72h default (exact value TBD in §6 step 5, based on first-run volume), Adzuna enabled by default, search terms matched to Side's target roles (senior backend engineer and close variants).

### 5.5 Deferred: auto-fill assist (not committed)

Earlier in the design discussion, an optional "agent fills the application form but a human clicks submit" module was discussed as a possible addition on top of job-ops's PDF-only flow. It is **not** in scope for this plan — job-ops's fully-manual apply step already satisfies the safety requirement, and adding browser-driven form-fill against LinkedIn/Indeed re-introduces exactly the account-risk tradeoff this plan otherwise avoids. Revisit only if the manual-apply step turns out to be a real bottleneck in practice.

## 6. Configuration plan

Accounts/credentials to obtain before first run:

1. **LLM provider** — OpenRouter (default), OpenAI, or Gemini API key, for scoring + tailoring.
2. **Reactive Resume** — either a hosted (rxresu.me) account or a self-hosted instance, plus the base resume built from [resume.pdf](../../../../../kingsoft_code/resume.pdf).
3. **Adzuna** — free developer account at developer.adzuna.com for `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`.
4. **Gmail OAuth** (optional, recommended) — Google Cloud OAuth client for recruiter-reply tracking.

Setup sequence:

1. `docker compose up -d` from `/Users/Side/code/job-apply`, complete the first-run onboarding wizard (LLM provider, RxResume, base resume selection).
2. In Settings → Environment & Accounts, add the Adzuna App ID/Key.
3. In Settings → Scoring Settings, configure any auto-skip threshold / company blocklist Side wants.
4. Run a manual **Automatic** pipeline run first (small budget, e.g. `Fast` preset) against Canada with LinkedIn + Indeed + Glassdoor + Adzuna sources — location `"Canada"` for JobSpy, the six-city list for Glassdoor (§5.4) — to validate end-to-end before automating anything.
5. Tune `JOBSPY_HOURS_OLD` and search terms based on the first run's discovered-job quality.
6. Only after step 4–5 look reasonable: add the cron schedule (§5.1) and the LinkedIn circuit breaker (§5.2).
7. Wire up the notification relay (§5.3).

## 7. Open questions

- **Resolved:** notification relay is WhatsApp, via CallMeBot (see §5.3).
- **Resolved:** search scope is nationwide Canada, not specific cities (see §5.4); Glassdoor's city requirement is worked around with a fixed six-city list.
- Self-host Reactive Resume, or use the hosted rxresu.me? Defaulting to **hosted rxresu.me** for the first pass (lowest setup friction); easy to switch to self-hosted later by setting `RXRESUME_URL`. Flag if you'd rather self-host from the start.
- Exact `JOBSPY_HOURS_OLD` value and precise search-term list (job titles) — to be tuned from the first manual pipeline run's output (§6 step 4-5), not fixed in advance.

## 8. Out of scope / explicitly rejected

- Full unattended auto-submit on any platform.
- Building a new job-search agent from scratch — superseded by this adoption plan.
- UK-specific features already in job-ops (visa sponsors, UKVisaJobs).
