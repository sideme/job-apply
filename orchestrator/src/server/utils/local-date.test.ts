import { describe, expect, it } from "vitest";
import {
  getUtcEpochRangeForDate,
  getUtcRangeForLocalDate,
  isValidLocalDate,
} from "./local-date";

describe("local date utilities", () => {
  it("validates real calendar dates", () => {
    expect(isValidLocalDate("2026-08-19")).toBe(true);
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2026-8-19")).toBe(false);
  });

  it("converts a Toronto summer date to an exclusive UTC range", () => {
    expect(getUtcRangeForLocalDate("2026-08-19", "America/Toronto")).toEqual({
      start: "2026-08-19T04:00:00.000Z",
      end: "2026-08-20T04:00:00.000Z",
    });
  });

  it("uses the correct daylight-saving offsets at date boundaries", () => {
    expect(getUtcRangeForLocalDate("2026-03-08", "America/Toronto")).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
    });
    expect(getUtcRangeForLocalDate("2026-11-01", "America/Toronto")).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
  });

  it("calculates UTC epoch boundaries for a displayed posting date", () => {
    expect(getUtcEpochRangeForDate("2026-08-19")).toEqual({
      start: String(Date.UTC(2026, 7, 19)),
      end: String(Date.UTC(2026, 7, 20)),
    });
  });
});
