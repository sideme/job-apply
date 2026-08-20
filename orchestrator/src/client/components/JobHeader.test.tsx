import { createJob } from "@shared/testing/factories.js";
import { render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { JobHeader } from "./JobHeader";

const mockJob = createJob({
  id: "job-1",
  title: "Software Engineer",
  employer: "Tech Corp",
  location: "London",
  salary: "£60,000",
  datePosted: "1786060800000",
  deadline: "2025-12-31",
  status: "discovered",
  source: "linkedin",
  suitabilityScore: 85,
  suitabilityReason: "Strong match",
});

describe("JobHeader", () => {
  const renderWithRouter = (ui: React.ReactElement) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  it("renders basic job information", () => {
    renderWithRouter(<JobHeader job={mockJob} />);
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Tech Corp")).toBeInTheDocument();
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.getByText("£60,000")).toBeInTheDocument();
    expect(screen.getByText("Posted 7 Aug 2026")).toBeInTheDocument();
    expect(screen.getByText("(time not provided)")).toBeInTheDocument();
    expect(screen.getByText("Deadline 31 Dec 2025")).toBeInTheDocument();
    expect(screen.getByText("Local ATS")).toBeInTheDocument();
  });

  it("labels the primary score as DeepSeek ATS after model evaluation", () => {
    renderWithRouter(
      <JobHeader
        job={createJob({
          ...mockJob,
          suitabilityScore: 91,
          suitabilityReasonSource: "llm",
          llmFitScore: 91,
          llmFitStatus: "completed",
        })}
      />,
    );

    expect(screen.getByText("DeepSeek ATS")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
  });

  it("links the title and view button to the job page", () => {
    renderWithRouter(<JobHeader job={mockJob} />);

    expect(
      screen.getByRole("link", { name: "Software Engineer" }),
    ).toHaveAttribute("href", "/job/job-1");
    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute(
      "href",
      "/job/job-1",
    );
  });

  it("shows the collection date when the source posting date is unavailable", () => {
    const undatedJob = createJob({
      ...mockJob,
      datePosted: null,
      discoveredAt: "2026-08-20T02:30:00.000Z",
    });

    renderWithRouter(<JobHeader job={undatedJob} />);

    expect(
      screen.getByText("Found 19 Aug 2026 (posting date unavailable)"),
    ).toBeInTheDocument();
  });

  it("hides the view button when already on a job page", () => {
    render(
      <MemoryRouter initialEntries={["/job/job-1"]}>
        <JobHeader job={mockJob} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: /view/i }),
    ).not.toBeInTheDocument();
  });
});
