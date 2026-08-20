import type { Job, LlmFitVerdict } from "@shared/types";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, getSqliteClient, schema } from "../db";
import * as jobsRepo from "./jobs";

const { jobs } = schema;

export type CachedFitJudgment = {
  score: number;
  verdict: LlmFitVerdict;
  fitPoints: string[];
  gaps: string[];
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
};

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function enqueueNewFitJobs(jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const result = await db
    .update(jobs)
    .set({
      llmFitStatus: "pending",
      llmFitError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        inArray(jobs.id, jobIds),
        eq(jobs.status, "discovered"),
        isNull(jobs.duplicateOfJobId),
        isNull(jobs.llmFitStatus),
        sql`${jobs.suitabilityScore} IS NOT NULL`,
      ),
    );
  return result.changes;
}

export async function expireStalePendingFitJobs(
  discoveredBefore: string,
): Promise<number> {
  const result = await db
    .update(jobs)
    .set({
      llmFitStatus: "skipped_stale",
      llmFitError: "Pending LLM fit expired before evaluation.",
      llmFitAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(jobs.llmFitStatus, "pending"),
        eq(jobs.status, "discovered"),
        lt(jobs.discoveredAt, discoveredBefore),
      ),
    );
  return result.changes;
}

export async function claimPendingFitJob(): Promise<Job | null> {
  const sqlite = getSqliteClient();
  const claim = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT id FROM jobs
         WHERE llm_fit_status = 'pending'
           AND status = 'discovered'
           AND duplicate_of_job_id IS NULL
           AND suitability_score IS NOT NULL
         ORDER BY suitability_score DESC, discovered_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (!row) return null;
    const result = sqlite
      .prepare(
        `UPDATE jobs
         SET llm_fit_status = 'running', llm_fit_error = NULL, updated_at = ?
         WHERE id = ? AND llm_fit_status = 'pending'`,
      )
      .run(new Date().toISOString(), row.id);
    return result.changes === 1 ? row.id : null;
  });
  const id = claim.immediate();
  return id ? jobsRepo.getJobById(id) : null;
}

export async function hasPendingFitJobs(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        eq(jobs.llmFitStatus, "pending"),
        eq(jobs.status, "discovered"),
        isNull(jobs.duplicateOfJobId),
        sql`${jobs.suitabilityScore} IS NOT NULL`,
      ),
    );
  return (row?.count ?? 0) > 0;
}

export async function setFitJudgmentIdentity(input: {
  jobId: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
}): Promise<void> {
  await db
    .update(jobs)
    .set({
      llmFitProvider: input.provider,
      llmFitModel: input.model,
      llmFitPromptVersion: input.promptVersion,
      llmFitInputHash: input.inputHash,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(jobs.id, input.jobId), eq(jobs.llmFitStatus, "running")));
}

export async function getCachedFitJudgment(
  inputHash: string,
): Promise<CachedFitJudgment | null> {
  const [row] = await db
    .select({
      score: jobs.llmFitScore,
      verdict: jobs.llmFitVerdict,
      fitPoints: jobs.llmFitPoints,
      gaps: jobs.llmFitGaps,
      provider: jobs.llmFitProvider,
      model: jobs.llmFitModel,
      promptVersion: jobs.llmFitPromptVersion,
      inputHash: jobs.llmFitInputHash,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.llmFitStatus, "completed"),
        eq(jobs.llmFitInputHash, inputHash),
      ),
    )
    .orderBy(desc(jobs.llmFitAt))
    .limit(1);
  if (
    !row ||
    row.score === null ||
    !row.verdict ||
    !row.provider ||
    !row.model ||
    !row.promptVersion ||
    !row.inputHash
  ) {
    return null;
  }
  return {
    score: row.score,
    verdict: row.verdict as LlmFitVerdict,
    fitPoints: parseStringArray(row.fitPoints),
    gaps: parseStringArray(row.gaps),
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
  };
}

export async function completeFitJudgment(input: {
  jobId: string;
  score: number;
  verdict: LlmFitVerdict;
  fitPoints: string[];
  gaps: string[];
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
}): Promise<void> {
  const providerLabel =
    input.provider.trim().toLowerCase() === "deepseek"
      ? "DeepSeek"
      : input.provider.trim() || "LLM";
  const suitabilityReason = `${providerLabel} ATS ${input.score} · ${input.verdict} · ${input.model}`;
  await db
    .update(jobs)
    .set({
      // Once the model judgment is available it becomes the primary ATS score.
      // Local keyword/semantic fields remain stored as supporting evidence.
      suitabilityScore: input.score,
      suitabilityReason,
      suitabilityReasonSource: "llm",
      llmFitScore: input.score,
      llmFitVerdict: input.verdict,
      llmFitPoints: JSON.stringify(input.fitPoints),
      llmFitGaps: JSON.stringify(input.gaps),
      llmFitStatus: "completed",
      llmFitError: null,
      llmFitProvider: input.provider,
      llmFitModel: input.model,
      llmFitPromptVersion: input.promptVersion,
      llmFitInputHash: input.inputHash,
      llmFitAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, input.jobId));
}

export async function failFitJudgment(
  jobId: string,
  error: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      llmFitStatus: "failed",
      llmFitError: error.slice(0, 1_000),
      llmFitAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, jobId));
}

export async function releaseFitJudgment(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      llmFitStatus: "pending",
      llmFitError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.llmFitStatus, "running")));
}

export async function recoverStaleFitJudgments(
  updatedBefore: string,
): Promise<number> {
  const result = await db
    .update(jobs)
    .set({
      llmFitStatus: "pending",
      llmFitError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(eq(jobs.llmFitStatus, "running"), lt(jobs.updatedAt, updatedBefore)),
    );
  return result.changes;
}
