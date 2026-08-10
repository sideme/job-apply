---
id: job-level-and-screening-roadmap
title: Job Level Filtering and Screening Roadmap
description: Implementation history and planned work for job-level search, eligibility checks, and job-fit scoring.
sidebar_position: 10
---

# What it is

This page is the durable feature record for job-level filtering and resume-to-job screening. It distinguishes three different signals:

1. **Eligibility gates**: work authorization, sponsorship, location, relocation, minimum experience, licences, and other employer-configured knockout questions.
2. **Required qualification coverage**: required skills, title, experience, education, and certification evidence that a recruiter or screening rule may search for.
3. **Job-fit estimate**: this project's local ranking signal for deciding which new jobs deserve attention. It is not an employer's ATS score or a predicted pass rate.

# Why it exists

ATS products are configurable and do not share a universal scoring formula. Greenhouse documents employer-configured [auto-reject application rules](https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject), while Workday documents both the traditional ATS functions—parsing, storage, filtering, and workflow—and newer [candidate matching](https://www.workday.com/en-us/topics/hr/applicant-tracking-system.html). Workday also states that its AI compares application qualifications with employer requirements while keeping the hiring decision under human control.

For that reason, a single percentage must not be presented as “the score the employer's ATS will give this resume.” The project uses a conservative job-fit estimate and will expose eligibility and required-qualification risks separately.

# How to use it

## Job-level search

Open a jobs page, choose **Filters**, then search the **Job level** dropdown. Select any combination and choose **Done**; **Clear** removes all level filters. The supported categories are Internship, Entry level, Associate, Mid level, Senior, Lead / Principal, Manager, Director / Head, and Executive.

Source labels such as `mid-senior level` are normalized. When a source supplies no useful level, explicit title evidence such as `Junior`, `Senior`, `Principal`, or `Engineering Manager` is used. A plain title such as `Software Engineer` remains unclassified instead of being guessed.

The API equivalent is:

```text
GET /api/jobs?level=entry_level,senior,lead&q=platform
```

## Screening interpretation

- Treat an eligibility conflict as a warning or hard gate only when the job requirement is explicit and the applicant configuration contains a definite answer.
- Treat required-skill coverage as evidence, not proof that an application will pass.
- Use the job-fit estimate to rank newly posted jobs. Automatic runs score only jobs inserted by that run; historical scores are not recomputed automatically.
- Use optional deep analysis only for a selected job. It may use the configured LLM and must remain cached or explicitly user-triggered.

## Implementation history

| Date | Status | Change | Verification |
| --- | --- | --- | --- |
| 2026-08-10 | Implemented | Added conservative local job-fit rules, a 95-point ceiling, confidence caps, and new-import-only automatic scoring. | Unit, route, pipeline, type, and client build checks. |
| 2026-08-10 | Implemented | Added normalized job-level categories, indexed server-side multi-filtering, a searchable multi-select UI, URL persistence, and title fallback. | Normalization, API, hook, and component tests. |
| 2026-08-10 | Documented | Renamed the product concept from an implied ATS pass score to a job-fit estimate with ATS-inspired evidence. | README and this feature record. |

## Planned work

| Priority | Status | Feature | Acceptance criteria |
| --- | --- | --- | --- |
| P0 | Planned | Eligibility / knockout risk engine | Compare explicit JD questions with `application-answers.json`; show pass, conflict, or unknown without guessing; never use protected demographic answers for ranking. |
| P0 | Planned | Required vs preferred qualification parser | Separate mandatory and preferred skills/credentials; show missing required evidence independently from the fit score. |
| P1 | Planned | Exact title and experience-range checks | Detect explicit title families and minimum years; explain every mismatch with source text. |
| P1 | Planned | Recruiter-search preview | Show a Boolean-style keyword coverage preview for role, hard skills, certifications, and standardized aliases. |
| P1 | Planned | Evidence recency and relevance | Prefer recent, role-relevant experience while avoiding penalties when dates are unavailable. |
| P1 | Planned | Score explanation UI | Show eligibility, required coverage, role/seniority, and optional semantic evidence separately; never label the result as employer pass probability. |
| P2 | Planned | Cached optional JD extraction | Use an LLM only when deterministic parsing is inconclusive; cache by JD hash and model; process new jobs only. |
| P2 | Planned | Calibration dataset | Let the user label good/bad matches and compare ranking quality without training on protected characteristics. |

# Common problems

## A level is missing

The source may not provide a level and the title may not contain reliable evidence. This is intentional; the system does not assume every unqualified `Software Engineer` title is mid-level.

## “Mid-Senior level” appears as Senior

This is a source taxonomy label. The current normalized category maps it to Senior so it is discoverable with the user's requested Senior filter. The original source value remains stored for provenance.

## The fit estimate differs from a resume-scanning website

There is no portable, industry-wide ATS percentage. Vendors, employer configurations, screening questions, recruiter searches, and optional AI products differ. Use the explanation and missing evidence, not the number alone.

## A knockout answer is sensitive

Work authorization and location answers may be used only to complete the application or evaluate explicit eligibility. Race, gender, disability, sexual orientation, and other protected or voluntary demographic information must never influence job ranking or eligibility scoring.

# Related pages

- [Local embedding scoring design](/docs/superpowers/specs/2026-08-08-local-embedding-scoring-design)
- [Browser application auto-fill configuration](../../README.md#browser-application-auto-fill)
- [Matching without per-job chat calls](../../README.md#matching-without-per-job-chat-calls)
