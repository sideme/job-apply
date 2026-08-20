import { logger } from "@infra/logger";
import { runSearchPlanner } from "@server/services/agent/search-planner";
import type { CreateJobInput, PipelineConfig } from "@shared/types";
import { discoverJobsStep } from "./discover-jobs";

export async function discoverJobsWithAgentFallbackStep(input: {
  pipelineRunId: string;
  mergedConfig: PipelineConfig;
  profile: Record<string, unknown>;
  signal?: AbortSignal;
  shouldCancel?: () => boolean;
}): Promise<{
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
}> {
  const planner = await runSearchPlanner(input);
  if (!planner.enabled || planner.fallbackToFixed) {
    logger.info("Using deterministic discovery", {
      agentEnabled: planner.enabled,
      agentStarted: planner.started,
      reason: planner.stopReason,
    });
    return discoverJobsStep({
      mergedConfig: input.mergedConfig,
      shouldCancel: input.shouldCancel,
    });
  }

  logger.info("Using Search Planner discovery results", {
    stopReason: planner.stopReason,
    searchesUsed: planner.searchesUsed,
    sourceExecutions: planner.sourceExecutions,
    candidates: planner.discoveredJobs.length,
    cacheHits: planner.cacheHits,
    inputTokens: planner.inputTokens,
    outputTokens: planner.outputTokens,
  });
  return {
    discoveredJobs: planner.discoveredJobs,
    sourceErrors: planner.sourceErrors,
  };
}
