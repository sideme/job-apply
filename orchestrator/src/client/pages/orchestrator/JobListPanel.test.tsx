import { createJob } from "@shared/testing/factories.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobListPanel } from "./JobListPanel";

describe("JobListPanel", () => {
  it("shows a loading state when fetching jobs", () => {
    render(
      <JobListPanel
        isLoading
        jobs={[]}
        activeJobs={[]}
        selectedJobId={null}
        selectedJobIds={new Set()}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading jobs...")).toBeInTheDocument();
  });

  it("shows the tab empty state copy when no jobs exist", () => {
    render(
      <JobListPanel
        isLoading={false}
        jobs={[]}
        activeJobs={[]}
        selectedJobId={null}
        selectedJobIds={new Set()}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByText("No jobs found")).toBeInTheDocument();
    expect(
      screen.getByText("Run the pipeline to discover and process new jobs."),
    ).toBeInTheDocument();
  });

  it("renders jobs and notifies when a job is selected", () => {
    const onSelectJob = vi.fn();
    const onToggleSelectJob = vi.fn();
    const onToggleSelectAll = vi.fn();
    const jobs = [
      createJob({
        id: "job-1",
        title: "Backend Engineer",
        datePosted: "1786060800000",
        suitabilityScore: 91,
        suitabilityReasonSource: "llm",
        employmentTypeCategory: "permanent_full_time",
        employmentTypeReason: "Explicit permanent full-time position.",
      }),
      createJob({
        id: "job-2",
        title: "Frontend Engineer",
        employer: "Globex",
        datePosted: null,
        discoveredAt: "2026-08-20T02:30:00.000Z",
        employmentTypeCategory: "contract",
        employmentTypeReason: "Explicit contract position.",
        hiringOrganizationCategory: "staffing_agency",
        hiringOrganizationReason: "Recruiting for a client.",
      }),
    ];

    render(
      <JobListPanel
        isLoading={false}
        jobs={jobs}
        activeJobs={jobs}
        selectedJobId="job-1"
        selectedJobIds={new Set()}
        activeTab="ready"
        onSelectJob={onSelectJob}
        onToggleSelectJob={onToggleSelectJob}
        onToggleSelectAll={onToggleSelectAll}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Backend Engineer/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Posted 7 Aug 2026")).toBeInTheDocument();
    expect(screen.getByText("AI ATS")).toBeInTheDocument();
    expect(screen.getByText("Permanent · Full-time")).toBeInTheDocument();
    expect(screen.getByText("Contract")).toBeInTheDocument();
    expect(screen.getByText("Staffing agency")).toBeInTheDocument();
    expect(
      screen.getByText("Found 19 Aug 2026 · post date unavailable"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Frontend Engineer/i }));
    expect(onSelectJob).toHaveBeenCalledWith("job-2");
  });

  it("toggles row selection and select-all", () => {
    const onToggleSelectJob = vi.fn();
    const onToggleSelectAll = vi.fn();
    const jobs = [
      createJob({ id: "job-1", title: "Backend Engineer" }),
      createJob({ id: "job-2", title: "Frontend Engineer" }),
    ];

    render(
      <JobListPanel
        isLoading={false}
        jobs={jobs}
        activeJobs={jobs}
        selectedJobId="job-1"
        selectedJobIds={new Set(["job-1"])}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={onToggleSelectJob}
        onToggleSelectAll={onToggleSelectAll}
      />,
    );

    fireEvent.click(screen.getByLabelText("Select Backend Engineer"));
    expect(onToggleSelectJob).toHaveBeenCalledWith("job-1");

    fireEvent.click(screen.getByLabelText("Select all filtered jobs"));
    expect(onToggleSelectAll).toHaveBeenCalledWith(true);
  });

  it("shows checkbox only for selected or checked rows", () => {
    const jobs = [createJob({ id: "job-1", title: "Backend Engineer" })];
    const { rerender } = render(
      <JobListPanel
        isLoading={false}
        jobs={jobs}
        activeJobs={jobs}
        selectedJobId={null}
        selectedJobIds={new Set()}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Select Backend Engineer")).toHaveClass(
      "opacity-0",
    );

    rerender(
      <JobListPanel
        isLoading={false}
        jobs={jobs}
        activeJobs={jobs}
        selectedJobId="job-1"
        selectedJobIds={new Set()}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Select Backend Engineer")).toHaveClass(
      "opacity-100",
    );

    rerender(
      <JobListPanel
        isLoading={false}
        jobs={jobs}
        activeJobs={jobs}
        selectedJobId={null}
        selectedJobIds={new Set(["job-1"])}
        activeTab="ready"
        onSelectJob={vi.fn()}
        onToggleSelectJob={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Select Backend Engineer")).toHaveClass(
      "opacity-100",
    );
  });
});
