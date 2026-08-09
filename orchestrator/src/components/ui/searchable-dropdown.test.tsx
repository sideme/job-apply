import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchableDropdown } from "./searchable-dropdown";

describe("SearchableDropdown", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("filters options from its search input and keeps the options list scrollable", () => {
    render(
      <SearchableDropdown
        ariaLabel="Country"
        onValueChange={vi.fn()}
        options={[
          { value: "canada", label: "Canada" },
          { value: "united states", label: "United States" },
          { value: "united kingdom", label: "United Kingdom" },
        ]}
        placeholder="Select country"
        searchPlaceholder="Search country..."
        value="united states"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Country" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search country..." }),
      {
        target: { value: "can" },
      },
    );

    expect(screen.getByRole("option", { name: "Canada" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "United States" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("[cmdk-list]")).toHaveClass(
      "overflow-y-auto",
      "overscroll-contain",
    );
  });
});
