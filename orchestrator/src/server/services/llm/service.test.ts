import { describe, expect, it } from "vitest";
import { LlmService } from "./service";

describe("LlmService provider normalization", () => {
  it("keeps legacy localhost openai_compatible configs on LM Studio", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "http://localhost:1234",
    });

    expect(llm.getProvider()).toBe("lmstudio");
    expect(llm.getBaseUrl()).toBe("http://localhost:1234");
  });

  it("uses the dedicated provider for non-local OpenAI-compatible endpoints", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });

  it("normalizes the hyphenated openai-compatible alias", () => {
    const llm = new LlmService({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });

  it("keeps agent tools unavailable without a key or verified model", () => {
    expect(
      new LlmService({ provider: "deepseek" }).getAgentAvailability(
        "deepseek-v4-flash",
      ),
    ).toMatchObject({ available: false, reason: "LLM API key not configured" });
    expect(
      new LlmService({
        provider: "qwen",
        apiKey: "test-key",
      }).getAgentAvailability("qwen-plus"),
    ).toMatchObject({ available: false });
    expect(
      new LlmService({
        provider: "deepseek",
        apiKey: "test-key",
      }).getAgentAvailability("deepseek-v4-flash"),
    ).toEqual({ available: true, reason: null });
  });
});
