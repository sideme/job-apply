import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Settings API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        LLM_API_KEY: "secret-key",
      },
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns settings with defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.model.default).toBe("test-model");
    expect(Array.isArray(body.data.searchTerms.value)).toBe(true);
    expect(body.data.llmApiKeyHint).toBe("secr");
    expect(body.data.basicAuthActive).toBe(false);
  });

  it("normalizes hyphenated openai-compatible env defaults", async () => {
    const hyphenated = await startServer({
      env: {
        LLM_API_KEY: "secret-key",
        LLM_PROVIDER: "openai-compatible",
      },
    });

    try {
      const res = await fetch(`${hyphenated.baseUrl}/api/settings`);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.data.llmProvider.default).toBe("openai_compatible");
      expect(body.data.llmProvider.value).toBe("openai_compatible");
      expect(body.data.llmBaseUrl.default).toBe("https://api.openai.com");
    } finally {
      await stopServer(hyphenated);
    }
  });

  it("rejects invalid settings updates and persists overrides", async () => {
    const badPatch = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobspyResultsWanted: 9999 }),
    });
    expect(badPatch.status).toBe(400);

    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchTerms: ["engineer"],
        llmApiKey: "updated-secret",
        whatsappEnabled: true,
        whatsappPhone: "+14165551234",
        whatsappApiKey: "whatsapp-secret",
      }),
    });
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.searchTerms.value).toEqual(["engineer"]);
    expect(patchBody.data.searchTerms.override).toEqual(["engineer"]);
    expect(patchBody.data.llmApiKeyHint).toBe("upda");
    expect(patchBody.data.whatsappEnabled.value).toBe(true);
    expect(patchBody.data.whatsappPhone.value).toBe("+14165551234");
    expect(patchBody.data.whatsappApiKeyHint).toBe("what");
  });

  it("returns a structured error when WhatsApp is not configured", async () => {
    const res = await fetch(`${baseUrl}/api/settings/whatsapp/test`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("validates basic auth requirements", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enableBasicAuth: true,
        basicAuthUser: "",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("Username is required");
  });

  it("handles salary penalty settings with validation", async () => {
    // Get initial settings
    const initialRes = await fetch(`${baseUrl}/api/settings`);
    const initialBody = await initialRes.json();
    expect(initialBody.ok).toBe(true);
    expect(initialBody.data.penalizeMissingSalary.value).toBe(false);
    expect(initialBody.data.missingSalaryPenalty.value).toBe(10);

    // Test invalid penalty values
    const invalidRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingSalaryPenalty: 150 }),
    });
    expect(invalidRes.status).toBe(400);

    const negativeRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingSalaryPenalty: -10 }),
    });
    expect(negativeRes.status).toBe(400);

    // Test valid settings update
    const validRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        penalizeMissingSalary: true,
        missingSalaryPenalty: 20,
      }),
    });
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.data.penalizeMissingSalary.value).toBe(true);
    expect(validBody.data.penalizeMissingSalary.override).toBe(true);
    expect(validBody.data.missingSalaryPenalty.value).toBe(20);
    expect(validBody.data.missingSalaryPenalty.override).toBe(20);

    // Verify persistence
    const getRes = await fetch(`${baseUrl}/api/settings`);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data.penalizeMissingSalary.value).toBe(true);
    expect(getBody.data.missingSalaryPenalty.value).toBe(20);
  });
});
