import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import { formatWhatsAppEvent, sendWhatsAppMessage } from "./whatsapp";

describe("WhatsApp notifications", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsRepo.getSetting).mockImplementation(async (key) => {
      if (key === "whatsappEnabled") return "1";
      if (key === "whatsappPhone") return "+14165551234";
      if (key === "whatsappApiKey") return "api-key";
      return null;
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "Message queued",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends a configured personal notification", async () => {
    await expect(sendWhatsAppMessage("Pipeline complete")).resolves.toEqual({
      sent: true,
    });
    const requestUrl = new URL(
      String(vi.mocked(global.fetch).mock.calls[0]?.[0]),
    );
    expect(requestUrl.hostname).toBe("api.callmebot.com");
    expect(requestUrl.searchParams.get("phone")).toBe("+14165551234");
    expect(requestUrl.searchParams.get("text")).toBe("Pipeline complete");
  });

  it("formats useful pipeline completion details", () => {
    expect(
      formatWhatsAppEvent("pipeline.completed", {
        jobsDiscovered: 12,
        jobsProcessed: 3,
      }),
    ).toContain("12 new jobs, 3 prepared");
  });
});
