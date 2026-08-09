import { logger } from "@infra/logger";
import type { EmbeddingConfig } from "./embedding-client";
import {
  cosine,
  EmbeddingError,
  embedTexts,
  prepareEmbeddingText,
} from "./embedding-client";
import { scoreKeywords } from "./keyword-scorer";
import { hashText } from "./resume-vector";

export type LocalScore = {
  total: number;
  semanticScore: number | null;
  keywordCoverage: number | null;
  keywordMissing: string[];
  reason: string;
  reasonSource: "local";
  jobVector: number[] | null;
  jobVectorModel: string | null;
  jobVectorHash?: string | null;
  embeddingCacheHit?: boolean;
  embeddingApiRequest?: boolean;
  embeddingLimitFallback?: boolean;
};

export async function scoreJobLocally(args: {
  jobId: string;
  jobText: string;
  resumeText: string;
  resumeVector: number[] | null;
  cachedJobVector: number[] | null;
  cachedJobVectorModel: string | null;
  cachedJobVectorHash: string | null;
  embeddingConfig: EmbeddingConfig | null;
  semanticWeight: number;
  reserveEmbeddingApiRequest?: () => boolean;
}): Promise<LocalScore> {
  const keyword = scoreKeywords(args.resumeText, args.jobText);
  let semanticScore: number | null = null;
  let jobVector: number[] | null = null;
  let jobVectorModel: string | null = null;
  let jobVectorHash: string | null = null;
  let embeddingCacheHit = false;
  let embeddingApiRequest = false;
  let embeddingLimitFallback = false;

  if (args.embeddingConfig && args.resumeVector && args.jobText.trim()) {
    try {
      const model = args.embeddingConfig.model;
      const embeddingText = prepareEmbeddingText(
        args.jobText,
        args.embeddingConfig.maxInputChars,
      );
      const inputHash = hashText(embeddingText);
      embeddingCacheHit = Boolean(
        args.cachedJobVector &&
          args.cachedJobVectorModel === model &&
          args.cachedJobVectorHash === inputHash,
      );
      const canRequestEmbedding =
        embeddingCacheHit || (args.reserveEmbeddingApiRequest?.() ?? true);
      if (canRequestEmbedding) {
        embeddingApiRequest = !embeddingCacheHit;
        const vector = embeddingCacheHit
          ? (args.cachedJobVector as number[])
          : (await embedTexts([embeddingText], args.embeddingConfig))[0];
        jobVector = vector;
        jobVectorModel = model;
        jobVectorHash = inputHash;
        semanticScore = Math.round(
          Math.min(1, Math.max(0, cosine(args.resumeVector, vector))) * 100,
        );
      } else {
        embeddingLimitFallback = true;
      }
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      logger.warn("Embedding failed; using keyword-only score", {
        jobId: args.jobId,
        message: error.message,
      });
    }
  }

  const weight = Math.min(1, Math.max(0, args.semanticWeight));
  const coverage = keyword.coverage;
  const total =
    semanticScore !== null && coverage !== null
      ? Math.round(semanticScore * weight + coverage * (1 - weight))
      : (semanticScore ?? coverage ?? 0);
  const matched = keyword.jobSkills.length - keyword.missing.length;
  const parts = [
    semanticScore === null ? "Keyword-only" : `Semantic ${semanticScore}`,
    coverage === null
      ? null
      : `keyword coverage ${coverage}% (${matched}/${keyword.jobSkills.length})`,
    keyword.missing.length > 0
      ? `Missing: ${keyword.missing.join(", ")}`
      : null,
    !args.resumeText
      ? "No resume text extracted — upload a text-based PDF"
      : null,
  ].filter((part): part is string => Boolean(part));

  return {
    total,
    semanticScore,
    keywordCoverage: coverage,
    keywordMissing: keyword.missing,
    reason: parts.join(" · "),
    reasonSource: "local",
    jobVector,
    jobVectorModel,
    jobVectorHash,
    embeddingCacheHit,
    embeddingApiRequest,
    embeddingLimitFallback,
  };
}
