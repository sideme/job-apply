import { describe, expect, it } from "vitest";
import { formatJobLevel, inferJobLevel } from "./job-level";

describe("job level normalization", () => {
  it.each([
    ["entry level", "Platform Engineer", "entry_level"],
    ["mid-senior level", "Software Engineer", "senior"],
    ["associate", "Consultant", "associate"],
    ["executive", "Operations", "executive"],
  ] as const)("normalizes source level %s", (raw, title, expected) => {
    expect(inferJobLevel(raw, title)).toBe(expected);
  });

  it.each([
    ["Junior Developer", "entry_level"],
    ["Intermediate Backend Engineer", "mid_level"],
    ["Senior Data Engineer", "senior"],
    ["Principal Engineer", "lead"],
    ["Engineering Manager", "manager"],
    ["Head of Engineering", "director"],
  ] as const)("infers %s from the title", (title, expected) => {
    expect(inferJobLevel(null, title)).toBe(expected);
  });

  it("falls back to the title for source placeholders", () => {
    expect(inferJobLevel("not applicable", "Senior Analyst")).toBe("senior");
  });

  it("does not invent a level without evidence", () => {
    expect(inferJobLevel(null, "Software Engineer")).toBeNull();
    expect(formatJobLevel(null)).toBeNull();
  });

  it("formats stable categories for the UI", () => {
    expect(formatJobLevel("lead")).toBe("Lead / Principal");
  });
});
