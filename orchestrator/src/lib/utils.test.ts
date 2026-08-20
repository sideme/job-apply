import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDiscoveryDate,
  formatPostingDateTime,
  safeFilenamePart,
} from "./utils";

describe("formatDate", () => {
  it("formats source-provided epoch milliseconds", () => {
    expect(formatDate("1786060800000")).toBe("7 Aug 2026");
  });

  it("formats source-provided epoch seconds", () => {
    expect(formatDate("1786060800")).toBe("7 Aug 2026");
  });

  it("keeps unparseable source values visible", () => {
    expect(formatDate("recently posted")).toBe("recently posted");
  });
});

describe("formatPostingDateTime", () => {
  it("shows an exact source time when one is available", () => {
    expect(formatPostingDateTime("2026-08-07T14:35:00Z")).toEqual({
      label: "7 Aug 2026, 14:35 UTC",
      hasTime: true,
    });
  });

  it("does not invent a time for date-only source values", () => {
    expect(formatPostingDateTime("1786060800000")).toEqual({
      label: "7 Aug 2026",
      hasTime: false,
    });
  });
});

describe("formatDiscoveryDate", () => {
  it("formats the collection date in the configured job timezone", () => {
    expect(
      formatDiscoveryDate("2026-08-20T02:30:00.000Z", "America/Toronto"),
    ).toBe("19 Aug 2026");
  });
});

describe("safeFilenamePart", () => {
  it("replaces non-alphanumeric characters with underscores", () => {
    expect(safeFilenamePart("Acme, Inc.")).toBe("Acme__Inc_");
  });

  it("falls back to Unknown when empty after cleaning", () => {
    expect(safeFilenamePart("")).toBe("Unknown");
    expect(safeFilenamePart("!!!")).toBe("Unknown");
  });
});
