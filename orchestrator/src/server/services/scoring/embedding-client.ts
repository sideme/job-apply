import { getSetting } from "@server/repositories/settings";
import { getEffectiveSettings } from "@server/services/settings";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export type EmbeddingConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxJobsPerRun: number;
  maxInputChars: number;
};

export function prepareEmbeddingText(
  text: string,
  maxInputChars: number,
): string {
  const normalized = text.trim();
  return normalized.length <= maxInputChars
    ? normalized
    : normalized.slice(0, maxInputChars);
}

export function l2normalize(vector: number[]): number[] {
  const magnitude = Math.hypot(...vector);
  return magnitude === 0
    ? vector.map(() => 0)
    : vector.map((value) => value / magnitude);
}

/** Inputs must be normalized. Dimension mismatches produce no semantic score. */
export function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function embeddingUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/embeddings")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/embeddings`;
  return `${normalized}/v1/embeddings`;
}

export async function resolveEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const [settings, embeddingApiKey] = await Promise.all([
    getEffectiveSettings(),
    getSetting("embeddingApiKey"),
  ]);
  if (!settings.embeddingEnabled.value) return null;

  const provider = settings.embeddingProvider || "openai";
  const apiKey = embeddingApiKey || process.env.EMBEDDING_API_KEY;
  const baseUrl = settings.embeddingBaseUrl || process.env.EMBEDDING_BASE_URL;
  if (!apiKey || !baseUrl) return null;

  return {
    provider,
    apiKey,
    baseUrl,
    model: settings.embeddingModel.value,
    maxJobsPerRun: settings.embeddingMaxJobsPerRun.value,
    maxInputChars: settings.embeddingMaxInputChars.value,
  };
}

export async function embedTexts(
  texts: string[],
  config: Pick<
    EmbeddingConfig,
    "apiKey" | "baseUrl" | "model" | "maxInputChars"
  >,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  let response: Response;
  try {
    response = await fetch(embeddingUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: texts.map((text) =>
          prepareEmbeddingText(text, config.maxInputChars),
        ),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new EmbeddingError(
      `Embedding request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  if (!response.ok) {
    throw new EmbeddingError(
      `Embedding API request failed with status ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    data?: Array<{ embedding?: unknown }>;
  };
  if (!body.data || body.data.length !== texts.length) {
    throw new EmbeddingError(
      "Embedding API returned an unexpected response shape",
    );
  }

  return body.data.map((item) => {
    if (
      !Array.isArray(item.embedding) ||
      item.embedding.length === 0 ||
      item.embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new EmbeddingError("Embedding API returned an invalid vector");
    }
    return l2normalize(item.embedding);
  });
}
