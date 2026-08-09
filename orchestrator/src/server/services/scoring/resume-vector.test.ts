import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const values = vi.fn();
  return {
    embedTexts: vi.fn(),
    extractLocalResumeText: vi.fn(),
    values,
    where,
    db: {
      select: vi.fn(() => ({ from: () => ({ where }) })),
      delete: vi.fn(() => ({})),
      insert: vi.fn(() => ({ values })),
    },
  };
});

vi.mock("@server/db", () => ({
  db: mocks.db,
  schema: { resumeEmbedding: { hash: "hash" } },
}));
vi.mock("@server/services/local-resume", () => ({
  extractLocalResumeText: mocks.extractLocalResumeText,
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("./embedding-client", () => ({
  embedTexts: mocks.embedTexts,
  prepareEmbeddingText: (text: string, max: number) => text.slice(0, max),
}));

import { getResumeVector, hashText } from "./resume-vector";

const config = {
  apiKey: "key",
  baseUrl: "https://api.example",
  model: "m",
  maxInputChars: 6000,
};

afterEach(() => vi.clearAllMocks());

describe("getResumeVector", () => {
  it("returns no vector without text extracted from the PDF", async () => {
    mocks.extractLocalResumeText.mockResolvedValue("");

    await expect(getResumeVector(config)).resolves.toEqual({
      text: "",
      vector: null,
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("reuses a vector with the same resume hash and model", async () => {
    mocks.extractLocalResumeText.mockResolvedValue("resume content");
    mocks.where.mockResolvedValue([
      { model: "m", vector: JSON.stringify([0.1, 0.2]) },
    ]);

    const result = await getResumeVector(config);

    expect(result.vector).toEqual([0.1, 0.2]);
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("embeds and caches when the model changes", async () => {
    mocks.extractLocalResumeText.mockResolvedValue("resume content");
    mocks.where.mockResolvedValue([
      { model: "old-model", vector: JSON.stringify([0.1, 0.2]) },
    ]);
    mocks.embedTexts.mockResolvedValue([[0.3, 0.4]]);

    const result = await getResumeVector(config);

    expect(result.vector).toEqual([0.3, 0.4]);
    expect(mocks.embedTexts).toHaveBeenCalledWith(["resume content"], config);
    expect(mocks.db.delete).toHaveBeenCalled();
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: hashText("resume content"),
        model: "m",
        vector: JSON.stringify([0.3, 0.4]),
      }),
    );
  });
});
