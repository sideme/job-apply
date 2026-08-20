import { describe, expect, it } from "vitest";
import {
  getTodayDateFilter,
  isJobOnDateFilter,
  isValidDateFilter,
} from "./date-filter";

describe("discovered date filter", () => {
  it("uses the configured timezone rather than the UTC date", () => {
    const instant = new Date("2026-08-20T02:30:00.000Z");
    expect(getTodayDateFilter(instant, "America/Toronto")).toBe("2026-08-19");
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidDateFilter("2026-08-19")).toBe(true);
    expect(isValidDateFilter("2026-02-29")).toBe(false);
    expect(isValidDateFilter(null)).toBe(false);
  });

  it("matches the UTC posting date displayed on a job card", () => {
    expect(
      isJobOnDateFilter(
        { datePosted: String(Date.parse("2026-08-19T18:00:00Z")) },
        "2026-08-19",
      ),
    ).toBe(true);
    expect(
      isJobOnDateFilter(
        { datePosted: "2026-08-19T23:00:00-04:00" },
        "2026-08-19",
      ),
    ).toBe(false);
  });

  it("falls back to the Toronto discovery date only when posting date is missing", () => {
    expect(
      isJobOnDateFilter(
        { datePosted: null, discoveredAt: "2026-08-20T02:30:00.000Z" },
        "2026-08-19",
      ),
    ).toBe(true);
    expect(
      isJobOnDateFilter(
        {
          datePosted: "2026-08-18T12:00:00.000Z",
          discoveredAt: "2026-08-19T12:00:00.000Z",
        },
        "2026-08-19",
      ),
    ).toBe(false);
  });
});
