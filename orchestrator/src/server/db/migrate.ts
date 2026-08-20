/**
 * Database migration script - creates tables if they don't exist.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyJobEngagement } from "@shared/job-engagement";
import { inferJobLevel } from "@shared/job-level";
import Database from "better-sqlite3";
import { getDataDir } from "../config/dataDir";
import { buildDuplicateAssignments } from "../services/job-deduplication";
import { normalizePostingDate } from "../services/posting-date";

// Database path - can be overridden via env for Docker
const DB_PATH = join(getDataDir(), "jobs.db");

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
const existingJobsTable = sqlite
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'",
  )
  .get() as { sql?: string } | undefined;
const shouldRebuildJobsStatus = Boolean(
  existingJobsTable?.sql && !existingJobsTable.sql.includes("'in_progress'"),
);
const existingJobsFts = sqlite
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs_fts'",
  )
  .get() as { sql?: string } | undefined;
// Older databases indexed only title/employer/location. Rebuild the FTS table
// so keyword search also matches the job description (e.g. "spring", "kafka").
const shouldMigrateJobsFts = Boolean(
  existingJobsFts?.sql && !existingJobsFts.sql.includes("job_description"),
);
if (shouldMigrateJobsFts) {
  sqlite.exec("DROP TRIGGER IF EXISTS jobs_fts_after_insert");
  sqlite.exec("DROP TRIGGER IF EXISTS jobs_fts_after_delete");
  sqlite.exec("DROP TRIGGER IF EXISTS jobs_fts_after_update");
  sqlite.exec("DROP TABLE IF EXISTS jobs_fts");
}
const shouldInitializeJobsFts =
  shouldRebuildJobsStatus || shouldMigrateJobsFts || !existingJobsFts;

const migrations = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'gradcracker',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    date_posted_checked_at TEXT,
    duplicate_of_job_id TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_level_category TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    employment_type_category TEXT NOT NULL DEFAULT 'unknown',
    employment_type_reason TEXT,
    hiring_organization_category TEXT NOT NULL DEFAULT 'unknown',
    hiring_organization_reason TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired')),
    outcome TEXT,
    closed_at INTEGER,
    suitability_score REAL,
    suitability_reason TEXT,
    suitability_reason_source TEXT,
    semantic_score REAL,
    keyword_coverage REAL,
    keyword_missing TEXT,
    job_embedding TEXT,
    job_embedding_model TEXT,
    job_embedding_hash TEXT,
    llm_fit_score INTEGER,
    llm_fit_verdict TEXT,
    llm_fit_points TEXT,
    llm_fit_gaps TEXT,
    llm_fit_status TEXT,
    llm_fit_error TEXT,
    llm_fit_provider TEXT,
    llm_fit_model TEXT,
    llm_fit_prompt_version TEXT,
    llm_fit_input_hash TEXT,
    llm_fit_at TEXT,
    tailored_summary TEXT,
    tailored_headline TEXT,
    tailored_skills TEXT,
    selected_project_ids TEXT,
    pdf_path TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    pipeline_run_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('search_planner', 'fit_judge')),
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'partial', 'failed', 'cancelled', 'unavailable')),
    provider TEXT,
    model TEXT,
    prompt_version TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    local_date TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    stop_reason TEXT,
    error_code TEXT,
    error_message TEXT,
    searches_used INTEGER NOT NULL DEFAULT 0,
    judgments_used INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS agent_run_steps (
    id TEXT PRIMARY KEY,
    agent_run_id TEXT NOT NULL,
    job_id TEXT,
    iteration INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK(step_type IN ('llm', 'tool', 'stop', 'error')),
    tool_name TEXT,
    tool_call_id TEXT,
    args_summary TEXT,
    result_summary TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS agent_daily_usage (
    kind TEXT NOT NULL CHECK(kind IN ('search_planner', 'fit_judge')),
    local_date TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    runs_started INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    searches_used INTEGER NOT NULL DEFAULT 0,
    judgments_used INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, local_date, time_zone)
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_threads (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'partial' CHECK(status IN ('complete', 'partial', 'cancelled', 'failed')),
    tokens_in INTEGER,
    tokens_out INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    replaces_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
    model TEXT,
    provider TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS stage_events (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    group_id TEXT,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    metadata TEXT,
    outcome TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    due_date INTEGER,
    is_completed INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    duration_mins INTEGER,
    type TEXT NOT NULL,
    outcome TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_integrations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('disconnected', 'connected', 'error')),
    credentials TEXT,
    last_connected_at INTEGER,
    last_synced_at INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, account_key)
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_sync_runs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    integration_id TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    messages_discovered INTEGER NOT NULL DEFAULT 0,
    messages_relevant INTEGER NOT NULL DEFAULT 0,
    messages_classified INTEGER NOT NULL DEFAULT 0,
    messages_matched INTEGER NOT NULL DEFAULT 0,
    messages_approved INTEGER NOT NULL DEFAULT 0,
    messages_denied INTEGER NOT NULL DEFAULT 0,
    messages_errored INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (integration_id) REFERENCES post_application_integrations(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_messages (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    integration_id TEXT,
    sync_run_id TEXT,
    external_message_id TEXT NOT NULL,
    external_thread_id TEXT,
    from_address TEXT NOT NULL DEFAULT '',
    from_domain TEXT,
    sender_name TEXT,
    subject TEXT NOT NULL DEFAULT '',
    received_at INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    classification_label TEXT,
    classification_confidence REAL,
    classification_payload TEXT,
    relevance_llm_score REAL,
    relevance_decision TEXT NOT NULL DEFAULT 'needs_llm' CHECK(relevance_decision IN ('relevant', 'not_relevant', 'needs_llm')),
    match_confidence INTEGER,
    message_type TEXT NOT NULL DEFAULT 'other' CHECK(message_type IN ('interview', 'rejection', 'offer', 'update', 'other')),
    stage_event_payload TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending_user' CHECK(processing_status IN ('auto_linked', 'pending_user', 'manual_linked', 'ignored')),
    matched_job_id TEXT,
    decided_at INTEGER,
    decided_by TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (integration_id) REFERENCES post_application_integrations(id) ON DELETE SET NULL,
    FOREIGN KEY (sync_run_id) REFERENCES post_application_sync_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (matched_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
    UNIQUE(provider, account_key, external_message_id)
  )`,

  // Rename settings key: webhookUrl -> pipelineWebhookUrl (safe to re-run)
  `INSERT OR REPLACE INTO settings(key, value, created_at, updated_at)
   SELECT 'pipelineWebhookUrl', value, created_at, updated_at FROM settings WHERE key = 'webhookUrl'`,
  `DELETE FROM settings WHERE key = 'webhookUrl'`,
  // Drop legacy settings keys that are no longer read by the app.
  `DELETE FROM settings
   WHERE key IN (
     'jobspyHoursOld',
     'jobspySites',
     'jobspyLinkedinFetchDescription',
     'jobspyIsRemote',
     'openrouterApiKey'
   )`,

  // DeepSeek discontinued the legacy direct-API model aliases on 2026-07-24.
  // Migrate only direct DeepSeek configurations; other providers may use their
  // own routing aliases. Empty task overrides remain empty and keep inheriting.
  `UPDATE settings
   SET value = 'deepseek-v4-flash', updated_at = datetime('now')
   WHERE key IN ('model', 'modelScorer', 'modelTailoring', 'modelProjectSelection')
     AND value IN ('deepseek-chat', 'deepseek-reasoner')
     AND EXISTS (
       SELECT 1 FROM settings AS provider
       WHERE provider.key = 'llmProvider'
         AND lower(replace(provider.value, '-', '_')) = 'deepseek'
     )`,

  // Add source column for existing databases (safe to skip if already present)
  `ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'gradcracker'`,
  `UPDATE jobs SET source = 'gradcracker' WHERE source IS NULL OR source = ''`,

  // Add JobSpy columns for existing databases (safe to skip if already present)
  `ALTER TABLE jobs ADD COLUMN source_job_id TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_url_direct TEXT`,
  `ALTER TABLE jobs ADD COLUMN date_posted TEXT`,
  `ALTER TABLE jobs ADD COLUMN date_posted_checked_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN duplicate_of_job_id TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_source TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_interval TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_min_amount REAL`,
  `ALTER TABLE jobs ADD COLUMN salary_max_amount REAL`,
  `ALTER TABLE jobs ADD COLUMN salary_currency TEXT`,
  `ALTER TABLE jobs ADD COLUMN is_remote INTEGER`,
  `ALTER TABLE jobs ADD COLUMN job_level TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_level_category TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_function TEXT`,
  `ALTER TABLE jobs ADD COLUMN listing_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN emails TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_industry TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_logo TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_url_direct TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_addresses TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_num_employees TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_revenue TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_description TEXT`,
  `ALTER TABLE jobs ADD COLUMN skills TEXT`,
  `ALTER TABLE jobs ADD COLUMN experience_range TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_rating REAL`,
  `ALTER TABLE jobs ADD COLUMN company_reviews_count INTEGER`,
  `ALTER TABLE jobs ADD COLUMN vacancy_count INTEGER`,
  `ALTER TABLE jobs ADD COLUMN work_from_home_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN employment_type_category TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE jobs ADD COLUMN employment_type_reason TEXT`,
  `ALTER TABLE jobs ADD COLUMN hiring_organization_category TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE jobs ADD COLUMN hiring_organization_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_duplicate_of_job_id ON jobs(duplicate_of_job_id)`,
  `ALTER TABLE jobs ADD COLUMN selected_project_ids TEXT`,
  `ALTER TABLE jobs ADD COLUMN tailored_headline TEXT`,
  `ALTER TABLE jobs ADD COLUMN tailored_skills TEXT`,

  // Add application tracking columns
  `ALTER TABLE jobs ADD COLUMN outcome TEXT`,
  `ALTER TABLE jobs ADD COLUMN closed_at INTEGER`,
  `ALTER TABLE stage_events ADD COLUMN outcome TEXT`,
  `ALTER TABLE stage_events ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE stage_events ADD COLUMN group_id TEXT`,

  // Smart-router columns for existing databases.
  `ALTER TABLE post_application_messages ADD COLUMN match_confidence INTEGER`,
  `ALTER TABLE post_application_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'other' CHECK(message_type IN ('interview', 'rejection', 'offer', 'update', 'other'))`,
  `ALTER TABLE post_application_messages ADD COLUMN stage_event_payload TEXT`,
  `ALTER TABLE post_application_messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pending_user' CHECK(processing_status IN ('auto_linked', 'pending_user', 'manual_linked', 'ignored'))`,
  `UPDATE post_application_messages
   SET match_confidence = CAST(round(COALESCE(relevance_llm_score, 0)) AS INTEGER)
   WHERE match_confidence IS NULL`,
  `UPDATE post_application_messages
   SET message_type = CASE
      WHEN lower(COALESCE(classification_label, '')) LIKE '%interview%' THEN 'interview'
      WHEN lower(COALESCE(classification_label, '')) LIKE '%offer%' THEN 'offer'
      WHEN lower(COALESCE(classification_label, '')) LIKE '%reject%' THEN 'rejection'
      WHEN lower(COALESCE(classification_label, '')) IN ('false positive', 'did not apply - inbound request') THEN 'other'
      ELSE 'update'
   END`,
  `UPDATE post_application_messages
   SET processing_status = CASE
      WHEN review_status = 'approved' THEN 'manual_linked'
      WHEN review_status IN ('pending_review', 'no_reliable_match') THEN 'pending_user'
      ELSE 'ignored'
   END`,
  `DROP TABLE IF EXISTS post_application_message_candidates`,
  `DROP TABLE IF EXISTS post_application_message_links`,

  // Semantic scoring columns must exist before a legacy jobs table rebuild so
  // cached vectors and their model identifiers can be copied without loss.
  `ALTER TABLE jobs ADD COLUMN semantic_score REAL`,
  `ALTER TABLE jobs ADD COLUMN keyword_coverage REAL`,
  `ALTER TABLE jobs ADD COLUMN keyword_missing TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_embedding TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_embedding_model TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_embedding_hash TEXT`,
  `ALTER TABLE jobs ADD COLUMN suitability_reason_source TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_score INTEGER`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_verdict TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_points TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_gaps TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_status TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_error TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_provider TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_model TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_prompt_version TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_input_hash TEXT`,
  `ALTER TABLE jobs ADD COLUMN llm_fit_at TEXT`,

  // A completed DeepSeek Fit judgment is the primary ATS score. Keep the
  // local semantic and keyword columns as supporting, explainable signals.
  `UPDATE jobs
   SET
     suitability_score = llm_fit_score,
     suitability_reason = CASE
       WHEN lower(COALESCE(llm_fit_provider, '')) = 'deepseek'
         THEN 'DeepSeek ATS ' || llm_fit_score || ' · ' || COALESCE(llm_fit_verdict, 'fit') || ' · ' || COALESCE(llm_fit_model, 'model')
       ELSE COALESCE(llm_fit_provider, 'LLM') || ' ATS ' || llm_fit_score || ' · ' || COALESCE(llm_fit_verdict, 'fit') || ' · ' || COALESCE(llm_fit_model, 'model')
     END,
     suitability_reason_source = 'llm',
     updated_at = datetime('now')
   WHERE llm_fit_status = 'completed'
     AND llm_fit_score IS NOT NULL
     AND (
       suitability_score IS NULL
       OR suitability_score != llm_fit_score
       OR COALESCE(suitability_reason_source, '') != 'llm'
     )`,

  // Protect child tables (stage_events/tasks/interviews) during parent table rebuilds.
  // Without this, dropping/replacing `jobs` can cascade-delete historical stage data.
  `PRAGMA foreign_keys = OFF`,

  // Ensure pipeline_runs status supports "cancelled" for existing databases.
  `CREATE TABLE IF NOT EXISTS pipeline_runs_new (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`,
  `INSERT OR REPLACE INTO pipeline_runs_new (id, started_at, completed_at, status, jobs_discovered, jobs_processed, error_message)
   SELECT id, started_at, completed_at, status, jobs_discovered, jobs_processed, error_message
   FROM pipeline_runs`,
  `DROP TABLE IF EXISTS pipeline_runs`,
  `ALTER TABLE pipeline_runs_new RENAME TO pipeline_runs`,

  // Rebuild only legacy jobs tables whose status CHECK predates in_progress.
  // Rebuilding on every boot is both unnecessary and risks losing columns
  // added after the original migration was written.
  ...(shouldRebuildJobsStatus
    ? [
        `CREATE TABLE IF NOT EXISTS jobs_new (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'gradcracker',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    date_posted_checked_at TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_level_category TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    employment_type_category TEXT NOT NULL DEFAULT 'unknown',
    employment_type_reason TEXT,
    hiring_organization_category TEXT NOT NULL DEFAULT 'unknown',
    hiring_organization_reason TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired')),
    outcome TEXT,
    closed_at INTEGER,
    suitability_score REAL,
    suitability_reason TEXT,
    suitability_reason_source TEXT,
    semantic_score REAL,
    keyword_coverage REAL,
    keyword_missing TEXT,
    job_embedding TEXT,
    job_embedding_model TEXT,
    job_embedding_hash TEXT,
    llm_fit_score INTEGER,
    llm_fit_verdict TEXT,
    llm_fit_points TEXT,
    llm_fit_gaps TEXT,
    llm_fit_status TEXT,
    llm_fit_error TEXT,
    llm_fit_provider TEXT,
    llm_fit_model TEXT,
    llm_fit_prompt_version TEXT,
    llm_fit_input_hash TEXT,
    llm_fit_at TEXT,
    tailored_summary TEXT,
    tailored_headline TEXT,
    tailored_skills TEXT,
    selected_project_ids TEXT,
    pdf_path TEXT,
    duplicate_of_job_id TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
        `INSERT OR REPLACE INTO jobs_new (
    id, source, source_job_id, job_url_direct, date_posted, date_posted_checked_at, job_type, salary_source, salary_interval,
    salary_min_amount, salary_max_amount, salary_currency, is_remote, job_level, job_level_category, job_function, listing_type,
    emails, company_industry, company_logo, company_url_direct, company_addresses, company_num_employees,
    company_revenue, company_description, skills, experience_range, company_rating, company_reviews_count,
    vacancy_count, work_from_home_type, employment_type_category, employment_type_reason,
    hiring_organization_category, hiring_organization_reason,
    title, employer, employer_url, job_url, application_link, disciplines,
    deadline, salary, location, degree_required, starting, job_description, status, outcome, closed_at,
    suitability_score, suitability_reason, suitability_reason_source, semantic_score, keyword_coverage,
    keyword_missing, job_embedding, job_embedding_model, job_embedding_hash,
    llm_fit_score, llm_fit_verdict, llm_fit_points, llm_fit_gaps, llm_fit_status, llm_fit_error,
    llm_fit_provider, llm_fit_model, llm_fit_prompt_version, llm_fit_input_hash, llm_fit_at,
    tailored_summary, tailored_headline, tailored_skills,
    selected_project_ids, pdf_path, duplicate_of_job_id,
    discovered_at, processed_at,
    applied_at, created_at, updated_at
  )
  SELECT
    id, source, source_job_id, job_url_direct, date_posted, date_posted_checked_at, job_type, salary_source, salary_interval,
    salary_min_amount, salary_max_amount, salary_currency, is_remote, job_level, job_level_category, job_function, listing_type,
    emails, company_industry, company_logo, company_url_direct, company_addresses, company_num_employees,
    company_revenue, company_description, skills, experience_range, company_rating, company_reviews_count,
    vacancy_count, work_from_home_type, employment_type_category, employment_type_reason,
    hiring_organization_category, hiring_organization_reason,
    title, employer, employer_url, job_url, application_link, disciplines,
    deadline, salary, location, degree_required, starting, job_description, status, outcome, closed_at,
    suitability_score, suitability_reason, suitability_reason_source, semantic_score, keyword_coverage,
    keyword_missing, job_embedding, job_embedding_model, job_embedding_hash,
    llm_fit_score, llm_fit_verdict, llm_fit_points, llm_fit_gaps, llm_fit_status, llm_fit_error,
    llm_fit_provider, llm_fit_model, llm_fit_prompt_version, llm_fit_input_hash, llm_fit_at,
    tailored_summary, tailored_headline, tailored_skills,
    selected_project_ids, pdf_path, duplicate_of_job_id,
    discovered_at, processed_at,
    applied_at, created_at, updated_at
  FROM jobs`,
        `DROP TABLE IF EXISTS jobs`,
        `ALTER TABLE jobs_new RENAME TO jobs`,
      ]
    : []),
  `PRAGMA foreign_keys = ON`,

  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON jobs(discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_discovered_at ON jobs(status, discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_date_posted_score ON jobs(date_posted DESC, suitability_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_level_status_posted ON jobs(job_level_category, status, date_posted DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_employment_status_posted ON jobs(employment_type_category, status, date_posted DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_llm_fit_pending_score ON jobs(llm_fit_status, suitability_score DESC, date_posted DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_fit_queue ON jobs(llm_fit_status, status, suitability_score DESC, discovered_at DESC)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
    title,
    employer,
    location,
    job_description,
    content='jobs',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS jobs_fts_after_insert AFTER INSERT ON jobs BEGIN
    INSERT INTO jobs_fts(rowid, title, employer, location, job_description)
    VALUES (new.rowid, new.title, new.employer, COALESCE(new.location, ''), COALESCE(new.job_description, ''));
  END`,
  `CREATE TRIGGER IF NOT EXISTS jobs_fts_after_delete AFTER DELETE ON jobs BEGIN
    INSERT INTO jobs_fts(jobs_fts, rowid, title, employer, location, job_description)
    VALUES ('delete', old.rowid, old.title, old.employer, COALESCE(old.location, ''), COALESCE(old.job_description, ''));
  END`,
  `CREATE TRIGGER IF NOT EXISTS jobs_fts_after_update AFTER UPDATE OF title, employer, location, job_description ON jobs BEGIN
    INSERT INTO jobs_fts(jobs_fts, rowid, title, employer, location, job_description)
    VALUES ('delete', old.rowid, old.title, old.employer, COALESCE(old.location, ''), COALESCE(old.job_description, ''));
    INSERT INTO jobs_fts(rowid, title, employer, location, job_description)
    VALUES (new.rowid, new.title, new.employer, COALESCE(new.location, ''), COALESCE(new.job_description, ''));
  END`,
  `CREATE TABLE IF NOT EXISTS resume_embedding (
    hash TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    vector TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_kind_date_status ON agent_runs(kind, local_date, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_pipeline_run_id ON agent_runs(pipeline_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_sequence ON agent_run_steps(agent_run_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_steps_job_id ON agent_run_steps(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stage_events_application_id ON stage_events(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stage_events_occurred_at ON stage_events(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_application_id ON tasks(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_application_id ON interviews(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_app_sync_runs_provider_account_started_at ON post_application_sync_runs(provider, account_key, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_post_app_messages_provider_account_processing_status ON post_application_messages(provider, account_key, processing_status)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_threads_job_updated ON job_chat_threads(job_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_messages_thread_created ON job_chat_messages(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_runs_thread_status ON job_chat_runs(thread_id, status)`,
  // Ensure only one running run per thread; backfill any duplicates first.
  `WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY started_at DESC, id DESC) AS rank_in_thread
      FROM job_chat_runs
      WHERE status = 'running'
    )
    UPDATE job_chat_runs
    SET
      status = 'failed',
      error_code = COALESCE(error_code, 'CONFLICT'),
      error_message = COALESCE(error_message, 'Recovered duplicate running run during migration'),
      completed_at = COALESCE(completed_at, CAST(strftime('%s', 'now') AS INTEGER)),
      updated_at = datetime('now')
    WHERE id IN (SELECT id FROM ranked WHERE rank_in_thread > 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_chat_runs_thread_running_unique
   ON job_chat_runs(thread_id)
   WHERE status = 'running'`,

  // Backfill: Create "Applied" events for legacy jobs that have applied_at set but no event entry
  `INSERT INTO stage_events (id, application_id, title, from_stage, to_stage, occurred_at, metadata)
   SELECT
     'backfill-applied-' || id,
     id,
     'Applied',
     NULL,
     'applied',
     CAST(strftime('%s', applied_at) AS INTEGER),
     '{"eventLabel":"Applied","actor":"system"}'
   FROM jobs
   WHERE applied_at IS NOT NULL
     AND id NOT IN (SELECT application_id FROM stage_events WHERE to_stage = 'applied')`,

  // Backfill: Create "Closed" events for legacy jobs already closed via outcome.
  `INSERT INTO stage_events (id, application_id, title, from_stage, to_stage, occurred_at, metadata, outcome)
   SELECT
     'backfill-closed-' || jobs.id,
     jobs.id,
     'Closed',
     (
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ),
     'closed',
     COALESCE(
       jobs.closed_at,
       CAST(strftime('%s', jobs.applied_at) AS INTEGER),
       CAST(strftime('%s', jobs.updated_at) AS INTEGER),
       CAST(strftime('%s', jobs.discovered_at) AS INTEGER),
       CAST(strftime('%s', 'now') AS INTEGER)
     ),
     '{"eventLabel":"Closed","actor":"system"}',
     jobs.outcome
   FROM jobs
   WHERE jobs.outcome IS NOT NULL
     AND jobs.id NOT IN (SELECT application_id FROM stage_events WHERE to_stage = 'closed')`,

  // Backfill: Sync legacy workflow status from latest stage event.
  `UPDATE jobs
   SET
     status = 'in_progress',
     updated_at = datetime('now')
   WHERE status = 'applied'
     AND COALESCE((
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), 'applied') IN (
       'recruiter_screen',
       'assessment',
       'hiring_manager_screen',
       'technical_interview',
       'onsite',
       'offer',
       'closed'
     )`,

  // Backfill: Mark closed applications from latest stage event.
  `UPDATE jobs
   SET
     status = 'in_progress',
     closed_at = (
       SELECT se.occurred_at
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ),
     outcome = COALESCE((
       SELECT se.outcome
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), outcome),
     updated_at = datetime('now')
   WHERE status IN ('applied', 'in_progress')
     AND COALESCE((
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), 'applied') = 'closed'`,
];

console.log("🔧 Running database migrations...");

for (const migration of migrations) {
  try {
    sqlite.exec(migration);
    console.log("✅ Migration applied");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isDuplicateColumn =
      (migration.toLowerCase().includes("alter table jobs add column") ||
        migration.toLowerCase().includes("alter table tasks add column") ||
        migration
          .toLowerCase()
          .includes("alter table post_application_messages add column") ||
        migration
          .toLowerCase()
          .includes("alter table stage_events add column")) &&
      message.toLowerCase().includes("duplicate column name");

    if (isDuplicateColumn) {
      console.log("↩️ Migration skipped (column already exists)");
      continue;
    }

    const isLegacyBackfillOnFreshSchema =
      migration.toLowerCase().includes("update post_application_messages") &&
      message.toLowerCase().includes("no such column");
    if (isLegacyBackfillOnFreshSchema) {
      console.log("↩️ Migration skipped (legacy backfill not applicable)");
      continue;
    }

    // Optional performance-only migration: if this fails we should still boot
    // existing databases and continue without the index.
    const isOptionalOptimizationMigration = migration.includes(
      "idx_jobs_status_discovered_at",
    );
    if (isOptionalOptimizationMigration) {
      console.warn("⚠️ Optional migration skipped:", message);
      continue;
    }

    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

if (shouldInitializeJobsFts) {
  sqlite.exec("INSERT INTO jobs_fts(jobs_fts) VALUES('rebuild')");
  console.log("🔎 Jobs full-text search index initialized");
}

const jobLevelRows = sqlite
  .prepare(
    `SELECT id, job_level AS jobLevel, job_level_category AS jobLevelCategory, title
     FROM jobs`,
  )
  .all() as Array<{
  id: string;
  jobLevel: string | null;
  jobLevelCategory: string | null;
  title: string;
}>;
const updateJobLevelCategory = sqlite.prepare(
  "UPDATE jobs SET job_level_category = ? WHERE id = ?",
);
let normalizedJobLevels = 0;
const normalizeJobLevels = sqlite.transaction(() => {
  for (const row of jobLevelRows) {
    const category = inferJobLevel(row.jobLevel, row.title);
    if (category !== row.jobLevelCategory) {
      updateJobLevelCategory.run(category, row.id);
      normalizedJobLevels += 1;
    }
  }
});
normalizeJobLevels();
console.log(`📊 Job levels normalized: ${normalizedJobLevels}`);

const engagementRows = sqlite
  .prepare(
    `SELECT
      id,
      title,
      employer,
      job_type AS jobType,
      listing_type AS listingType,
      job_description AS jobDescription,
      company_description AS companyDescription,
      employment_type_category AS employmentTypeCategory,
      employment_type_reason AS employmentTypeReason,
      hiring_organization_category AS hiringOrganizationCategory,
      hiring_organization_reason AS hiringOrganizationReason
    FROM jobs`,
  )
  .all() as Array<{
  id: string;
  title: string;
  employer: string;
  jobType: string | null;
  listingType: string | null;
  jobDescription: string | null;
  companyDescription: string | null;
  employmentTypeCategory: string | null;
  employmentTypeReason: string | null;
  hiringOrganizationCategory: string | null;
  hiringOrganizationReason: string | null;
}>;
const updateJobEngagement = sqlite.prepare(
  `UPDATE jobs
   SET employment_type_category = ?, employment_type_reason = ?,
       hiring_organization_category = ?, hiring_organization_reason = ?
   WHERE id = ?`,
);
let normalizedJobEngagements = 0;
const normalizeJobEngagements = sqlite.transaction(() => {
  for (const row of engagementRows) {
    const classification = classifyJobEngagement(row);
    if (
      classification.employmentTypeCategory !== row.employmentTypeCategory ||
      classification.employmentTypeReason !== row.employmentTypeReason ||
      classification.hiringOrganizationCategory !==
        row.hiringOrganizationCategory ||
      classification.hiringOrganizationReason !== row.hiringOrganizationReason
    ) {
      updateJobEngagement.run(
        classification.employmentTypeCategory,
        classification.employmentTypeReason,
        classification.hiringOrganizationCategory,
        classification.hiringOrganizationReason,
        row.id,
      );
      normalizedJobEngagements += 1;
    }
  }
});
normalizeJobEngagements();
console.log(`💼 Job engagement types normalized: ${normalizedJobEngagements}`);

const postingDateRows = sqlite
  .prepare(
    "SELECT id, date_posted AS datePosted FROM jobs WHERE date_posted IS NOT NULL",
  )
  .all() as Array<{ id: string; datePosted: string }>;
const updatePostingDate = sqlite.prepare(
  "UPDATE jobs SET date_posted = ? WHERE id = ?",
);
let normalizedPostingDates = 0;
const normalizePostingDates = sqlite.transaction(() => {
  for (const row of postingDateRows) {
    const normalized = normalizePostingDate(row.datePosted);
    if (normalized && normalized !== row.datePosted) {
      updatePostingDate.run(normalized, row.id);
      normalizedPostingDates += 1;
    }
  }
});
normalizePostingDates();
console.log(`🕒 Posting dates normalized: ${normalizedPostingDates}`);

const dedupeRows = sqlite
  .prepare(
    `SELECT
      id, source, source_job_id AS sourceJobId, title, employer, location, date_posted AS datePosted,
      job_url AS jobUrl, job_url_direct AS jobUrlDirect,
      application_link AS applicationLink, status,
      suitability_score AS suitabilityScore,
      job_description AS jobDescription
    FROM jobs`,
  )
  .all() as Array<{
  id: string;
  source: string;
  sourceJobId: string | null;
  title: string;
  employer: string;
  location: string | null;
  datePosted: string | null;
  jobUrl: string;
  jobUrlDirect: string | null;
  applicationLink: string | null;
  status: string;
  suitabilityScore: number | null;
  jobDescription: string | null;
}>;
const duplicateAssignments = buildDuplicateAssignments(dedupeRows);
const refreshDuplicateMarkers = sqlite.transaction(() => {
  sqlite.prepare("UPDATE jobs SET duplicate_of_job_id = NULL").run();
  const markDuplicate = sqlite.prepare(
    "UPDATE jobs SET duplicate_of_job_id = ? WHERE id = ?",
  );
  for (const assignment of duplicateAssignments) {
    markDuplicate.run(assignment.winnerId, assignment.duplicateId);
  }
});
refreshDuplicateMarkers();
console.log(
  `🔁 Cross-source duplicate filter: ${duplicateAssignments.length} hidden`,
);

sqlite.close();
console.log("🎉 Database migrations complete!");
