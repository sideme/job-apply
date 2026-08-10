import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./embedding-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedding-client")>()),
  embedTexts: vi.fn(),
}));

import { embedTexts, l2normalize } from "./embedding-client";
import { scoreJobLocally } from "./local-scorer";

const config = {
  provider: "openai",
  apiKey: "k",
  baseUrl: "https://api.openai.com",
  model: "m",
  maxJobsPerRun: 20,
  maxInputChars: 6000,
};

afterEach(() => vi.clearAllMocks());

describe("scoreJobLocally", () => {
  it("blends semantic and keyword coverage", async () => {
    const vector = l2normalize([1, 1]);
    const result = await scoreJobLocally({
      jobId: "job-1",
      jobText: "react typescript kubernetes grpc",
      resumeText: "react typescript",
      resumeVector: vector,
      cachedJobVector: vector,
      cachedJobVectorModel: "m",
      cachedJobVectorHash:
        "9dca1378625af4fa378c1a748e69a617abce4d63b9442d3d4326ccc11cfb02d8",
      embeddingConfig: config,
      semanticWeight: 0.7,
    });
    expect(result.semanticScore).toBe(95);
    expect(result.keywordCoverage).toBe(50);
    expect(result.total).toBeGreaterThan(30);
    expect(result.total).toBeLessThanOrEqual(60);
    expect(result.keywordMissing).toEqual(["grpc", "kubernetes"]);
    expect(result.embeddingCacheHit).toBe(true);
    expect(result.embeddingApiRequest).toBe(false);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("reuses the generated vector when the exact input is scored again", async () => {
    const vector = l2normalize([1, 1]);
    vi.mocked(embedTexts).mockResolvedValueOnce([vector]);

    const first = await scoreJobLocally({
      jobId: "job-1",
      jobText: "react typescript kubernetes grpc",
      resumeText: "react typescript",
      resumeVector: vector,
      cachedJobVector: null,
      cachedJobVectorModel: null,
      cachedJobVectorHash: null,
      embeddingConfig: config,
      semanticWeight: 0.7,
    });
    const second = await scoreJobLocally({
      jobId: "job-1",
      jobText: "react typescript kubernetes grpc",
      resumeText: "react typescript",
      resumeVector: vector,
      cachedJobVector: first.jobVector,
      cachedJobVectorModel: first.jobVectorModel,
      cachedJobVectorHash: first.jobVectorHash ?? null,
      embeddingConfig: config,
      semanticWeight: 0.7,
    });

    expect(first.embeddingApiRequest).toBe(true);
    expect(second.embeddingCacheHit).toBe(true);
    expect(second.embeddingApiRequest).toBe(false);
    expect(embedTexts).toHaveBeenCalledTimes(1);
  });

  it("uses keyword-only scoring when the API request limit is exhausted", async () => {
    const result = await scoreJobLocally({
      jobId: "job-1",
      jobText: "react typescript",
      resumeText: "react typescript",
      resumeVector: l2normalize([1, 1]),
      cachedJobVector: null,
      cachedJobVectorModel: null,
      cachedJobVectorHash: null,
      embeddingConfig: config,
      semanticWeight: 0.7,
      reserveEmbeddingApiRequest: () => false,
    });

    expect(result.embeddingLimitFallback).toBe(true);
    expect(result.embeddingApiRequest).toBe(false);
    expect(result.semanticScore).toBeNull();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("falls back to keyword-only without embedding configuration", async () => {
    const result = await scoreJobLocally({
      jobId: "job-1",
      jobText: "react typescript",
      resumeText: "react typescript",
      resumeVector: null,
      cachedJobVector: null,
      cachedJobVectorModel: null,
      cachedJobVectorHash: null,
      embeddingConfig: null,
      semanticWeight: 0.7,
    });
    expect(result.semanticScore).toBeNull();
    expect(result.total).toBe(60);
    expect(result.reason).toContain("confidence cap 60");
  });
});
