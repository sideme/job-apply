import { describe, expect, it } from "vitest";
// biome-ignore format: the TypeScript suppression must stay on the import line.
// @ts-expect-error The production scheduler is a plain Node ESM entrypoint.
import { dueSources, parseSchedulerState } from "../../../../scripts/pipeline-scheduler.mjs";

describe("pipeline scheduler persistence", () => {
  it("does not repeat sources before their persisted intervals expire", () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const state = {
      version: 1,
      lastCoreRunAt: now - 30 * 60_000,
      lastLinkedInRunAt: now - 60 * 60_000,
    };

    expect(dueSources(state, now, 60 * 60_000, 180 * 60_000)).toEqual({
      coreDue: false,
      linkedInDue: false,
      sources: [],
    });
  });

  it("runs Indeed hourly and LinkedIn only on its longer cadence", () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const state = {
      version: 1,
      lastCoreRunAt: now - 61 * 60_000,
      lastLinkedInRunAt: now - 181 * 60_000,
    };

    expect(dueSources(state, now, 60 * 60_000, 180 * 60_000)).toEqual({
      coreDue: true,
      linkedInDue: true,
      sources: ["indeed", "linkedin"],
    });
  });

  it("rejects invalid persisted state", () => {
    expect(parseSchedulerState("not-json")).toBeNull();
    expect(parseSchedulerState({ version: 2 })).toBeNull();
  });
});
