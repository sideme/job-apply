import { describe, expect, it } from "vitest";
import {
  AgentUnavailableError,
  getAgentToolCapabilities,
  requireVerifiedAgentTools,
} from "./agent-capabilities";
import deepSeekFlashProbe from "./providers/fixtures/deepseek-v4-flash-tool-probe.json";

describe("agent tool capabilities", () => {
  it("enables only the empirically verified DeepSeek V4 Flash protocol", () => {
    const capabilities = requireVerifiedAgentTools({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinkingMode: "non-thinking",
    });

    expect(capabilities).toMatchObject({
      supported: true,
      verified: true,
      supportsToolChoice: true,
      requiresAssistantContent: true,
      requiresReasoningContentReplay: false,
    });
    expect(deepSeekFlashProbe.observed).toMatchObject({
      finishReason: "tool_calls",
      toolCallIdPresent: true,
      argumentsValid: true,
      roundTripSucceeded: true,
    });
  });

  it("keeps unprobed providers and modes deny-by-default", () => {
    expect(
      getAgentToolCapabilities({
        provider: "qwen",
        model: "qwen-plus",
      }).supported,
    ).toBe(false);
    expect(
      getAgentToolCapabilities({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        thinkingMode: "thinking",
      }),
    ).toMatchObject({
      supported: false,
      verified: false,
      requiresReasoningContentReplay: true,
    });
  });

  it("throws a typed degradation error instead of attempting an unknown protocol", () => {
    expect(() =>
      requireVerifiedAgentTools({
        provider: "openai_compatible",
        model: "custom-model",
      }),
    ).toThrow(AgentUnavailableError);
  });
});
