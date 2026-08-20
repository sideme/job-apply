import type { JobSource } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FilterTab, JobSort } from "./constants";
import { OrchestratorFilters } from "./OrchestratorFilters";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: originalScrollIntoView,
  });
});

const renderFilters = (
  overrides?: Partial<ComponentProps<typeof OrchestratorFilters>>,
) => {
  const props = {
    activeTab: "ready" as FilterTab,
    onTabChange: vi.fn(),
    counts: {
      ready: 2,
      discovered: 1,
      applied: 3,
      all: 6,
    },
    onOpenCommandBar: vi.fn(),
    sourceFilter: "all" as const,
    onSourceFilterChange: vi.fn(),
    jobLevelFilters: [],
    onJobLevelFiltersChange: vi.fn(),
    employmentTypeFilters: [],
    onEmploymentTypeFiltersChange: vi.fn(),
    discoveredDate: "2026-08-19",
    onDiscoveredDateChange: vi.fn(),
    salaryFilter: {
      mode: "at_least" as const,
      min: null,
      max: null,
    },
    onSalaryFilterChange: vi.fn(),
    sourcesWithJobs: ["gradcracker", "linkedin", "manual"] as JobSource[],
    sort: { key: "score", direction: "desc" } as JobSort,
    onSortChange: vi.fn(),
    onResetFilters: vi.fn(),
    filteredCount: 5,
    ...overrides,
  };

  return {
    props,
    ...render(<OrchestratorFilters {...props} />),
  };
};

describe("OrchestratorFilters", () => {
  it("shows a working calendar only on Discovered and emits date changes", () => {
    const { props, rerender } = renderFilters({ activeTab: "discovered" });

    const dateButton = screen.getByRole("button", {
      name: /choose discovered date/i,
    });
    expect(dateButton).toHaveTextContent("Aug 19, 2026");
    fireEvent.click(dateButton);
    fireEvent.click(screen.getByRole("button", { name: "August 18, 2026" }));
    expect(props.onDiscoveredDateChange).toHaveBeenCalledWith("2026-08-18");

    rerender(<OrchestratorFilters {...props} activeTab="ready" />);
    expect(
      screen.queryByRole("button", { name: /choose discovered date/i }),
    ).not.toBeInTheDocument();
  });

  it("notifies when tabs and command search shortcut are used", () => {
    const { props } = renderFilters();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /applied/i }));
    expect(props.onTabChange).toHaveBeenCalledWith("applied");

    fireEvent.click(screen.getByRole("button", { name: /search jobs/i }));
    expect(props.onOpenCommandBar).toHaveBeenCalled();
  });

  it("updates source, salary range, and sort from the drawer", async () => {
    const { props } = renderFilters();

    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));

    fireEvent.click(await screen.findByRole("button", { name: /linkedin/i }));
    expect(props.onSourceFilterChange).toHaveBeenCalledWith("linkedin");

    fireEvent.click(
      screen.getByRole("combobox", { name: "Job level filters" }),
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Search job levels..." }),
      { target: { value: "senior" } },
    );
    fireEvent.click(await screen.findByText("Senior"));
    expect(props.onJobLevelFiltersChange).toHaveBeenCalledWith(["senior"]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText("Sponsor status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Minimum"), {
      target: { value: "65000" },
    });
    expect(props.onSalaryFilterChange).toHaveBeenCalledWith({
      mode: "at_least",
      min: 65000,
      max: null,
    });

    fireEvent.click(
      screen.getByRole("combobox", { name: "Salary range specifier" }),
    );
    fireEvent.click(await screen.findByText("between"));
    expect(props.onSalaryFilterChange).toHaveBeenCalledWith({
      mode: "between",
      min: null,
      max: null,
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Sort field" }));
    fireEvent.click(await screen.findByText("Title"));
    expect(props.onSortChange).toHaveBeenCalledWith({
      key: "title",
      direction: "asc",
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Sort field" }));
    fireEvent.click(await screen.findByText("Company"));
    expect(props.onSortChange).toHaveBeenCalledWith({
      key: "employer",
      direction: "asc",
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Sort order" }));
    fireEvent.click(await screen.findByText("smallest first"));
    expect(props.onSortChange).toHaveBeenCalledWith({
      key: "score",
      direction: "asc",
    });
  });

  it("adds another employment type without replacing the existing selection", async () => {
    const { props } = renderFilters({ employmentTypeFilters: ["full_time"] });
    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Employment type filters" }),
    );
    fireEvent.change(
      await screen.findByRole("combobox", {
        name: "Search employment types...",
      }),
      { target: { value: "contract" } },
    );
    fireEvent.click(await screen.findByText("Contract"));

    expect(props.onEmploymentTypeFiltersChange).toHaveBeenCalledWith([
      "full_time",
      "contract",
    ]);
  });

  it("adds another job level without replacing the existing selection", async () => {
    const { props } = renderFilters({ jobLevelFilters: ["senior"] });
    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Job level filters" }),
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Search job levels..." }),
      { target: { value: "lead" } },
    );
    fireEvent.click(await screen.findByText("Lead / Principal"));

    expect(props.onJobLevelFiltersChange).toHaveBeenCalledWith([
      "senior",
      "lead",
    ]);
  });

  it("resets filters and only shows sources present in jobs", async () => {
    const { props } = renderFilters({
      sourcesWithJobs: ["gradcracker", "manual"],
    });

    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));

    expect(
      screen.queryByRole("button", { name: "LinkedIn" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Gradcracker" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manual" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(props.onResetFilters).toHaveBeenCalled();
  });
});
