import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import { extractLocalResumeText } from "@server/services/local-resume";
import type { Job } from "@shared/types";
import { resolveEmbeddingConfig } from "./embedding-client";
import { type LocalScore, scoreJobLocally } from "./local-scorer";
import { getResumeVector } from "./resume-vector";

function parseSemanticWeight(raw: string | null): number {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isNaN(parsed) ? 0.7 : Math.min(1, Math.max(0, parsed));
}

function parseCachedVector(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const vector = JSON.parse(raw) as unknown;
    return Array.isArray(vector) &&
      vector.length > 0 &&
      vector.every((item) => typeof item === "number" && Number.isFinite(item))
      ? vector
      : null;
  } catch {
    return null;
  }
}

/**
 * Recalculates one job using cached vectors when available. This never calls
 * the chat-completions API; deep LLM analysis is a separate explicit action.
 */
export async function calculateLocalJobScore(
  job: Job,
  profile: Record<string, unknown>,
): Promise<LocalScore> {
  const [semanticWeightRaw, embeddingConfig] = await Promise.all([
    settingsRepo.getSetting("semanticScoreWeight"),
    resolveEmbeddingConfig(),
  ]);
  let resumeText = String(profile.rawText ?? "");
  let resumeVector: number[] | null = null;

  if (embeddingConfig) {
    try {
      const resume = await getResumeVector(embeddingConfig);
      resumeText = resume.text || resumeText;
      resumeVector = resume.vector;
    } catch (error) {
      logger.warn("Resume embedding failed; using keyword-only rescore", {
        jobId: job.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  } else if (!resumeText) {
    resumeText = await extractLocalResumeText();
  }

  return scoreJobLocally({
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
    semanticWeight: parseSemanticWeight(semanticWeightRaw),
  });
}
