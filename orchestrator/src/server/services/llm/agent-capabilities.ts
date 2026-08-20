import type { LlmProvider } from "./types";

export type AgentThinkingMode = "non-thinking" | "thinking";

export type AgentToolCapabilities = {
  supported: boolean;
  verified: boolean;
  supportsToolChoice: boolean;
  requiresAssistantContent: boolean;
  requiresReasoningContentReplay: boolean;
  reason: string | null;
};

const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

/**
 * Agent tools remain deny-by-default. A provider/model/mode is enabled only
 * after a real, sanitized conformance probe has been recorded and covered by
 * protocol tests.
 */
export function getAgentToolCapabilities(args: {
  provider: LlmProvider;
  model: string;
  thinkingMode?: AgentThinkingMode;
}): AgentToolCapabilities {
  const model = args.model.trim().toLowerCase();
  const thinkingMode = args.thinkingMode ?? "non-thinking";

  if (args.provider !== "deepseek" || !DEEPSEEK_V4_MODELS.has(model)) {
    return {
      supported: false,
      verified: false,
      supportsToolChoice: false,
      requiresAssistantContent: false,
      requiresReasoningContentReplay: false,
      reason: "Provider/model tool protocol has not passed conformance testing",
    };
  }

  if (thinkingMode === "thinking") {
    return {
      supported: false,
      verified: false,
      supportsToolChoice: false,
      requiresAssistantContent: true,
      requiresReasoningContentReplay: true,
      reason: "DeepSeek V4 thinking-mode tools are not enabled until probed",
    };
  }

  return {
    supported: true,
    verified: model === "deepseek-v4-flash",
    supportsToolChoice: true,
    requiresAssistantContent: true,
    requiresReasoningContentReplay: false,
    reason:
      model === "deepseek-v4-flash"
        ? null
        : "DeepSeek V4 Pro uses the compatible protocol but still needs a recorded probe",
  };
}

export class AgentUnavailableError extends Error {
  readonly code = "AGENT_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export function requireVerifiedAgentTools(args: {
  provider: LlmProvider;
  model: string;
  thinkingMode?: AgentThinkingMode;
}): AgentToolCapabilities {
  const capabilities = getAgentToolCapabilities(args);
  if (!capabilities.supported || !capabilities.verified) {
    throw new AgentUnavailableError(
      capabilities.reason ?? "Agent tool protocol is unavailable",
    );
  }
  return capabilities;
}
