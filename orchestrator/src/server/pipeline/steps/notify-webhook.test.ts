import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import { notifyPipelineWebhookStep } from "./notify-webhook";

describe("notifyPipelineWebhookStep", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts a linkedin.circuit_breaker_tripped event with the cooldown detail", async () => {
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(
      "https://example.com/hook",
    );

    await notifyPipelineWebhookStep("linkedin.circuit_breaker_tripped", {
      cooldownUntil: "2026-08-07T18:00:00.000Z",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("linkedin.circuit_breaker_tripped"),
      }),
    );
    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall).toBeDefined();
    const body = JSON.parse((fetchCall?.[1]?.body ?? "") as string);
    expect(body.cooldownUntil).toBe("2026-08-07T18:00:00.000Z");
  });
});
