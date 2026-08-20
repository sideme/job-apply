import type { AgentMessage, AgentToolCall, AgentTurn } from "../types";
import { buildHeaders, joinUrl } from "../utils/http";
import { getNestedValue } from "../utils/object";
import {
  buildChatCompletionsBody,
  createProviderStrategy,
  extractChatCompletionsText,
} from "./factory";

const CHAT_COMPLETIONS_SUFFIX = "/v1/chat/completions";
const MODELS_SUFFIX = "/v1/models";
const API_VERSION_SUFFIX = "/v1";

function normalizeBaseUrlOrEndpoint(baseUrlOrEndpoint: string): string {
  return baseUrlOrEndpoint.trim().replace(/\/+$/, "");
}

function appendVersionedPath(baseUrl: string, path: string): string {
  if (baseUrl.endsWith(API_VERSION_SUFFIX)) {
    return joinUrl(baseUrl.slice(0, -API_VERSION_SUFFIX.length), path);
  }
  return joinUrl(baseUrl, path);
}

function resolveChatCompletionsUrl(baseUrlOrEndpoint: string): string {
  const normalized = normalizeBaseUrlOrEndpoint(baseUrlOrEndpoint);
  if (
    normalized.endsWith(CHAT_COMPLETIONS_SUFFIX) ||
    normalized.endsWith("/chat/completions")
  ) {
    return normalized;
  }
  return appendVersionedPath(normalized, CHAT_COMPLETIONS_SUFFIX);
}

function resolveModelsUrl(baseUrlOrEndpoint: string): string {
  const normalized = normalizeBaseUrlOrEndpoint(baseUrlOrEndpoint);
  if (normalized.endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }
  if (normalized.endsWith("/chat/completions")) {
    return normalized.replace(/\/chat\/completions$/, "/models");
  }
  return appendVersionedPath(normalized, MODELS_SUFFIX);
}

function toWireAgentMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role !== "assistant") return message;

  return {
    role: "assistant",
    content: message.content,
    ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
    ...(message.reasoningContent !== undefined
      ? { reasoning_content: message.reasoningContent }
      : {}),
  };
}

function parseAgentToolCalls(value: unknown): AgentToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new Error("Invalid agent tool_calls response");
  return value.map((call) => {
    if (!call || typeof call !== "object") {
      throw new Error("Invalid agent tool call");
    }
    const record = call as Record<string, unknown>;
    const fn = record.function;
    if (!fn || typeof fn !== "object") {
      throw new Error("Invalid agent tool function");
    }
    const functionRecord = fn as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      record.type !== "function" ||
      typeof functionRecord.name !== "string" ||
      typeof functionRecord.arguments !== "string"
    ) {
      throw new Error("Invalid agent tool call fields");
    }
    return {
      id: record.id,
      type: "function",
      function: {
        name: functionRecord.name,
        arguments: functionRecord.arguments,
      },
    };
  });
}

function extractAgentTurn(response: unknown): AgentTurn {
  const rawMessage = getNestedValue(response, ["choices", 0, "message"]);
  if (!rawMessage || typeof rawMessage !== "object") {
    throw new Error("No assistant message in agent response");
  }
  const message = rawMessage as Record<string, unknown>;
  if (message.content !== null && typeof message.content !== "string") {
    throw new Error("Invalid assistant content in agent response");
  }
  const reasoningContent = message.reasoning_content;
  if (
    reasoningContent !== undefined &&
    reasoningContent !== null &&
    typeof reasoningContent !== "string"
  ) {
    throw new Error("Invalid reasoning content in agent response");
  }
  const finishReason = getNestedValue(response, [
    "choices",
    0,
    "finish_reason",
  ]);
  const promptTokens = getNestedValue(response, ["usage", "prompt_tokens"]);
  const completionTokens = getNestedValue(response, [
    "usage",
    "completion_tokens",
  ]);

  return {
    message: {
      role: "assistant",
      content: message.content,
      toolCalls: parseAgentToolCalls(message.tool_calls),
      ...(reasoningContent !== undefined
        ? { reasoningContent: reasoningContent as string | null }
        : {}),
    },
    finishReason: typeof finishReason === "string" ? finishReason : null,
    usage: {
      inputTokens:
        typeof promptTokens === "number" && Number.isFinite(promptTokens)
          ? Math.max(0, Math.trunc(promptTokens))
          : 0,
      outputTokens:
        typeof completionTokens === "number" &&
        Number.isFinite(completionTokens)
          ? Math.max(0, Math.trunc(completionTokens))
          : 0,
    },
  };
}

export function createOpenAiCompatibleStrategy(args: {
  provider: "openai_compatible" | "deepseek" | "qwen";
  defaultBaseUrl: string;
}) {
  return createProviderStrategy({
    provider: args.provider,
    defaultBaseUrl: args.defaultBaseUrl,
    requiresApiKey: true,
    modes: ["json_schema", "json_object", "text", "none"],
    validationPaths: ["/v1/models"],
    getValidationUrls: ({ baseUrl }) => [resolveModelsUrl(baseUrl)],
    buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => {
      return {
        url: resolveChatCompletionsUrl(baseUrl),
        headers: buildHeaders({ apiKey, provider: args.provider }),
        body: buildChatCompletionsBody({ mode, model, messages, jsonSchema }),
      };
    },
    extractText: extractChatCompletionsText,
    buildAgentRequest: ({
      baseUrl,
      apiKey,
      model,
      messages,
      tools,
      maxOutputTokens,
    }) => ({
      url: resolveChatCompletionsUrl(baseUrl),
      headers: buildHeaders({ apiKey, provider: args.provider }),
      body: {
        model,
        messages: messages.map(toWireAgentMessage),
        tools: tools.map((tool) => ({ type: "function", function: tool })),
        tool_choice: "auto",
        stream: false,
        max_tokens: maxOutputTokens,
        ...(args.provider === "deepseek"
          ? { thinking: { type: "disabled" } }
          : {}),
      },
    }),
    extractAgentTurn,
  });
}

export const openAiCompatibleStrategy = createOpenAiCompatibleStrategy({
  provider: "openai_compatible",
  defaultBaseUrl: "https://api.openai.com",
});
