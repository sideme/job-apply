import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getEffectiveSettings: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: mocks.getSetting,
}));
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: mocks.getEffectiveSettings,
}));

import {
  cosine,
  EmbeddingError,
  embedTexts,
  l2normalize,
  resolveEmbeddingConfig,
} from "./embedding-client";

describe("resolveEmbeddingConfig", () => {
  const originalEmbeddingApiKey = process.env.EMBEDDING_API_KEY;
  const originalEmbeddingBaseUrl = process.env.EMBEDDING_BASE_URL;

  beforeEach(() => {
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    mocks.getSetting.mockReset();
    mocks.getEffectiveSettings.mockReset();
  });

  afterEach(() => {
    process.env.EMBEDDING_API_KEY = originalEmbeddingApiKey;
    process.env.EMBEDDING_BASE_URL = originalEmbeddingBaseUrl;
  });

  it("stays disabled even when a dedicated key exists", async () => {
    mocks.getEffectiveSettings.mockResolvedValue({
      embeddingEnabled: { value: false },
      embeddingProvider: "qwen",
      embeddingBaseUrl: "https://example.com/v1",
      embeddingModel: { value: "text-embedding-v3" },
      embeddingMaxJobsPerRun: { value: 20 },
      embeddingMaxInputChars: { value: 6000 },
    });
    mocks.getSetting.mockResolvedValue("dedicated-key");

    await expect(resolveEmbeddingConfig()).resolves.toBeNull();
  });

  it("requires a dedicated embedding key and base URL when enabled", async () => {
    mocks.getEffectiveSettings.mockResolvedValue({
      embeddingEnabled: { value: true },
      embeddingProvider: "qwen",
      embeddingBaseUrl: "https://example.com/v1",
      embeddingModel: { value: "text-embedding-v3" },
      embeddingMaxJobsPerRun: { value: 20 },
      embeddingMaxInputChars: { value: 6000 },
    });
    mocks.getSetting.mockResolvedValue(null);

    await expect(resolveEmbeddingConfig()).resolves.toBeNull();
  });

  it("returns only explicitly configured embedding credentials", async () => {
    mocks.getEffectiveSettings.mockResolvedValue({
      embeddingEnabled: { value: true },
      embeddingProvider: "qwen",
      embeddingBaseUrl: "https://example.com/v1",
      embeddingModel: { value: "text-embedding-v3" },
      embeddingMaxJobsPerRun: { value: 20 },
      embeddingMaxInputChars: { value: 6000 },
    });
    mocks.getSetting.mockResolvedValue("dedicated-key");

    await expect(resolveEmbeddingConfig()).resolves.toEqual({
      provider: "qwen",
      apiKey: "dedicated-key",
      baseUrl: "https://example.com/v1",
      model: "text-embedding-v3",
      maxJobsPerRun: 20,
      maxInputChars: 6000,
    });
  });
});

describe("embedding math", () => {
  it("normalizes vectors and computes cosine", () => {
    const vector = l2normalize([3, 4]);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
    expect(cosine(vector, vector)).toBeCloseTo(1, 6);
  });
});

describe("embedTexts", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the OpenAI-compatible embeddings endpoint and normalizes output", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [3, 4] }] }),
    });

    const [vector] = await embedTexts(["hello"], {
      apiKey: "test-key",
      baseUrl: "https://api.openai.com",
      model: "text-embedding-3-small",
      maxInputChars: 6000,
    });

    expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.any(Object),
    );
  });

  it("truncates every input before sending it upstream", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0] }] }),
    });

    await embedTexts(["  abcdef  "], {
      apiKey: "test-key",
      baseUrl: "https://api.openai.com",
      model: "text-embedding-3-small",
      maxInputChars: 4,
    });

    const request = vi.mocked(global.fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "text-embedding-3-small",
      input: ["abcd"],
    });
  });

  it("does not expose upstream response bodies in errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      embedTexts(["hello"], {
        apiKey: "test-key",
        baseUrl: "https://x",
        model: "m",
        maxInputChars: 6000,
      }),
    ).rejects.toBeInstanceOf(EmbeddingError);
  });
});
