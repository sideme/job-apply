import { createAppSettings, createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import { compareJobs, getEnabledSources, getJobCounts } from "./utils";

describe("orchestrator utils", () => {
  it("enables adzuna only when both app id and key are configured", () => {
    const withCreds = createAppSettings({
      adzunaAppId: "app-id",
      adzunaAppKeyHint: "key-",
    });
    const withoutKey = createAppSettings({
      adzunaAppId: "app-id",
      adzunaAppKeyHint: null,
    });

    expect(getEnabledSources(withCreds)).toContain("adzuna");
    expect(getEnabledSources(withoutKey)).not.toContain("adzuna");
  });

  it("only exposes sources with an extractor in this build", () => {
    const enabledSources = getEnabledSources(createAppSettings());

    expect(enabledSources).toEqual(["indeed", "linkedin"]);
    expect(enabledSources).not.toContain("glassdoor");
    expect(enabledSources).not.toContain("gradcracker");
    expect(enabledSources).not.toContain("ukvisajobs");
    expect(enabledSources).not.toContain("hiringcafe");
    expect(enabledSources).not.toContain("startupjobs");
  });

  it("counts processing jobs in ready and discovered tabs", () => {
    const jobs = [
      createJob({ id: "ready", status: "ready", closedAt: null }),
      createJob({ id: "processing", status: "processing", closedAt: null }),
      createJob({ id: "discovered", status: "discovered", closedAt: null }),
      createJob({ id: "applied", status: "applied", closedAt: null }),
    ];

    expect(getJobCounts(jobs)).toEqual({
      ready: 2,
      discovered: 2,
      applied: 1,
      all: 4,
    });
  });

  it("sorts by source posting time before discovery time", () => {
    const earlierPostDiscoveredLater = createJob({
      id: "earlier-post",
      datePosted: "1786060800000",
      discoveredAt: "2026-08-09T10:00:00.000Z",
    });
    const laterPostDiscoveredEarlier = createJob({
      id: "later-post",
      datePosted: "1786147200000",
      discoveredAt: "2026-08-08T10:00:00.000Z",
    });

    expect(
      compareJobs(earlierPostDiscoveredLater, laterPostDiscoveredEarlier, {
        key: "discoveredAt",
        direction: "desc",
      }),
    ).toBeGreaterThan(0);
  });

  it("ranks higher ATS first within the same posting day", () => {
    const highScoreSameDay = createJob({
      id: "high",
      datePosted: "1786406400000",
      suitabilityScore: 83,
    });
    const lowScoreSameDay = createJob({
      id: "low",
      datePosted: "1786406400000",
      suitabilityScore: 66,
    });

    // Newest-first: same day resolves to the higher ATS match ahead.
    expect(
      compareJobs(highScoreSameDay, lowScoreSameDay, {
        key: "discoveredAt",
        direction: "desc",
      }),
    ).toBeLessThan(0);
    // The score tiebreak is direction-independent.
    expect(
      compareJobs(highScoreSameDay, lowScoreSameDay, {
        key: "discoveredAt",
        direction: "asc",
      }),
    ).toBeLessThan(0);
  });

  it("treats enriched intra-day timestamps as the same day for ATS tiebreak", () => {
    const midnightHighScore = createJob({
      id: "midnight-high",
      datePosted: "1786406400000", // 2026-08-11 00:00
      suitabilityScore: 83,
    });
    const afternoonLowScore = createJob({
      id: "afternoon-low",
      datePosted: "1786456800000", // 2026-08-11 14:00 (same day, later time)
      suitabilityScore: 66,
    });

    expect(
      compareJobs(midnightHighScore, afternoonLowScore, {
        key: "discoveredAt",
        direction: "desc",
      }),
    ).toBeLessThan(0);
  });

  it("keeps a newer posting day ahead even with a lower ATS score", () => {
    const newerLowScore = createJob({
      id: "newer",
      datePosted: "1786492800000", // 2026-08-12
      suitabilityScore: 40,
    });
    const olderHighScore = createJob({
      id: "older",
      datePosted: "1786406400000", // 2026-08-11
      suitabilityScore: 95,
    });

    expect(
      compareJobs(newerLowScore, olderHighScore, {
        key: "discoveredAt",
        direction: "desc",
      }),
    ).toBeLessThan(0);
  });
});
