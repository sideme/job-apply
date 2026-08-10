import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import {
  formatWhatsAppEvent,
  notifyHighMatchJobs,
  sendWhatsAppMessage,
} from "./whatsapp";

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

  it("summarizes only jobs at or above the high-match threshold", async () => {
    await notifyHighMatchJobs(
      [
        {
          id: "high",
          title: "Senior Backend Engineer",
          employer: "Acme",
          suitabilityScore: 92,
          applicationLink: "https://jobs.example.com/high",
          jobUrlDirect: null,
          jobUrl: "https://example.com/high",
        },
        {
          id: "low",
          title: "Junior Engineer",
          employer: "Acme",
          suitabilityScore: 65,
          applicationLink: null,
          jobUrlDirect: null,
          jobUrl: "https://example.com/low",
        },
      ],
      80,
    );

    expect(global.fetch).toHaveBeenCalledOnce();
    const requestUrl = new URL(
      String(vi.mocked(global.fetch).mock.calls[0]?.[0]),
    );
    expect(requestUrl.searchParams.get("text")).toContain(
      "Senior Backend Engineer",
    );
    expect(requestUrl.searchParams.get("text")).not.toContain(
      "Junior Engineer",
    );
  });

  it("formats submission and interview messages without email bodies", () => {
    expect(
      formatWhatsAppEvent("application.submitted", {
        title: "Platform Engineer",
        employer: "Example Co",
      }),
    ).toContain("application submitted");
    expect(
      formatWhatsAppEvent("interview.received", {
        title: "Platform Engineer",
        employer: "Example Co",
        subject: "Interview invitation",
        body: "private email body",
      }),
    ).not.toContain("private email body");
  });
});
