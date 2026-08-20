import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe.sequential("fit judgment repository", () => {
  let dataDir: string;
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    dataDir = await mkdtemp(join(tmpdir(), "job-ops-fit-judgments-"));
    process.env = { ...originalEnv, DATA_DIR: dataDir, NODE_ENV: "test" };
    await import("../db/migrate");
    closeDb = (await import("../db")).closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    process.env = { ...originalEnv };
    await rm(dataDir, { recursive: true, force: true });
  });

  it("enqueues only explicitly new scored jobs and leaves history untouched", async () => {
    const jobsRepo = await import("./jobs");
    const fitRepo = await import("./fit-judgments");
    const historical = await jobsRepo.createJob({
      source: "linkedin",
      title: "Historical Engineer",
      employer: "Old Co",
      jobUrl: "https://example.com/historical",
    });
    const fresh = await jobsRepo.createJob({
      source: "linkedin",
      title: "Fresh Engineer",
      employer: "New Co",
      jobUrl: "https://example.com/fresh",
    });
    await jobsRepo.updateJob(historical.id, { suitabilityScore: 90 });
    await jobsRepo.updateJob(fresh.id, { suitabilityScore: 88 });

    expect(await fitRepo.enqueueNewFitJobs([fresh.id])).toBe(1);
    expect((await jobsRepo.getJobById(historical.id))?.llmFitStatus).toBeNull();
    expect((await jobsRepo.getJobById(fresh.id))?.llmFitStatus).toBe("pending");

    const claimed = await fitRepo.claimPendingFitJob();
    expect(claimed?.id).toBe(fresh.id);
    expect((await jobsRepo.getJobById(fresh.id))?.llmFitStatus).toBe("running");
  });

  it("reuses only completed judgments with the exact input hash", async () => {
    const jobsRepo = await import("./jobs");
    const fitRepo = await import("./fit-judgments");
    const job = await jobsRepo.createJob({
      source: "indeed",
      title: "Backend Engineer",
      employer: "Cache Co",
      jobUrl: "https://example.com/cache",
    });
    await fitRepo.completeFitJudgment({
      jobId: job.id,
      score: 82,
      verdict: "strong",
      fitPoints: ["Node.js"],
      gaps: ["Kubernetes"],
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: "fit-judge-v1",
      inputHash: "hash-1",
    });

    expect(await fitRepo.getCachedFitJudgment("hash-1")).toMatchObject({
      score: 82,
      verdict: "strong",
      fitPoints: ["Node.js"],
      gaps: ["Kubernetes"],
    });
    expect(await jobsRepo.getJobById(job.id)).toMatchObject({
      suitabilityScore: 82,
      suitabilityReason: "DeepSeek ATS 82 · strong · deepseek-v4-flash",
      suitabilityReasonSource: "llm",
      llmFitScore: 82,
      llmFitStatus: "completed",
    });
    expect(await fitRepo.getCachedFitJudgment("hash-2")).toBeNull();
  });
});
