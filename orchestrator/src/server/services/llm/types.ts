export type LlmProvider =
  | "openrouter"
  | "lmstudio"
  | "ollama"
  | "openai"
  | "openai_compatible"
  | "gemini"
  | "deepseek"
  | "qwen";

export type ResponseMode = "json_schema" | "json_object" | "text" | "none";

export interface JsonSchemaDefinition {
  name: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface LlmRequestOptions<_T> {
  /** The model to use (e.g., 'google/gemini-3-flash-preview') */
  model: string;
  /** The prompt messages to send */
  messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
  /** JSON schema for structured output */
  jsonSchema: JsonSchemaDefinition;
  /** Number of retries on parsing failures (default: 0) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 500) */
  retryDelayMs?: number;
  /** Job ID for logging purposes */
  jobId?: string;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
}

export interface LlmResult<T> {
  success: true;
  data: T;
}

export interface LlmError {
  success: false;
  error: string;
}

export type LlmResponse<T> = LlmResult<T> | LlmError;

export type LlmValidationResult = {
  valid: boolean;
  message: string | null;
};

export type LlmServiceOptions = {
  provider?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
};

export type ProviderStrategy = {
  provider: LlmProvider;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  modes: ResponseMode[];
  validationPaths: string[];
  buildRequest: (args: {
    mode: ResponseMode;
    baseUrl: string;
    apiKey: string | null;
    model: string;
    messages: LlmRequestOptions<unknown>["messages"];
    jsonSchema: JsonSchemaDefinition;
  }) => { url: string; headers: Record<string, string>; body: unknown };
  extractText: (response: unknown) => string | null;
  isCapabilityError: (args: {
    mode: ResponseMode;
    status?: number;
    body?: string;
  }) => boolean;
  getValidationUrls: (args: {
    baseUrl: string;
    apiKey: string | null;
  }) => string[];
  buildAgentRequest?: (args: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    messages: AgentMessage[];
    tools: AgentToolDefinition[];
    maxOutputTokens: number;
  }) => AgentProviderRequest;
  extractAgentTurn?: (response: unknown) => AgentTurn;
};

export interface LlmApiError extends Error {
  status?: number;
  body?: string;
}

export type AgentToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: AgentToolCall[];
      reasoningContent?: string | null;
    }
  | { role: "tool"; toolCallId: string; content: string };

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AgentTurn = {
  message: Extract<AgentMessage, { role: "assistant" }>;
  finishReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type AgentTurnRequestOptions = {
  model: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
  jobId?: string;
};

export type AgentTurnResponse =
  | { success: true; data: AgentTurn }
  | {
      success: false;
      error: string;
      code: "AGENT_UNAVAILABLE" | "REQUEST_FAILED" | "REQUEST_TIMEOUT";
    };

export type AgentProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};
