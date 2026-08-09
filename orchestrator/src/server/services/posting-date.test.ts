import { describe, expect, it } from "vitest";
import { normalizePostingDate } from "./posting-date";

describe("normalizePostingDate", () => {
  it("normalizes ISO dates and epoch seconds to epoch milliseconds", () => {
    expect(normalizePostingDate("2026-08-09T14:35:12-04:00")).toBe(
      String(Date.parse("2026-08-09T14:35:12-04:00")),
    );
    expect(normalizePostingDate("1786291200")).toBe("1786291200000");
  });

  it("preserves epoch milliseconds and rejects invalid input", () => {
    expect(normalizePostingDate("1786291200000")).toBe("1786291200000");
    expect(normalizePostingDate("not-a-date")).toBeNull();
    expect(normalizePostingDate(" ")).toBeNull();
  });
});
