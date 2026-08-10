import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { extractLocalResumeText } from "@server/services/local-resume";
import { resolveEmbeddingConfig } from "@server/services/scoring/embedding-client";
import { scoreJobLocally } from "@server/services/scoring/local-scorer";
import { getResumeVector } from "@server/services/scoring/resume-vector";
import { asyncPool } from "@server/utils/async-pool";
import type { Job } from "@shared/types";
import { progressHelpers, updateProgress } from "../progress";
import type { ScoredJob } from "./types";

const SCORING_CONCURRENCY = 4;

function parseCachedVector(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const vector = JSON.parse(raw) as unknown;
    return Array.isArray(vector) &&
      vector.every((item) => typeof item === "number")
      ? vector
      : null;
  } catch {
    return null;
  }
}

export async function scoreJobsStep(args: {
  profile: Record<string, unknown>;
  jobIds: string[];
  shouldCancel?: () => boolean;
}): Promise<{ unprocessedJobs: Job[]; scoredJobs: ScoredJob[] }> {
  logger.info("Running scoring step");
  const unprocessedJobs = await jobsRepo.getUnscoredDiscoveredJobs({
    ids: args.jobIds,
  });
  updateProgress({
    step: "scoring",
    jobsDiscovered: unprocessedJobs.length,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    currentJob: undefined,
  });
  if (unprocessedJobs.length === 0) {
    progressHelpers.scoringComplete(0);
    logger.info("Scoring step skipped; no new unscored jobs");
    return { unprocessedJobs, scoredJobs: [] };
  }

  // Check if auto-skip threshold is configured
  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;
  const [semanticWeightRaw, embeddingConfig] = await Promise.all([
    settingsRepo.getSetting("semanticScoreWeight"),
    resolveEmbeddingConfig(),
  ]);
  const parsedSemanticWeight = Number.parseFloat(semanticWeightRaw ?? "");
  const semanticWeight = Math.min(
    1,
    Math.max(
      0,
      Number.isNaN(parsedSemanticWeight) ? 0.7 : parsedSemanticWeight,
    ),
  );
  let resumeText = String(
    (args.profile as { rawText?: unknown }).rawText ?? "",
  );
  let resumeVector: number[] | null = null;
  if (embeddingConfig) {
    try {
      const resume = await getResumeVector(embeddingConfig);
      resumeText = resume.text || resumeText;
      resumeVector = resume.vector;
    } catch (error) {
      logger.warn(
        "Resume embedding failed; pipeline will use keyword-only scoring",
        {
          message: error instanceof Error ? error.message : "unknown error",
        },
      );
    }
  } else if (!resumeText) {
    resumeText = await extractLocalResumeText();
  }

  const scoredJobs: ScoredJob[] = [];
  let completed = 0;
  let embeddingReservations = 0;
  let embeddingCacheHits = 0;
  let embeddingApiRequests = 0;
  let embeddingLimitFallbacks = 0;

  await asyncPool({
    items: unprocessedJobs,
    concurrency: SCORING_CONCURRENCY,
    shouldStop: args.shouldCancel,
    task: async (job) => {
      if (args.shouldCancel?.()) return;

      const hasCachedScore =
        typeof job.suitabilityScore === "number" &&
        !Number.isNaN(job.suitabilityScore);

      if (hasCachedScore) {
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          `${job.title} (cached)`,
        );
        scoredJobs.push({
          ...job,
          suitabilityScore: job.suitabilityScore as number,
          suitabilityReason: job.suitabilityReason ?? "",
        });
        return;
      }

      const local = await scoreJobLocally({
        jobId: job.id,
        jobText: `${job.title}\n${job.jobDescription ?? ""}`,
        jobTitle: job.title,
        jobDescription: job.jobDescription ?? "",
        resumeText,
        resumeVector,
        cachedJobVector: parseCachedVector(job.jobEmbedding),
        cachedJobVectorModel: job.jobEmbeddingModel,
        cachedJobVectorHash: job.jobEmbeddingHash,
        embeddingConfig,
        semanticWeight,
        reserveEmbeddingApiRequest: embeddingConfig
          ? () => {
              if (embeddingReservations >= embeddingConfig.maxJobsPerRun) {
                return false;
              }
              embeddingReservations += 1;
              return true;
            }
          : undefined,
      });
      if (args.shouldCancel?.()) return;
      if (local.embeddingCacheHit) embeddingCacheHits += 1;
      if (local.embeddingApiRequest) embeddingApiRequests += 1;
      if (local.embeddingLimitFallback) embeddingLimitFallbacks += 1;

      // Check if job should be auto-skipped based on score threshold
      const shouldAutoSkip =
        job.status !== "applied" &&
        autoSkipThreshold !== null &&
        !Number.isNaN(autoSkipThreshold) &&
        local.total < autoSkipThreshold;

      await jobsRepo.updateJob(job.id, {
        suitabilityScore: local.total,
        suitabilityReason: local.reason,
        suitabilityReasonSource: local.reasonSource,
        semanticScore: local.semanticScore,
        keywordCoverage: local.keywordCoverage,
        keywordMissing: JSON.stringify(local.keywordMissing),
        jobEmbedding: local.jobVector ? JSON.stringify(local.jobVector) : null,
        jobEmbeddingModel: local.jobVectorModel,
        jobEmbeddingHash: local.jobVectorHash ?? null,
        ...(shouldAutoSkip ? { status: "skipped" } : {}),
      });

      if (shouldAutoSkip) {
        logger.info("Auto-skipped job due to low score", {
          jobId: job.id,
          title: job.title,
          score: local.total,
          threshold: autoSkipThreshold,
        });
      }

      completed += 1;
      progressHelpers.scoringJob(completed, unprocessedJobs.length, job.title);
      scoredJobs.push({
        ...job,
        suitabilityScore: local.total,
        suitabilityReason: local.reason,
      });
    },
  });

  progressHelpers.scoringComplete(scoredJobs.length);
  logger.info("Scoring step completed", {
    scoredJobs: scoredJobs.length,
    concurrency: SCORING_CONCURRENCY,
    embeddingReservations,
    embeddingCacheHits,
    embeddingApiRequests,
    embeddingLimitFallbacks,
  });

  return { unprocessedJobs, scoredJobs };
}
