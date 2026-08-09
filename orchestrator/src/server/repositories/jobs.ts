/**
 * Job repository - data access layer for jobs.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateJobInput,
  Job,
  JobListItem,
  JobStatus,
  JobsRevisionResponse,
  UpdateJobInput,
} from "@shared/types";
import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "../db/index";
import { createJobDuplicateIndex } from "../services/job-deduplication";
import { normalizePostingDate } from "../services/posting-date";

const { jobs } = schema;

function normalizeStatusFilter(statuses?: JobStatus[]): string | null {
  if (!statuses || statuses.length === 0) return null;
  return Array.from(new Set(statuses)).sort().join(",");
}

function normalizeSearch(search?: string): string | null {
  const normalized = search?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized ? normalized : null;
}

export function buildJobsFtsQuery(search?: string): string | null {
  const normalized = normalizeSearch(search);
  if (!normalized) return null;

  const terms = normalized
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 12);
  if (!terms || terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

function buildSearchClause(search?: string) {
  const ftsQuery = buildJobsFtsQuery(search);
  if (!ftsQuery) return undefined;
  return sql`jobs.rowid IN (
    SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ${ftsQuery}
  )`;
}

function buildJobsWhere(statuses?: JobStatus[], search?: string) {
  const statusClause =
    statuses && statuses.length > 0
      ? inArray(jobs.status, statuses)
      : undefined;
  const searchClause = buildSearchClause(search);

  return and(isNull(jobs.duplicateOfJobId), statusClause, searchClause);
}

/**
 * Get all jobs, optionally filtered by status.
 */
export async function getAllJobs(
  statuses?: JobStatus[],
  search?: string,
  limit?: number,
  offset = 0,
): Promise<Job[]> {
  const whereClause = buildJobsWhere(statuses, search);
  const baseQuery = db.select().from(jobs);
  const filteredQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;
  const orderedQuery = filteredQuery.orderBy(desc(jobs.discoveredAt));
  const query =
    typeof limit === "number"
      ? orderedQuery.limit(limit).offset(offset)
      : orderedQuery;

  const rows = await query;
  return rows.map(mapRowToJob);
}

/**
 * Get lightweight list items for jobs, optionally filtered by status.
 */
export async function getJobListItems(
  statuses?: JobStatus[],
  search?: string,
  limit?: number,
  offset = 0,
): Promise<JobListItem[]> {
  const selection = {
    id: jobs.id,
    source: jobs.source,
    title: jobs.title,
    employer: jobs.employer,
    jobUrl: jobs.jobUrl,
    applicationLink: jobs.applicationLink,
    datePosted: jobs.datePosted,
    deadline: jobs.deadline,
    salary: jobs.salary,
    location: jobs.location,
    status: jobs.status,
    outcome: jobs.outcome,
    closedAt: jobs.closedAt,
    suitabilityScore: jobs.suitabilityScore,
    semanticScore: jobs.semanticScore,
    keywordCoverage: jobs.keywordCoverage,
    keywordMissing: jobs.keywordMissing,
    suitabilityReasonSource: jobs.suitabilityReasonSource,
    sponsorMatchScore: jobs.sponsorMatchScore,
    jobType: jobs.jobType,
    jobFunction: jobs.jobFunction,
    salaryMinAmount: jobs.salaryMinAmount,
    salaryMaxAmount: jobs.salaryMaxAmount,
    salaryCurrency: jobs.salaryCurrency,
    discoveredAt: jobs.discoveredAt,
    appliedAt: jobs.appliedAt,
    updatedAt: jobs.updatedAt,
  } as const;

  const whereClause = buildJobsWhere(statuses, search);
  const baseQuery = db.select(selection).from(jobs);
  const filteredQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;
  // Freshest posting first, then best match within the same post date.
  // date_posted holds fixed-width epoch-ms values as text, so a text DESC sorts
  // them chronologically; NULL (undated) jobs sort last under DESC.
  const orderedQuery = filteredQuery.orderBy(
    desc(jobs.datePosted),
    desc(jobs.suitabilityScore),
  );
  const query =
    typeof limit === "number"
      ? orderedQuery.limit(limit).offset(offset)
      : orderedQuery;

  const rows = await query;
  return rows.map((row) => ({
    ...row,
    source: row.source as JobListItem["source"],
    status: row.status as JobStatus,
  }));
}

/**
 * Get a lightweight revision token for jobs list invalidation.
 */
export async function getJobsRevision(
  statuses?: JobStatus[],
  search?: string,
): Promise<JobsRevisionResponse> {
  const statusFilter = normalizeStatusFilter(statuses);
  const whereClause = buildJobsWhere(statuses, search);

  const baseQuery = db
    .select({
      latestUpdatedAt: sql<string | null>`max(${jobs.updatedAt})`,
      total: sql<number>`count(*)`,
    })
    .from(jobs);
  const [row] = whereClause
    ? await baseQuery.where(whereClause)
    : await baseQuery;

  const latestUpdatedAt = row?.latestUpdatedAt ?? null;
  const total = row?.total ?? 0;
  const normalizedSearch = normalizeSearch(search);
  const revision = `${latestUpdatedAt ?? "none"}:${total}:${statusFilter ?? "all"}:${normalizedSearch ?? ""}`;

  return {
    revision,
    latestUpdatedAt,
    total,
    statusFilter,
  };
}

export async function getJobCount(
  statuses?: JobStatus[],
  search?: string,
): Promise<number> {
  const whereClause = buildJobsWhere(statuses, search);
  const baseQuery = db.select({ count: sql<number>`count(*)` }).from(jobs);
  const [row] = whereClause
    ? await baseQuery.where(whereClause)
    : await baseQuery;
  return row?.count ?? 0;
}

/**
 * Get a single job by ID.
 */
export async function getJobById(id: string): Promise<Job | null> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ? mapRowToJob(row) : null;
}

export async function listJobSummariesByIds(jobIds: string[]): Promise<
  Array<{
    id: string;
    title: string;
    employer: string;
  }>
> {
  if (jobIds.length === 0) return [];

  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      employer: jobs.employer,
    })
    .from(jobs)
    .where(inArray(jobs.id, jobIds));
}

/**
 * Get a job by its URL (for deduplication).
 */
export async function getJobByUrl(jobUrl: string): Promise<Job | null> {
  const [row] = await db.select().from(jobs).where(eq(jobs.jobUrl, jobUrl));
  return row ? mapRowToJob(row) : null;
}

/**
 * Get all known job URLs (for deduplication / crawler optimizations).
 */
export async function getAllJobUrls(): Promise<string[]> {
  const rows = await db.select({ jobUrl: jobs.jobUrl }).from(jobs);
  return rows.map((r) => r.jobUrl);
}

async function insertJob(input: CreateJobInput): Promise<Job> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(jobs).values({
    id,
    source: input.source,
    sourceJobId: input.sourceJobId ?? null,
    jobUrlDirect: input.jobUrlDirect ?? null,
    datePosted: normalizePostingDate(input.datePosted),
    datePostedCheckedAt: null,
    duplicateOfJobId: null,
    title: input.title,
    employer: input.employer,
    employerUrl: input.employerUrl ?? null,
    jobUrl: input.jobUrl,
    applicationLink: input.applicationLink ?? null,
    disciplines: input.disciplines ?? null,
    deadline: input.deadline ?? null,
    salary: input.salary ?? null,
    location: input.location ?? null,
    degreeRequired: input.degreeRequired ?? null,
    starting: input.starting ?? null,
    jobDescription: input.jobDescription ?? null,
    jobType: input.jobType ?? null,
    salarySource: input.salarySource ?? null,
    salaryInterval: input.salaryInterval ?? null,
    salaryMinAmount: input.salaryMinAmount ?? null,
    salaryMaxAmount: input.salaryMaxAmount ?? null,
    salaryCurrency: input.salaryCurrency ?? null,
    isRemote: input.isRemote ?? null,
    jobLevel: input.jobLevel ?? null,
    jobFunction: input.jobFunction ?? null,
    listingType: input.listingType ?? null,
    emails: input.emails ?? null,
    companyIndustry: input.companyIndustry ?? null,
    companyLogo: input.companyLogo ?? null,
    companyUrlDirect: input.companyUrlDirect ?? null,
    companyAddresses: input.companyAddresses ?? null,
    companyNumEmployees: input.companyNumEmployees ?? null,
    companyRevenue: input.companyRevenue ?? null,
    companyDescription: input.companyDescription ?? null,
    skills: input.skills ?? null,
    experienceRange: input.experienceRange ?? null,
    companyRating: input.companyRating ?? null,
    companyReviewsCount: input.companyReviewsCount ?? null,
    vacancyCount: input.vacancyCount ?? null,
    workFromHomeType: input.workFromHomeType ?? null,
    status: "discovered",
    discoveredAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const job = await getJobById(id);
  if (!job) {
    throw new Error(`Failed to retrieve newly created job with ID ${id}`);
  }
  return job;
}

function isJobUrlUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed: jobs\.job_url/i.test(error.message);
}

async function tryInsertJob(input: CreateJobInput): Promise<Job | null> {
  try {
    return await insertJob(input);
  } catch (error) {
    if (isJobUrlUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * Create jobs (or return existing jobs for duplicate URLs).
 */
export async function createJobs(input: CreateJobInput): Promise<Job>;
export async function createJobs(
  inputs: CreateJobInput[],
): Promise<{ created: number; skipped: number }>;
export async function createJobs(
  inputOrInputs: CreateJobInput | CreateJobInput[],
): Promise<Job | { created: number; skipped: number }> {
  if (!Array.isArray(inputOrInputs)) {
    const inserted = await tryInsertJob(inputOrInputs);
    if (inserted) return inserted;
    const existing = await getJobByUrl(inputOrInputs.jobUrl);
    if (existing) return existing;
    throw new Error("Failed to create or resolve existing job by URL");
  }

  const byUrl = new Map<
    string,
    {
      input: CreateJobInput;
      count: number;
    }
  >();

  for (const input of inputOrInputs) {
    const existing = byUrl.get(input.jobUrl);
    if (existing) {
      existing.count += 1;
    } else {
      byUrl.set(input.jobUrl, { input, count: 1 });
    }
  }

  let created = 0;
  let skipped = 0;

  const uniqueUrls = Array.from(byUrl.keys());
  if (uniqueUrls.length === 0) {
    return { created, skipped };
  }

  const existingRows = await db
    .select({
      id: jobs.id,
      source: jobs.source,
      sourceJobId: jobs.sourceJobId,
      title: jobs.title,
      employer: jobs.employer,
      location: jobs.location,
      datePosted: jobs.datePosted,
      jobUrl: jobs.jobUrl,
      jobUrlDirect: jobs.jobUrlDirect,
      applicationLink: jobs.applicationLink,
      jobDescription: jobs.jobDescription,
    })
    .from(jobs)
    .where(isNull(jobs.duplicateOfJobId));
  const existingUrlSet = new Set(existingRows.map((row) => row.jobUrl));
  const duplicateIndex = createJobDuplicateIndex(existingRows);

  for (const { input, count } of byUrl.values()) {
    if (existingUrlSet.has(input.jobUrl)) {
      skipped += count;
      continue;
    }

    if (duplicateIndex.find(input)) {
      skipped += count;
      continue;
    }

    const inserted = await tryInsertJob(input);
    if (!inserted) {
      skipped += count;
      continue;
    }

    created += 1;
    skipped += count - 1;
    duplicateIndex.add({
      id: inserted.id,
      source: inserted.source,
      sourceJobId: inserted.sourceJobId,
      title: inserted.title,
      employer: inserted.employer,
      location: inserted.location,
      datePosted: inserted.datePosted,
      jobUrl: inserted.jobUrl,
      jobUrlDirect: inserted.jobUrlDirect,
      applicationLink: inserted.applicationLink,
      jobDescription: inserted.jobDescription,
    });
  }

  return { created, skipped };
}

/**
 * Create a single job (or return existing if URL matches).
 */
export async function createJob(input: CreateJobInput): Promise<Job> {
  return createJobs(input);
}

/**
 * Update a job.
 */
export async function updateJob(
  id: string,
  input: UpdateJobInput,
): Promise<Job | null> {
  const now = new Date().toISOString();

  await db
    .update(jobs)
    .set({
      ...input,
      updatedAt: now,
      ...(input.status === "processing" ? { processedAt: now } : {}),
      ...(input.status === "applied" && !input.appliedAt
        ? { appliedAt: now }
        : {}),
    })
    .where(eq(jobs.id, id));

  return getJobById(id);
}

export async function getJobsNeedingPostingDateCheck(
  limit = 8,
): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.duplicateOfJobId),
        isNull(jobs.datePostedCheckedAt),
        inArray(jobs.source, ["indeed", "linkedin", "gradcracker"]),
      ),
    )
    .orderBy(desc(jobs.discoveredAt))
    .limit(limit);

  return rows.map(mapRowToJob);
}

export async function markPostingDateChecked(
  id: string,
  datePosted?: string,
): Promise<Job | null> {
  const now = new Date().toISOString();
  await db
    .update(jobs)
    .set({
      ...(datePosted ? { datePosted: normalizePostingDate(datePosted) } : {}),
      datePostedCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(jobs.id, id));
  return getJobById(id);
}

/**
 * Get job statistics by status.
 */
export async function getJobStats(
  search?: string,
): Promise<Record<JobStatus, number>> {
  const whereClause = buildJobsWhere(undefined, search);
  const baseQuery = db
    .select({
      status: jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(jobs);
  const filteredQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;
  const result = await filteredQuery.groupBy(jobs.status);

  const stats: Record<JobStatus, number> = {
    discovered: 0,
    processing: 0,
    ready: 0,
    applied: 0,
    in_progress: 0,
    skipped: 0,
    expired: 0,
  };

  for (const row of result) {
    stats[row.status as JobStatus] = row.count;
  }

  return stats;
}

/**
 * Get jobs ready for processing (discovered with description).
 */
export async function getJobsForProcessing(limit: number = 10): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "discovered"),
        sql`${jobs.jobDescription} IS NOT NULL`,
      ),
    )
    .orderBy(desc(jobs.discoveredAt))
    .limit(limit);

  return rows.map(mapRowToJob);
}

/**
 * Get discovered jobs missing a suitability score.
 */
export async function getUnscoredDiscoveredJobs(
  limit?: number,
): Promise<Job[]> {
  const query = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "discovered"), isNull(jobs.suitabilityScore)))
    .orderBy(desc(jobs.discoveredAt));

  const rows =
    typeof limit === "number" ? await query.limit(limit) : await query;
  return rows.map(mapRowToJob);
}

/**
 * Delete jobs by status.
 */
export async function deleteJobsByStatus(status: JobStatus): Promise<number> {
  const result = await db.delete(jobs).where(eq(jobs.status, status)).run();
  return result.changes;
}

/**
 * Delete jobs with suitability score below threshold (excluding applied and in_progress jobs).
 */
export async function deleteJobsBelowScore(threshold: number): Promise<number> {
  const result = await db
    .delete(jobs)
    .where(
      and(
        lt(jobs.suitabilityScore, threshold),
        ne(jobs.status, "applied"),
        ne(jobs.status, "in_progress"),
      ),
    )
    .run();
  return result.changes;
}

// Helper to map database row to Job type
function mapRowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    source: row.source as Job["source"],
    sourceJobId: row.sourceJobId ?? null,
    jobUrlDirect: row.jobUrlDirect ?? null,
    datePosted: row.datePosted ?? null,
    datePostedCheckedAt: row.datePostedCheckedAt ?? null,
    title: row.title,
    employer: row.employer,
    employerUrl: row.employerUrl,
    jobUrl: row.jobUrl,
    applicationLink: row.applicationLink,
    disciplines: row.disciplines,
    deadline: row.deadline,
    salary: row.salary,
    location: row.location,
    degreeRequired: row.degreeRequired,
    starting: row.starting,
    jobDescription: row.jobDescription,
    status: row.status as JobStatus,
    outcome: row.outcome ?? null,
    closedAt: row.closedAt ?? null,
    suitabilityScore: row.suitabilityScore,
    suitabilityReason: row.suitabilityReason,
    suitabilityReasonSource:
      (row.suitabilityReasonSource as Job["suitabilityReasonSource"]) ?? null,
    semanticScore: row.semanticScore ?? null,
    keywordCoverage: row.keywordCoverage ?? null,
    keywordMissing: row.keywordMissing ?? null,
    jobEmbedding: row.jobEmbedding ?? null,
    jobEmbeddingModel: row.jobEmbeddingModel ?? null,
    jobEmbeddingHash: row.jobEmbeddingHash ?? null,
    tailoredSummary: row.tailoredSummary,
    tailoredHeadline: row.tailoredHeadline ?? null,
    tailoredSkills: row.tailoredSkills ?? null,
    selectedProjectIds: row.selectedProjectIds ?? null,
    pdfPath: row.pdfPath,
    tracerLinksEnabled: row.tracerLinksEnabled ?? false,
    sponsorMatchScore: row.sponsorMatchScore ?? null,
    sponsorMatchNames: row.sponsorMatchNames ?? null,
    jobType: row.jobType ?? null,
    salarySource: row.salarySource ?? null,
    salaryInterval: row.salaryInterval ?? null,
    salaryMinAmount: row.salaryMinAmount ?? null,
    salaryMaxAmount: row.salaryMaxAmount ?? null,
    salaryCurrency: row.salaryCurrency ?? null,
    isRemote: row.isRemote ?? null,
    jobLevel: row.jobLevel ?? null,
    jobFunction: row.jobFunction ?? null,
    listingType: row.listingType ?? null,
    emails: row.emails ?? null,
    companyIndustry: row.companyIndustry ?? null,
    companyLogo: row.companyLogo ?? null,
    companyUrlDirect: row.companyUrlDirect ?? null,
    companyAddresses: row.companyAddresses ?? null,
    companyNumEmployees: row.companyNumEmployees ?? null,
    companyRevenue: row.companyRevenue ?? null,
    companyDescription: row.companyDescription ?? null,
    skills: row.skills ?? null,
    experienceRange: row.experienceRange ?? null,
    companyRating: row.companyRating ?? null,
    companyReviewsCount: row.companyReviewsCount ?? null,
    vacancyCount: row.vacancyCount ?? null,
    workFromHomeType: row.workFromHomeType ?? null,
    discoveredAt: row.discoveredAt,
    processedAt: row.processedAt,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
