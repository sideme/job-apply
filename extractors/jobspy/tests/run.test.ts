import { describe, expect, it } from "vitest";
import {
  accumulateSiteError,
  type JobSpyProgressEvent,
  parseJobSpyProgressLine,
} from "../src/run";

describe("parseJobSpyProgressLine", () => {
  it("parses term_start progress lines", () => {
    const event = parseJobSpyProgressLine(
      'JOBOPS_PROGRESS {"event":"term_start","termIndex":1,"termTotal":3,"searchTerm":"engineer"}',
    );

    expect(event).toEqual({
      type: "term_start",
      termIndex: 1,
      termTotal: 3,
      searchTerm: "engineer",
    });
  });

  it("parses term_complete progress lines", () => {
    const event = parseJobSpyProgressLine(
      'JOBOPS_PROGRESS {"event":"term_complete","termIndex":2,"termTotal":3,"searchTerm":"frontend","jobsFoundTerm":17}',
    );

    expect(event).toEqual({
      type: "term_complete",
      termIndex: 2,
      termTotal: 3,
      searchTerm: "frontend",
      jobsFoundTerm: 17,
    });
  });

  it("returns null for malformed payloads", () => {
    expect(parseJobSpyProgressLine("JOBOPS_PROGRESS {bad json")).toBeNull();
    expect(parseJobSpyProgressLine("JOBOPS_PROGRESS {}")).toBeNull();
  });

  it("returns null for non-progress lines", () => {
    expect(parseJobSpyProgressLine("Found 20 jobs")).toBeNull();
  });
});

describe("parseJobSpyProgressLine - site_error", () => {
  it("parses a site_error progress line", () => {
    const line =
      'JOBOPS_PROGRESS {"event":"site_error","termIndex":1,"termTotal":1,"searchTerm":"backend engineer","site":"linkedin","error":"HTTPError: 429"}';
    const event = parseJobSpyProgressLine(line);
    expect(event).toEqual({
      type: "site_error",
      termIndex: 1,
      termTotal: 1,
      searchTerm: "backend engineer",
      site: "linkedin",
      error: "HTTPError: 429",
    });
  });

  it("returns null for a site_error line missing the site field", () => {
    const line =
      'JOBOPS_PROGRESS {"event":"site_error","termIndex":1,"termTotal":1,"searchTerm":"x","error":"boom"}';
    expect(parseJobSpyProgressLine(line)).toBeNull();
  });
});

describe("accumulateSiteError", () => {
  it("adds site_error events to the accumulator", () => {
    const siteErrors: Array<{ site: string; error: string }> = [];

    const event: JobSpyProgressEvent = {
      type: "site_error",
      termIndex: 1,
      termTotal: 1,
      searchTerm: "backend engineer",
      site: "linkedin",
      error: "HTTPError: 429",
    };

    accumulateSiteError(siteErrors, event);

    expect(siteErrors).toEqual([{ site: "linkedin", error: "HTTPError: 429" }]);
  });

  it("ignores non-site_error events", () => {
    const siteErrors: Array<{ site: string; error: string }> = [];

    const termStartEvent: JobSpyProgressEvent = {
      type: "term_start",
      termIndex: 1,
      termTotal: 1,
      searchTerm: "backend engineer",
    };

    const termCompleteEvent: JobSpyProgressEvent = {
      type: "term_complete",
      termIndex: 1,
      termTotal: 1,
      searchTerm: "backend engineer",
      jobsFoundTerm: 5,
    };

    accumulateSiteError(siteErrors, termStartEvent);
    accumulateSiteError(siteErrors, termCompleteEvent);

    expect(siteErrors).toEqual([]);
  });

  it("accumulates multiple site_error events", () => {
    const siteErrors: Array<{ site: string; error: string }> = [];

    const linkedinError: JobSpyProgressEvent = {
      type: "site_error",
      termIndex: 1,
      termTotal: 2,
      searchTerm: "backend engineer",
      site: "linkedin",
      error: "HTTPError: 429",
    };

    const glassdoorError: JobSpyProgressEvent = {
      type: "site_error",
      termIndex: 1,
      termTotal: 2,
      searchTerm: "backend engineer",
      site: "glassdoor",
      error: "ConnectionTimeout",
    };

    accumulateSiteError(siteErrors, linkedinError);
    accumulateSiteError(siteErrors, glassdoorError);

    expect(siteErrors).toEqual([
      { site: "linkedin", error: "HTTPError: 429" },
      { site: "glassdoor", error: "ConnectionTimeout" },
    ]);
  });
});
