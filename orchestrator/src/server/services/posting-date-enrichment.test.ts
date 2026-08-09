import { createJob as createTestJob } from "@shared/testing/factories";
import { describe, expect, it, vi } from "vitest";
import {
  enrichJobPostingDate,
  getPostingDetailUrl,
  normalizeExactPostingDate,
  parseExactPostingDateFromHtml,
} from "./posting-date-enrichment";

vi.mock("@server/repositories/jobs", () => ({
  getJobsNeedingPostingDateCheck: vi.fn(async () => []),
  markPostingDateChecked: vi.fn(async () => null),
}));

describe("posting date enrichment", () => {
  it("extracts an exact date from nested JobPosting JSON-LD", () => {
    const html = `<script type="application/ld+json">{
      "@graph": [{"@type":"JobPosting","datePosted":"2026-08-09T14:35:12-04:00"}]
    }</script>`;
    expect(parseExactPostingDateFromHtml(html)).toBe(
      String(Date.parse("2026-08-09T14:35:12-04:00")),
    );
  });

  it("does not present a date-only value as an exact time", () => {
    expect(normalizeExactPostingDate("2026-08-09")).toBeNull();
    expect(
      parseExactPostingDateFromHtml(
        '<meta itemprop="datePosted" content="2026-08-09">',
      ),
    ).toBeNull();
  });

  it("only fetches known listing hosts and skips Glassdoor", async () => {
    const glassdoorJob = createTestJob({
      source: "glassdoor",
      jobUrl: "https://www.glassdoor.com/job-listing/example",
    });
    expect(getPostingDetailUrl(glassdoorJob)).toBeNull();

    const unsafeJob = createTestJob({
      source: "indeed",
      jobUrl: "http://127.0.0.1/private",
    });
    expect(getPostingDetailUrl(unsafeJob)).toBeNull();
  });

  it("fetches a supported detail page and stores its exact timestamp", async () => {
    const job = createTestJob({
      source: "indeed",
      jobUrl: "https://ca.indeed.com/viewjob?jk=123",
      datePosted: String(Date.parse("2026-08-09T00:00:00Z")),
    });
    const fetchImpl = async () =>
      new Response(
        '<meta itemprop="datePosted" content="2026-08-09T09:45:00Z">',
        { status: 200, headers: { "content-type": "text/html" } },
      );

    const result = await enrichJobPostingDate(job, fetchImpl as typeof fetch);
    expect(result).toEqual({
      status: "updated",
      datePosted: String(Date.parse("2026-08-09T09:45:00Z")),
    });
  });
});
