import { logger } from "@infra/logger";
import { calculateAtsScore, calibrateSemanticSimilarity } from "./ats-rules";
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
  jobTitle?: string;
  jobDescription?: string;
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
        semanticScore = calibrateSemanticSimilarity(
          cosine(args.resumeVector, vector),
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

  const [derivedTitle, ...derivedDescription] = args.jobText.split("\n");
  const ats = calculateAtsScore({
    resumeText: args.resumeText,
    jobTitle: args.jobTitle ?? derivedTitle ?? "",
    jobDescription: args.jobDescription ?? derivedDescription.join("\n"),
    keywordCoverage: keyword.coverage,
    jobSkills: keyword.jobSkills,
    missingSkills: keyword.missing,
    semanticScore,
    semanticWeight: args.semanticWeight,
  });

  return {
    total: ats.total,
    semanticScore,
    keywordCoverage: keyword.coverage,
    keywordMissing: keyword.missing,
    reason: ats.reason,
    reasonSource: "local",
    jobVector,
    jobVectorModel,
    jobVectorHash,
    embeddingCacheHit,
    embeddingApiRequest,
    embeddingLimitFallback,
  };
}
