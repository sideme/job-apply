import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreJobsStep } from "./score-jobs";

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@server/repositories/jobs", () => ({
  getUnscoredDiscoveredJobs: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

vi.mock("@server/services/scoring/embedding-client", () => ({
  resolveEmbeddingConfig: vi.fn(),
}));

vi.mock("@server/services/scoring/resume-vector", () => ({
  getResumeVector: vi.fn(),
}));

vi.mock("@server/services/scoring/local-scorer", () => ({
  scoreJobLocally: vi.fn(),
}));

vi.mock("../progress", () => ({
  updateProgress: vi.fn(),
  progressHelpers: {
    scoringJob: vi.fn(),
    scoringComplete: vi.fn(),
  },
}));

describe("scoreJobsStep auto-skip behavior", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const jobsRepo = await import("@server/repositories/jobs");
    const settingsRepo = await import("@server/repositories/settings");
    const localScorer = await import("@server/services/scoring/local-scorer");
    const embeddings = await import(
      "@server/services/scoring/embedding-client"
    );
    const resumeVector = await import("@server/services/scoring/resume-vector");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        title: "Software Engineer",
        employer: "Acme Corp",
        status: "discovered",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
    ]);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(null);
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    vi.mocked(embeddings.resolveEmbeddingConfig).mockResolvedValue(null);
    vi.mocked(resumeVector.getResumeVector).mockResolvedValue({
      text: "typescript react",
      vector: [1, 0],
    });
    vi.mocked(localScorer.scoreJobLocally).mockResolvedValue({
      total: 40,
      semanticScore: null,
      keywordCoverage: 40,
      keywordMissing: ["kubernetes"],
      reason: "Keyword-only · keyword coverage 40% (2/5)",
      reasonSource: "local",
      jobVector: null,
      jobVectorModel: null,
    });
  });

  it("auto-skips jobs when score is below threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");

    await scoreJobsStep({ profile: {}, jobIds: ["job-1"] });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        suitabilityScore: 40,
        status: "skipped",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.objectContaining({
        jobId: "job-1",
        score: 40,
        threshold: 50,
      }),
    );
  });

  it("does not auto-skip jobs when score equals threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const localScorer = await import("@server/services/scoring/local-scorer");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");
    vi.mocked(localScorer.scoreJobLocally).mockResolvedValue({
      total: 50,
      semanticScore: null,
      keywordCoverage: 50,
      keywordMissing: [],
      reason: "Keyword-only · keyword coverage 50% (1/2)",
      reasonSource: "local",
      jobVector: null,
      jobVectorModel: null,
    });

    await scoreJobsStep({ profile: {}, jobIds: ["job-1"] });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        suitabilityScore: 50,
      }),
    );
    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
    expect(logger.info).not.toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.anything(),
    );
  });

  it("does not auto-skip when threshold setting is null", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);

    await scoreJobsStep({ profile: {}, jobIds: ["job-1"] });

    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
  });

  it("does not auto-skip when threshold setting is NaN", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("not-a-number");

    await scoreJobsStep({ profile: {}, jobIds: ["job-1"] });

    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
  });

  it("never auto-skips applied jobs even when score is below threshold", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    const jobsRepo = await import("@server/repositories/jobs");
    const { logger } = await import("@infra/logger");

    vi.mocked(settingsRepo.getSetting).mockResolvedValue("50");
    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-applied",
        status: "applied",
        title: "Software Engineer",
        employer: "Acme Corp",
        suitabilityScore: null,
        suitabilityReason: null,
      }),
    ]);

    await scoreJobsStep({ profile: {}, jobIds: ["job-applied"] });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-applied",
      expect.any(Object),
    );
    const updatePayload = vi.mocked(jobsRepo.updateJob).mock.calls[0][1] as {
      status?: string;
    };
    expect(updatePayload).not.toHaveProperty("status");
    expect(logger.info).not.toHaveBeenCalledWith(
      "Auto-skipped job due to low score",
      expect.objectContaining({ jobId: "job-applied" }),
    );
  });

  it("scores multiple jobs and reports completion progress", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const localScorer = await import("@server/services/scoring/local-scorer");
    const { progressHelpers } = await import("../progress");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "First Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
      createJob({
        id: "job-2",
        title: "Second Role",
        employer: "Beta",
        suitabilityScore: null,
      }),
    ]);

    vi.mocked(localScorer.scoreJobLocally)
      .mockResolvedValueOnce({
        total: 61,
        semanticScore: null,
        keywordCoverage: 61,
        keywordMissing: [],
        reason: "First score",
        reasonSource: "local",
        jobVector: null,
        jobVectorModel: null,
      })
      .mockResolvedValueOnce({
        total: 72,
        semanticScore: null,
        keywordCoverage: 72,
        keywordMissing: [],
        reason: "Second score",
        reasonSource: "local",
        jobVector: null,
        jobVectorModel: null,
      });

    const result = await scoreJobsStep({
      profile: {},
      jobIds: ["job-1", "job-2"],
    });

    expect(result.scoredJobs).toHaveLength(2);
    expect(vi.mocked(jobsRepo.updateJob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(progressHelpers.scoringJob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(progressHelpers.scoringComplete)).toHaveBeenCalledWith(2);
  });

  it("queries only the newly imported job IDs supplied by the pipeline", async () => {
    const jobsRepo = await import("@server/repositories/jobs");

    await scoreJobsStep({ profile: {}, jobIds: ["job-1"] });

    expect(jobsRepo.getUnscoredDiscoveredJobs).toHaveBeenCalledWith({
      ids: ["job-1"],
    });
  });

  it("does no scoring when the current pipeline run imported no jobs", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const localScorer = await import("@server/services/scoring/local-scorer");
    const embeddings = await import(
      "@server/services/scoring/embedding-client"
    );
    const resumeVector = await import("@server/services/scoring/resume-vector");
    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([]);

    const result = await scoreJobsStep({ profile: {}, jobIds: [] });

    expect(jobsRepo.getUnscoredDiscoveredJobs).toHaveBeenCalledWith({
      ids: [],
    });
    expect(localScorer.scoreJobLocally).not.toHaveBeenCalled();
    expect(embeddings.resolveEmbeddingConfig).not.toHaveBeenCalled();
    expect(resumeVector.getResumeVector).not.toHaveBeenCalled();
    expect(result.scoredJobs).toEqual([]);
  });

  it("limits only API requests while allowing cache hits", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const embeddings = await import(
      "@server/services/scoring/embedding-client"
    );
    const localScorer = await import("@server/services/scoring/local-scorer");
    const { logger } = await import("@infra/logger");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({ id: "job-1", suitabilityScore: null }),
      createJob({ id: "job-cached", suitabilityScore: null }),
      createJob({ id: "job-limited", suitabilityScore: null }),
    ]);
    vi.mocked(embeddings.resolveEmbeddingConfig).mockResolvedValue({
      provider: "qwen",
      apiKey: "dedicated-key",
      baseUrl: "https://example.com/v1",
      model: "text-embedding-v3",
      maxJobsPerRun: 1,
      maxInputChars: 6000,
    });
    vi.mocked(localScorer.scoreJobLocally).mockImplementation(async (args) => {
      const isCached = args.jobId === "job-cached";
      const requestAllowed = isCached
        ? false
        : (args.reserveEmbeddingApiRequest?.() ?? true);
      return {
        total: 80,
        semanticScore: isCached || requestAllowed ? 80 : null,
        keywordCoverage: 80,
        keywordMissing: [],
        reason: "Local score",
        reasonSource: "local",
        jobVector: isCached || requestAllowed ? [1, 0] : null,
        jobVectorModel: isCached || requestAllowed ? "text-embedding-v3" : null,
        embeddingCacheHit: isCached,
        embeddingApiRequest: requestAllowed,
        embeddingLimitFallback: !isCached && !requestAllowed,
      };
    });

    await scoreJobsStep({
      profile: {},
      jobIds: ["job-1", "job-cached", "job-limited"],
    });

    expect(localScorer.scoreJobLocally).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      "Scoring step completed",
      expect.objectContaining({
        embeddingReservations: 1,
        embeddingCacheHits: 1,
        embeddingApiRequests: 1,
        embeddingLimitFallbacks: 1,
      }),
    );
  });

  it("stops before processing when cancellation is requested", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const localScorer = await import("@server/services/scoring/local-scorer");

    vi.mocked(jobsRepo.getUnscoredDiscoveredJobs).mockResolvedValue([
      createJob({
        id: "job-1",
        title: "Cancelled Role",
        employer: "Acme",
        suitabilityScore: null,
      }),
    ]);

    const result = await scoreJobsStep({
      profile: {},
      jobIds: ["job-1"],
      shouldCancel: () => true,
    });

    expect(result.scoredJobs).toHaveLength(0);
    expect(vi.mocked(localScorer.scoreJobLocally)).not.toHaveBeenCalled();
    expect(vi.mocked(jobsRepo.updateJob)).not.toHaveBeenCalled();
  });
});
