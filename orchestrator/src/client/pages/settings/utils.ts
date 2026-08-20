/**
 * Settings page helpers.
 */

import type { ResumeProjectsSettings } from "@shared/types";
import { arraysEqual } from "@/lib/utils";

export function resumeProjectsEqual(
  a: ResumeProjectsSettings,
  b: ResumeProjectsSettings,
) {
  return (
    a.maxProjects === b.maxProjects &&
    arraysEqual(a.lockedProjectIds, b.lockedProjectIds) &&
    arraysEqual(a.aiSelectableProjectIds, b.aiSelectableProjectIds)
  );
}

export const formatSecretHint = (hint: string | null) =>
  hint ? `${hint}********` : "Not set";

export const LLM_PROVIDERS = [
  "openrouter",
  "lmstudio",
  "ollama",
  "openai",
  "openai_compatible",
  "gemini",
  "deepseek",
  "qwen",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_LABELS: Record<LlmProviderId, string> = {
  openrouter: "OpenRouter",
  lmstudio: "LM Studio",
  ollama: "Ollama",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
};

// Only providers our OpenAI-compatible embedding client can actually use.
// (DeepSeek has no embeddings; Gemini's native shape is unsupported in v1.)
export const EMBEDDING_PROVIDERS = [
  "openai",
  "qwen",
  "openai_compatible",
] as const;

export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDERS)[number];

export const EMBEDDING_PROVIDER_LABELS: Record<EmbeddingProviderId, string> = {
  openai: "OpenAI",
  qwen: "Qwen (DashScope compatible)",
  openai_compatible: "OpenAI-compatible (custom)",
};

// Selecting a provider fills these as editable defaults for base URL + model.
// openai_compatible intentionally leaves both blank for a custom endpoint.
export const EMBEDDING_PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string; model: string }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "text-embedding-v3",
  },
  openai_compatible: { baseUrl: "", model: "" },
};

const PROVIDERS_WITH_API_KEY = new Set<LlmProviderId>([
  "openrouter",
  "openai",
  "openai_compatible",
  "gemini",
  "deepseek",
  "qwen",
]);

const PROVIDERS_WITH_BASE_URL = new Set<LlmProviderId>([
  "lmstudio",
  "ollama",
  "openai_compatible",
  "deepseek",
  "qwen",
]);

const PROVIDER_HINTS: Record<LlmProviderId, string> = {
  openrouter:
    "OpenRouter uses your API key and supports model routing across providers.",
  lmstudio: "LM Studio runs locally via its OpenAI-compatible server.",
  ollama: "Ollama typically runs locally and does not require an API key.",
  openai: "OpenAI uses the Responses API with structured outputs.",
  openai_compatible:
    "Use a bearer token with any chat-completions-compatible endpoint.",
  gemini: "Gemini uses the native AI Studio API and requires a key.",
  deepseek:
    "DeepSeek uses an OpenAI-compatible API. Use deepseek-v4-flash by default; it requires a DeepSeek API key.",
  qwen: "Qwen uses Alibaba Cloud Model Studio's OpenAI-compatible API and requires an API key.",
};

const PROVIDER_KEY_HELPERS: Record<LlmProviderId, string> = {
  openrouter: "Create a key at openrouter.ai",
  lmstudio: "No API key required for LM Studio",
  ollama: "No API key required for Ollama",
  openai: "Create a key at platform.openai.com",
  openai_compatible: "Use the bearer token issued by your compatible provider",
  gemini: "Create a key at aistudio.google.com/api-keys",
  deepseek: "Create a key at platform.deepseek.com",
  qwen: "Create a key in Alibaba Cloud Model Studio",
};

const BASE_URL_PROVIDERS = [
  "lmstudio",
  "ollama",
  "openai_compatible",
  "deepseek",
  "qwen",
] as const;
type BaseUrlProviderId = (typeof BASE_URL_PROVIDERS)[number];

const PROVIDER_BASE_URLS: Record<BaseUrlProviderId, string> = {
  lmstudio: "http://localhost:1234",
  ollama: "http://localhost:11434",
  openai_compatible: "https://api.example.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

export function normalizeLlmProvider(
  value: string | null | undefined,
): LlmProviderId {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "openrouter";
  if (normalized === "openai-compatible") return "openai_compatible";
  return (LLM_PROVIDERS as readonly string[]).includes(normalized)
    ? (normalized as LlmProviderId)
    : "openrouter";
}

export function getLlmProviderConfig(provider: string | null | undefined) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const showApiKey = PROVIDERS_WITH_API_KEY.has(normalizedProvider);
  const showBaseUrl = PROVIDERS_WITH_BASE_URL.has(normalizedProvider);
  const baseUrlPlaceholder = showBaseUrl
    ? PROVIDER_BASE_URLS[normalizedProvider as BaseUrlProviderId]
    : "";
  const baseUrlHelper = showBaseUrl
    ? normalizedProvider === "openai_compatible"
      ? "Enter a base URL or a full /v1/chat/completions endpoint."
      : normalizedProvider === "deepseek" || normalizedProvider === "qwen"
        ? "Default endpoint is preconfigured; override it only for a compatible gateway."
        : `Default: ${baseUrlPlaceholder}`
    : "";
  const providerHint = PROVIDER_HINTS[normalizedProvider];
  const keyHelper = PROVIDER_KEY_HELPERS[normalizedProvider];

  return {
    normalizedProvider,
    label: LLM_PROVIDER_LABELS[normalizedProvider],
    showApiKey,
    showBaseUrl,
    requiresApiKey: showApiKey,
    baseUrlPlaceholder,
    baseUrlHelper,
    providerHint,
    keyHelper,
  };
}
