# Job Ops Orchestrator

A unified orchestrator for a personal job-search pipeline. It discovers jobs, scores them against a local PDF resume, supports optional AI-assisted review, and provides a UI to manage applications.

## Architecture

```
orchestrator/
├── src/
│   ├── server/           # Express backend
│   │   ├── api/          # REST API routes
│   │   ├── db/           # SQLite + Drizzle ORM
│   │   ├── pipeline/     # Orchestration logic
│   │   ├── repositories/ # Data access layer
│   │   └── services/     # Integrations (crawler, AI, PDF)
│   ├── client/           # React frontend
│   │   ├── api/          # API client
│   │   ├── components/   # UI components
│   │   └── styles/       # CSS design system
│   └── shared/           # Shared types
├── data/                 # SQLite DB + generated PDFs (gitignored)
└── public/               # Static assets
```

## Setup

1. **Install dependencies:**
   ```bash
   cd orchestrator
   npm install
   ```

2. **Set up environment:**
    ```bash
    cp .env.example .env
    # The app is self-configuring. You can add keys via the UI Onboarding.
    ```

   After the server starts, upload your PDF resume in Settings → Local PDF Resume. An LLM provider is optional.

   OpenRouter is the default LLM provider, but OpenAI, LM Studio, Ollama, `openai-compatible` endpoints, Gemini, DeepSeek, and Qwen are also supported.

   Use `LLM_API_KEY` / `llmApiKey` to configure providers that require an API key.
   The API key is optional during initial setup. In the default hybrid flow, job discovery, keyword-based scoring, and configured application answers can run without a cloud LLM key; adding a key later enables semantic scoring and resume tailoring.
   To use the native OpenAI integration, set `LLM_PROVIDER=openai`.
   For third-party services that expose an OpenAI-style API but are not OpenAI itself, use `LLM_PROVIDER=openai-compatible`.
   DeepSeek uses `LLM_PROVIDER=deepseek` with `https://api.deepseek.com`; Qwen uses `LLM_PROVIDER=qwen` with Alibaba Cloud Model Studio's compatible endpoint. Both use `LLM_API_KEY`.

   In **Settings → Model**, you can add ordered **Company Model Rules**. A rule
   matches a company name or domain and can override the scoring, tailoring, or
   project-selection model for that company. Rules reuse the configured
   provider, base URL, and API key; the first matching rule wins, so put more
   specific companies first.

3. **Initialize database:**
   ```bash
   npm run db:migrate
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

    This starts:
   - Backend API at `http://localhost:3001`
   - Frontend at `http://localhost:5173`

## API Endpoints

### Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs (filter with `?status=ready,discovered`; search with `?q=backend`, which returns the latest 100 matches) |
| GET | `/api/jobs/:id` | Get single job |
| PATCH | `/api/jobs/:id` | Update job |
| POST | `/api/jobs/actions` | Run job actions (`move_to_ready`, `rescore`, `skip`) for one or many jobs |
| POST | `/api/jobs/actions/stream` | Stream job action progress/events for one or many jobs |
| POST | `/api/jobs/:id/apply` | Mark as applied |
| POST | `/api/jobs/:id/application-fill-plan` | Resolve captured form questions against local answers; never submits a form |

### Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/status` | Get pipeline status |
| GET | `/api/pipeline/runs` | Get recent pipeline runs |
| POST | `/api/pipeline/run` | Trigger pipeline manually |
| POST | `/api/webhook/trigger` | Webhook for n8n (use `WEBHOOK_SECRET`) |

### Post-Application Tracking

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/post-application/inbox` | List pending messages for review |
| POST | `/api/post-application/inbox/:id/approve` | Approve and link to job |
| POST | `/api/post-application/inbox/:id/deny` | Ignore message |
| GET | `/api/post-application/runs` | List sync run history |
| GET | `/api/post-application/providers/gmail/oauth/start` | Initiate Gmail OAuth flow |
| POST | `/api/post-application/providers/gmail/oauth/exchange` | Exchange OAuth code |

## Daily Flow

1. **Discover fresh jobs:**
   - In **Run Jobs**, set keywords, country, and cities, then search Indeed, LinkedIn, Glassdoor, and optionally Adzuna.
   - Discovery and keyword-based scoring work without an LLM API key.
   - To run recurring searches, start the optional scheduler with `docker compose --profile scheduler up -d`. It runs Indeed/Glassdoor hourly and LinkedIn every three hours by default.

2. **You review in the UI:**
   - See jobs at `http://localhost:3005`
   - Use the **Ready** tab to review suitable jobs and download your local PDF resume.
   - Use command bar search (`Cmd/Ctrl+K`) to quickly find and open jobs. Text search is debounced and runs on the server; results are ordered newest-first and the URL query can be shared or refreshed safely.
   - Use `@ready`, `@discovered`, or another status alias in the command bar when you want to lock results to a workflow state.
   - Click "View Job" to open the original application page.
   - Download the PDF and apply manually.
   - Click "Mark Applied" to mark application status

### Application answer configuration

The application form adapter reads explicit answers from
`data/application-answers.json`. Start from
`config/application-answers.example.json` and copy it to the data directory.
Set `enabled` to `true` only after reviewing every value. The resolver answers
work-authorization, permit, sponsorship, salary, and relocation questions only
when the configured value matches the detected form options; unknown or
ambiguous questions remain blocked for manual review. You can override the
path with `APPLICATION_ANSWERS_FILE`.

The optional `demographics` section supports gender, sex at birth, gender
identity, sexual orientation, race/ethnicity, Indigenous identity, disability,
veteran status, pronouns, and languages. It is disabled by default and must be
enabled separately. Use `prefer_not_to_say` when you do not want to disclose a
field; do not assume that every demographic question should be answered just
because the form displays it.

When an adapter captures a form, it can call
`POST /api/jobs/:id/application-fill-plan` with its detected fields. The result
contains only safe, configured answers plus an `unresolved` list for manual
review. It never guesses an answer and it always returns `submission.allowed:
false`: external-site submission must remain a deliberate, human-confirmed
action.

### WhatsApp notifications (optional)

The optional relay forwards the existing Job Complete webhook to WhatsApp via
CallMeBot. Add `CALLMEBOT_PHONE`, `CALLMEBOT_API_KEY`, and
`WHATSAPP_RELAY_SECRET` (or `WEBHOOK_SECRET`) to `.env`, then start it with:

```bash
docker compose --profile notifications up -d
```

Set **Job Complete Webhook URL** in Settings to
`http://whatsapp-relay:8787`. The relay accepts only authenticated requests and
is not exposed on the host network. It forwards a minimal job-completed event;
it does not send your resume or application answers.

3. **Track responses (optional):**
   - Connect Gmail in Tracking Inbox settings
   - Automatic email monitoring for interview invites, offers, rejections
   - Review and approve/ignore matched emails in the Inbox

## Optional external trigger

An external scheduler or n8n can trigger a run with:

```text
POST http://localhost:3005/api/webhook/trigger
Authorization: Bearer YOUR_WEBHOOK_SECRET
```

For most local installations, the bundled Docker scheduler is simpler and does not require n8n.

## Development

```bash
# Run just the server
npm run dev:server

# Run just the client
npm run dev:client

# Run the pipeline manually
npm run pipeline:run

# Build for production
npm run build
npm start
```

## Tech Stack

- **Backend:** Express, TypeScript, Drizzle ORM, SQLite
- **Frontend:** React, Vite, CSS (custom design system)
- **AI:** Configurable LLM provider (OpenRouter default; also supports OpenAI via the dedicated `openai` provider, `openai-compatible` endpoints, Gemini, LM Studio, and Ollama)
- **Application PDF:** Uploaded local PDF resume, copied unchanged per job (Settings → Local PDF Resume)
- **Job discovery:** JobSpy for Indeed, LinkedIn, and Glassdoor; optional Adzuna API integration
