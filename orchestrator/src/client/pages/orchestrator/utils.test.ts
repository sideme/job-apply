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
});
