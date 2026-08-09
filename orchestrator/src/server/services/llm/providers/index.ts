import type { LlmProvider, ProviderStrategy } from "../types";
import { deepSeekStrategy } from "./deepseek";
import { geminiStrategy } from "./gemini";
import { lmStudioStrategy } from "./lmstudio";
import { ollamaStrategy } from "./ollama";
import { openAiStrategy } from "./openai";
import { openAiCompatibleStrategy } from "./openai-compatible";
import { openRouterStrategy } from "./openrouter";
import { qwenStrategy } from "./qwen";

export const strategies: Record<LlmProvider, ProviderStrategy> = {
  openrouter: openRouterStrategy,
  lmstudio: lmStudioStrategy,
  ollama: ollamaStrategy,
  openai: openAiStrategy,
  openai_compatible: openAiCompatibleStrategy,
  gemini: geminiStrategy,
  deepseek: deepSeekStrategy,
  qwen: qwenStrategy,
};
