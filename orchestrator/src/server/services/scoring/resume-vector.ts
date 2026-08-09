import { createHash } from "node:crypto";
import { db, schema } from "@server/db";
import { extractLocalResumeText } from "@server/services/local-resume";
import { eq } from "drizzle-orm";
import type { EmbeddingConfig } from "./embedding-client";
import { embedTexts, prepareEmbeddingText } from "./embedding-client";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseCachedVector(value: string): number[] | null {
  try {
    const vector = JSON.parse(value) as unknown;
    return Array.isArray(vector) &&
      vector.length > 0 &&
      vector.every((item) => typeof item === "number")
      ? vector
      : null;
  } catch {
    return null;
  }
}

export async function getResumeVector(
  config: Pick<
    EmbeddingConfig,
    "apiKey" | "baseUrl" | "model" | "maxInputChars"
  >,
): Promise<{ text: string; vector: number[] | null }> {
  const text = await extractLocalResumeText();
  if (!text) return { text: "", vector: null };

  const embeddingText = prepareEmbeddingText(text, config.maxInputChars);
  const hash = hashText(embeddingText);
  const [cached] = await db
    .select()
    .from(schema.resumeEmbedding)
    .where(eq(schema.resumeEmbedding.hash, hash));
  const cachedVector =
    cached?.model === config.model ? parseCachedVector(cached.vector) : null;
  if (cachedVector) return { text, vector: cachedVector };

  const [vector] = await embedTexts([embeddingText], config);
  await db.delete(schema.resumeEmbedding);
  await db.insert(schema.resumeEmbedding).values({
    hash,
    model: config.model,
    vector: JSON.stringify(vector),
    updatedAt: new Date().toISOString(),
  });
  return { text, vector };
}
