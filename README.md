# job-apply

Personal, self-hosted job search pipeline for the Canadian market: discovers postings (LinkedIn/Indeed via JobSpy, plus optional Adzuna), scores fit against a resume, and manages a local PDF resume. The browser extension can fill configured answers and submit only after an explicit review checkbox and confirmation click.

The Jobs screen loads 60 postings at a time and exposes **Load more jobs** when additional matches exist. Search runs against a local SQLite FTS5 index over title, company, and location, so it does not call an LLM or consume tokens. Multiple search words must all match; partial word prefixes such as `develop` match `developer`.

Forked from [job-ops](https://github.com/DaKheera47/job-ops) and trimmed down to only what's needed here (dropped the UK-specific extractors, the public docs site, and unused sources). No shared git history with upstream by design.

See [docs/superpowers/specs](docs/superpowers/specs) for the requirements/design doc and [docs/superpowers/plans](docs/superpowers/plans) for the active implementation plan.

## Setup

```bash
docker compose up -d
```

Then open `http://localhost:3005` and follow the onboarding wizard. Upload your PDF in Settings → Local PDF Resume. The file is stored at `data/resume.pdf` by default and copied unchanged into each application package; no RxResume account is required. `RESUME_PDF_PATH` can point to another PDF location. See `AGENTS.md` for development conventions and CI-parity checks.

When a source supplies a full posting timestamp, the Jobs list and job detail header show the date, time, and timezone. Every source date is normalized to epoch milliseconds before storage so newest-first ordering stays correct across Indeed, LinkedIn, and Adzuna. JobSpy usually supplies only a calendar date, so newly imported Indeed and LinkedIn jobs also get a safe detail-page check for structured `JobPosting.datePosted` metadata. On an older job, choose **Find exact time** in the detail header to retry manually. If the listing page blocks access or only contains a date, the UI keeps **time not provided** rather than inventing a timestamp.

Jobs are deduplicated automatically when their canonical URL matches, or when their normalized title, employer, location, and posting date identify the same role. Same-source results require a matching source ID or a near-identical job description, preserving legitimate parallel openings that share a generic title. The richer copy stays visible, and historical duplicate records are retained internally so existing application history is not deleted. New duplicates in the same import are skipped.

Automatic runs discover and score jobs only. Tailoring is off by default and is performed only after an explicit per-job action, preventing scheduled discovery from consuming chat-model tokens.

## Optional recurring discovery

After setting your search terms, country, and city list in **Run Jobs**, enable the scheduler:

```bash
docker compose --profile scheduler up -d
```

It searches Indeed every hour and includes LinkedIn every three hours by default. Glassdoor, the legacy UK sponsor workflow, and tracer links are not part of this Canadian build. Scheduler timestamps are persisted in `data/pipeline-scheduler-state.json`, so rebuilding or restarting the container does not trigger an early repeat. Set `PIPELINE_SCHEDULE_CORE_MINUTES` and `PIPELINE_SCHEDULE_LINKEDIN_MINUTES` in `.env` to change the cadence. Keep the LinkedIn interval relatively conservative to reduce account-risk exposure.

## WhatsApp notifications

Open **Settings → Notifications & Webhooks**, enable WhatsApp, enter your phone number including country code and your personal CallMeBot API key, save, then choose **Send test notification**. The key is stored as a secret and is never returned to the browser after saving. Pipeline completion, failure, and LinkedIn cooldown events are sent directly; the older `notifications` relay profile remains available only for webhook-based setups.

CallMeBot is intended for personal notifications and requires a one-time WhatsApp opt-in before it issues an API key. Without a phone number and API key, job discovery and the scheduler continue normally, but WhatsApp delivery remains disabled.

## Browser application auto-fill

Load `browser-extension/` as an unpacked Chrome/Edge extension. On a job page in Job Apply, choose **Prepare auto-fill** to copy a 30-minute encrypted code. The code survives a Job Apply service restart and contains no readable job data. Open the employer's application form, open the **Job Apply Auto-fill** extension, paste the code, and choose **Fill this page**.

The extension detects native and React-controlled text fields, selects, radio buttons, checkboxes, content-editable fields, common ARIA comboboxes, same-origin embedded forms, Shadow DOM fields, and PDF resume inputs. It fills only answers resolved from `data/application-answers.json`; unknown questions are never guessed. Use `applicant` for identity/contact fields and `customAnswers` for company-specific questions:

```json
{
  "applicant": {
    "firstName": "Your first name",
    "lastName": "Your last name",
    "email": "you@example.com",
    "phone": "+1 416 555 0100",
    "city": "Toronto",
    "province": "Ontario",
    "country": "Canada",
    "postalCode": "M5V 2T6",
    "linkedinUrl": "https://www.linkedin.com/in/your-profile"
  },
  "customAnswers": [
    { "match": "available to start", "value": "Two weeks after offer" }
  ]
}
```

After filling, choose **Recheck page**. Submission remains blocked if the fill plan has unresolved questions, a required field is empty, a CAPTCHA is visible, or the final Submit button is ambiguous. When the review passes, tick the confirmation checkbox and choose **Confirm and submit application**. Verify the employer's confirmation page afterward. Multi-step forms can be filled one page at a time by choosing **Fill this page** again.

## Matching without per-job chat calls

Job scoring works without an LLM chat key: it detects skills in the local PDF resume and each job description, then ranks by keyword coverage. Embedding scoring is off by default. If you explicitly enable it and configure a dedicated OpenAI-compatible embedding provider, base URL, model, and key in Settings → Models & AI, it combines semantic similarity (default 70%) with keyword coverage. It never inherits the chat-model key.

Resume vectors are cached by the exact truncated resume text and model. Job vectors are cached by the exact truncated job text and model, and survive application restarts. The defaults send at most 6,000 characters per document and permit at most 20 uncached job-vector API requests per automatic run. Cache hits do not count against that limit; excess uncached jobs use keyword-only scoring for that run. Changing the matching weight reuses the cached vectors and makes no new embedding request.

Use **Recalculate match** for the inexpensive local recomputation. Use **Deep analysis** only for a job you are reviewing; it intentionally uses the configured chat LLM to write a richer rationale.
