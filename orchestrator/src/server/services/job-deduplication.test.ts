import { describe, expect, it } from "vitest";
import {
  areCrossSourceDuplicates,
  buildDuplicateAssignments,
} from "./job-deduplication";

const baseJob = {
  id: "indeed-job",
  source: "indeed",
  title: "Senior Software Developer",
  employer: "Acme Inc.",
  location: "Toronto, ON, CA",
  datePosted: "1786060800000",
  jobUrl: "https://ca.indeed.com/viewjob?jk=abc",
  status: "discovered",
};

describe("cross-source job deduplication", () => {
  it("matches the same company, role, city, and posting date across sources", () => {
    expect(
      areCrossSourceDuplicates(baseJob, {
        ...baseJob,
        id: "linkedin-job",
        source: "linkedin",
        employer: "Acme Incorporated",
        location: "Toronto, Ontario, Canada",
        jobUrl: "https://linkedin.com/jobs/view/123",
      }),
    ).toBe(true);
  });

  it("keeps reposts with distant posting dates", () => {
    expect(
      areCrossSourceDuplicates(baseJob, {
        ...baseJob,
        id: "old-job",
        source: "adzuna",
        datePosted: "2026-06-01T12:00:00Z",
        jobUrl: "https://adzuna.ca/details/123",
      }),
    ).toBe(false);
  });

  it("keeps same-source listings with materially different descriptions", () => {
    expect(
      areCrossSourceDuplicates(baseJob, {
        ...baseJob,
        id: "another-indeed-job",
        jobUrl: "https://ca.indeed.com/viewjob?jk=def",
        jobDescription:
          "A distinct role focused on mobile application delivery and Android.",
      }),
    ).toBe(false);
  });

  it("matches same-source copies when their descriptions are nearly identical", () => {
    const description = `${"Backend Java development with Spring and PostgreSQL. ".repeat(8)}Team delivery.`;
    expect(
      areCrossSourceDuplicates(
        { ...baseJob, jobDescription: description },
        {
          ...baseJob,
          id: "duplicate-query-result",
          jobUrl: "https://ca.indeed.com/viewjob?jk=def",
          jobDescription: `${description} Apply today.`,
        },
      ),
    ).toBe(true);
  });

  it("ignores tracking parameters when comparing URLs", () => {
    expect(
      areCrossSourceDuplicates(baseJob, {
        ...baseJob,
        id: "tracked-copy",
        jobUrl: "https://ca.indeed.com/viewjob?utm_source=email&jk=abc",
      }),
    ).toBe(true);
  });

  it("preserves the application that has progressed furthest", () => {
    const assignments = buildDuplicateAssignments([
      baseJob,
      {
        ...baseJob,
        id: "linkedin-applied",
        source: "linkedin",
        status: "applied",
        jobUrl: "https://linkedin.com/jobs/view/123",
      },
    ]);

    expect(assignments).toEqual([
      { duplicateId: "indeed-job", winnerId: "linkedin-applied" },
    ]);
  });
});
