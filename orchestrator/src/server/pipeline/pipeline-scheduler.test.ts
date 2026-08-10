import { describe, expect, it } from "vitest";
// biome-ignore format: the TypeScript suppression must stay on the import line.
// @ts-expect-error The production scheduler is a plain Node ESM entrypoint.
import { getScheduleSlot, parseSchedulerState } from "../../../../scripts/pipeline-scheduler.mjs";

describe("pipeline scheduler persistence", () => {
  it("returns the active Toronto weekday slot", () => {
    expect(
      getScheduleSlot(
        Date.parse("2026-08-10T14:05:00.000Z"),
        "America/Toronto",
      ),
    ).toEqual({
      key: "2026-08-10T10:00@America/Toronto",
      localDate: "2026-08-10",
      hour: 10,
    });
  });

  it.each([
    ["2026-08-10T14:00:00.000Z", 10],
    ["2026-08-10T16:00:00.000Z", 12],
    ["2026-08-10T18:00:00.000Z", 14],
    ["2026-08-10T20:00:00.000Z", 16],
    ["2026-08-10T22:00:00.000Z", 18],
  ])("maps %s to the %i:00 slot", (iso, expectedHour) => {
    expect(getScheduleSlot(Date.parse(iso), "America/Toronto")?.hour).toBe(
      expectedHour,
    );
  });

  it("does not schedule weekends, mornings, or 19:00 and later", () => {
    expect(
      getScheduleSlot(
        Date.parse("2026-08-09T16:00:00.000Z"),
        "America/Toronto",
      ),
    ).toBeNull();
    expect(
      getScheduleSlot(
        Date.parse("2026-08-10T13:59:00.000Z"),
        "America/Toronto",
      ),
    ).toBeNull();
    expect(
      getScheduleSlot(
        Date.parse("2026-08-10T23:00:00.000Z"),
        "America/Toronto",
      ),
    ).toBeNull();
  });

  it("uses the same slot key throughout a two-hour window", () => {
    const first = getScheduleSlot(
      Date.parse("2026-08-10T16:01:00.000Z"),
      "America/Toronto",
    );
    const afterRestart = getScheduleSlot(
      Date.parse("2026-08-10T17:59:00.000Z"),
      "America/Toronto",
    );
    expect(afterRestart?.key).toBe(first?.key);
  });

  it("respects Toronto daylight-saving time", () => {
    expect(
      getScheduleSlot(Date.parse("2026-01-12T15:00:00.000Z"), "America/Toronto")
        ?.hour,
    ).toBe(10);
    expect(
      getScheduleSlot(Date.parse("2026-07-13T14:00:00.000Z"), "America/Toronto")
        ?.hour,
    ).toBe(10);
  });

  it("rejects invalid persisted state", () => {
    expect(parseSchedulerState("not-json")).toBeNull();
    expect(parseSchedulerState({ version: 1, lastCoreRunAt: 123 })).toBeNull();
    expect(parseSchedulerState({ version: 2, lastRunSlot: 123 })).toBeNull();
  });

  it("accepts the current persisted state", () => {
    expect(
      parseSchedulerState({
        version: 2,
        lastRunSlot: "2026-08-10T10:00@America/Toronto",
      }),
    ).toEqual({
      version: 2,
      lastRunSlot: "2026-08-10T10:00@America/Toronto",
    });
  });
});
