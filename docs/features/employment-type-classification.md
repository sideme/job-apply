---
id: employment-type-classification
title: Employment and Hiring-Organization Markers
description: Filter permanent, full-time, and contract jobs and review company context in job details.
sidebar_position: 11
---

# What it is

Every imported job receives two conservative, deterministic classifications:

- Employment type: Permanent · Full-time, Full-time, Contract, Temporary, Part-time, Internship / Co-op, or Unknown.
- Hiring organization: Staffing agency, Consulting firm, or Unknown.

The Jobs list displays only known values. Permanent · Full-time is highlighted as the preferred type; contract and non-direct hiring signals use warning colors.

The Filters drawer provides a searchable multi-select for employment types. Job details also show an **About company** section when the source supplies a company profile or the job description contains an explicit company section.

# Why it exists

Source employment metadata is often incomplete, while the job title or description may explicitly say that a position is a fixed-term contract or that a recruiter is hiring for a client. Showing these signals in the list makes it possible to prioritize permanent full-time jobs before opening every description.

Classification is local and does not call an LLM. It does not modify the ATS score, automatically skip jobs, or use the absence of staffing language as proof that an employer is direct.

# How to use it

1. Open any Jobs tab.
2. Choose **Filters → Employment type**.
3. Search for and select one or more types, such as **Permanent · Full-time**, **Full-time**, and **Contract**, then choose **Done**. Multiple selected types are combined.
4. The selection is stored in the page URL as `employment=...`, so a filtered view can be bookmarked or shared.
5. Look below the employer and location on each row. Prefer the green **Permanent · Full-time** marker when permanence is explicit.
6. Treat **Full-time** as full-time with permanence not stated. Review amber **Contract** and purple **Staffing agency** or **Consulting firm** markers before applying.
7. Open a job to read **About {company}** when company context is available. **Source profile** means the job source supplied it; **From job post** means it was extracted from an explicit company section in the JD.

New jobs are classified during import. Existing jobs are backfilled when database migrations run. Editing a title, employer, or job description refreshes the classification.

Employment-type filtering runs in the database before counts and pagination. Types use OR semantics with one another and AND semantics with date, source, job-level, and text-search filters.

# Common problems

## No marker is shown

The source and description did not provide enough explicit evidence. The system keeps the type unknown instead of assuming a full-time role is permanent.

## “Contract” appears in a technical description

Generic phrases such as `API contracts` and `contract testing` are intentionally ignored. Contract employment requires source metadata or an explicit phrase such as `12-month contract`, `contract position`, or `fixed-term`.

## A consulting company is not detected

The current rules require an explicit consulting/advisory signal in the employer name or description. The system does not maintain an opaque company blacklist and does not guess from client-facing work alone.

## No company description is shown

The source did not provide a company profile and the JD did not contain a clearly labelled section such as `About the company`, `About us`, `Who we are`, or `Company overview`. The system intentionally avoids using unrelated opening text as a guessed company description.

## The marker differs from the original listing

The source may have changed or supplied conflicting metadata. Open the original listing before applying; the marker is a review aid, not a legal employment classification.

# Related pages

- [Job level filtering and screening](/docs/features/job-level-and-screening-roadmap)
- [Discovered date filtering](/docs/features/discovered-date-filter)
- [Agentic discovery and fit judging](/docs/features/agentic-discovery)
