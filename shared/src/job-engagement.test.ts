import { describe, expect, it } from "vitest";
import { classifyJobEngagement } from "./job-engagement";

describe("classifyJobEngagement", () => {
  it("prefers an explicit source contract type", () => {
    expect(
      classifyJobEngagement({
        title: "Backend Engineer",
        employer: "Acme",
        jobType: "contract",
        jobDescription: "Build APIs and services.",
      }).employmentTypeCategory,
    ).toBe("contract");
  });

  it("detects fixed-term and month-based contracts from the JD", () => {
    expect(
      classifyJobEngagement({
        title: "Software Engineer",
        jobDescription: "This is a 12-month contract position.",
      }).employmentTypeCategory,
    ).toBe("contract");
    expect(
      classifyJobEngagement({
        title: "Platform Engineer",
        jobDescription: "Join us for a fixed-term role.",
      }).employmentTypeCategory,
    ).toBe("contract");
  });

  it("does not mistake software contract terminology for contract employment", () => {
    expect(
      classifyJobEngagement({
        title: "Backend Engineer",
        jobDescription:
          "Own API contracts, contract testing, and schema compatibility for a distributed platform.",
      }).employmentTypeCategory,
    ).toBe("unknown");
  });

  it("distinguishes permanent full-time from unspecified full-time", () => {
    expect(
      classifyJobEngagement({
        jobDescription: "This is a permanent full-time position.",
      }).employmentTypeCategory,
    ).toBe("permanent_full_time");
    expect(
      classifyJobEngagement({ jobType: "fulltime" }).employmentTypeCategory,
    ).toBe("full_time");
  });

  it("detects staffing agencies and client recruitment language", () => {
    expect(
      classifyJobEngagement({ employer: "North Star Staffing Inc." })
        .hiringOrganizationCategory,
    ).toBe("staffing_agency");
    expect(
      classifyJobEngagement({
        employer: "North Star",
        jobDescription: "On behalf of our client, we are hiring an engineer.",
      }).hiringOrganizationCategory,
    ).toBe("staffing_agency");
  });

  it("does not mistake ordinary customer language for a staffing agency", () => {
    expect(
      classifyJobEngagement({
        employer: "Example Bank",
        jobDescription:
          "We access capital markets on behalf of our clients and build systems for client trades.",
      }).hiringOrganizationCategory,
    ).toBe("unknown");
  });

  it("detects consulting firms independently of employment type", () => {
    const result = classifyJobEngagement({
      employer: "Example Consulting Group",
      jobType: "full-time",
    });
    expect(result.employmentTypeCategory).toBe("full_time");
    expect(result.hiringOrganizationCategory).toBe("consulting_firm");
  });
});
