import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Onboarding API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
    global.fetch = originalFetch;
  });

  describe("POST /api/onboarding/validate/openrouter", () => {
    it("returns invalid when no API key is provided and none in env", async () => {
      const res = await fetch(`${baseUrl}/api/onboarding/validate/openrouter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.message).toContain("missing");
    });

    it("returns invalid when API key is empty string", async () => {
      const res = await fetch(`${baseUrl}/api/onboarding/validate/openrouter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "   " }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.message).toContain("missing");
    });

    it("validates an invalid API key against OpenRouter", async () => {
      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://openrouter.ai/api/v1/key")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: "invalid api key" } }),
          } as Response);
        }
        return originalFetch(input, init);
      });
      const res = await fetch(`${baseUrl}/api/onboarding/validate/openrouter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "test-api-key-not-secret" }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      // Should be invalid because the key is fake
      expect(body.data.valid).toBe(false);
    });
  });

  describe("POST /api/onboarding/validate/llm", () => {
    it("maps Gemini 403 key validation failures to an invalid-key message", async () => {
      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (
          url.startsWith(
            "https://generativelanguage.googleapis.com/v1beta/models?",
          )
        ) {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: async () => ({
              error: {
                code: 403,
                message:
                  "Method doesn't allow unregistered callers. Please use API key.",
                status: "PERMISSION_DENIED",
              },
            }),
          } as Response);
        }
        return originalFetch(input, init);
      });

      const res = await fetch(`${baseUrl}/api/onboarding/validate/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          apiKey: "invalid-gemini-key",
        }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.message).toBe(
        "Invalid LLM API key. Check the key and try again.",
      );
    });

    it("ignores baseUrl for Gemini and validates against the Gemini API", async () => {
      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (
          url.startsWith(
            "https://generativelanguage.googleapis.com/v1beta/models?",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ models: [] }),
          } as Response);
        }
        if (url.startsWith("http://localhost:1234")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: "bad local auth" } }),
          } as Response);
        }
        return originalFetch(input, init);
      });

      const res = await fetch(`${baseUrl}/api/onboarding/validate/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          apiKey: "valid-gemini-key",
          baseUrl: "http://localhost:1234",
        }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.message).toBeNull();
    });

    it("falls back to stored settings when request omits apiKey", async () => {
      await fetch(`${baseUrl}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider: "gemini",
          llmApiKey: "db-gemini-key",
        }),
      });
      delete process.env.LLM_API_KEY;

      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (
          url.startsWith(
            "https://generativelanguage.googleapis.com/v1beta/models?",
          )
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ models: [] }),
          } as Response);
        }
        return originalFetch(input, init);
      });

      const res = await fetch(`${baseUrl}/api/onboarding/validate/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gemini" }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.message).toBeNull();
      const fetchCalls = vi.mocked(global.fetch).mock.calls.map((call) => {
        const requestInput = call[0];
        if (typeof requestInput === "string") return requestInput;
        if (requestInput instanceof URL) return requestInput.href;
        return requestInput.url;
      });
      expect(
        fetchCalls.some((url) =>
          url.includes(
            "https://generativelanguage.googleapis.com/v1beta/models?key=db-gemini-key",
          ),
        ),
      ).toBe(true);
    });

    it("uses the provided baseUrl for the hyphenated OpenAI-compatible alias", async () => {
      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://llm.example.com/v1/models")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          } as Response);
        }
        if (url.startsWith("https://api.openai.com/v1/models")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: "wrong endpoint used" } }),
          } as Response);
        }
        return originalFetch(input, init);
      });

      const res = await fetch(`${baseUrl}/api/onboarding/validate/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compatible",
          apiKey: "test-compatible-key",
          baseUrl: "https://llm.example.com/v1/",
        }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.message).toBeNull();
      const fetchCalls = vi.mocked(global.fetch).mock.calls.map((call) => {
        const requestInput = call[0];
        if (typeof requestInput === "string") return requestInput;
        if (requestInput instanceof URL) return requestInput.href;
        return requestInput.url;
      });
      expect(
        fetchCalls.some((url) =>
          url.startsWith("https://llm.example.com/v1/models"),
        ),
      ).toBe(true);
      expect(
        fetchCalls.some((url) =>
          url.startsWith("https://api.openai.com/v1/models"),
        ),
      ).toBe(false);
    });

    it("does not reuse a stored baseUrl when openai-compatible validation is submitted with a blank baseUrl", async () => {
      await fetch(`${baseUrl}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider: "openai_compatible",
          llmApiKey: "stored-compatible-key",
          llmBaseUrl: "https://stale.example.com/v1/",
        }),
      });

      global.fetch = vi.fn((input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://api.openai.com/v1/models")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          } as Response);
        }
        if (url.startsWith("https://stale.example.com/v1/models")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: "stale endpoint used" } }),
          } as Response);
        }
        return originalFetch(input, init);
      });

      const res = await fetch(`${baseUrl}/api/onboarding/validate/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compatible",
          apiKey: "test-compatible-key",
          baseUrl: "   ",
        }),
      });
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.message).toBeNull();
      const fetchCalls = vi.mocked(global.fetch).mock.calls.map((call) => {
        const requestInput = call[0];
        if (typeof requestInput === "string") return requestInput;
        if (requestInput instanceof URL) return requestInput.href;
        return requestInput.url;
      });
      expect(
        fetchCalls.some((url) =>
          url.startsWith("https://api.openai.com/v1/models"),
        ),
      ).toBe(true);
      expect(
        fetchCalls.some((url) =>
          url.startsWith("https://stale.example.com/v1/models"),
        ),
      ).toBe(false);
    });
  });

  describe("GET /api/onboarding/validate/resume", () => {
    it("returns invalid when no local resume is uploaded", async () => {
      const res = await fetch(`${baseUrl}/api/onboarding/validate/resume`);
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.message).toContain("No resume uploaded");
    });
  });
});
