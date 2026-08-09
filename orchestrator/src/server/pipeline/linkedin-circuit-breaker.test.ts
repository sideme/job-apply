import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import {
  isLinkedInInCooldown,
  LINKEDIN_COOLDOWN_MS,
  recordLinkedInFailure,
} from "./linkedin-circuit-breaker";

describe("linkedin circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isLinkedInInCooldown", () => {
    it("is false when no cooldown is set", () => {
      expect(isLinkedInInCooldown(undefined)).toBe(false);
      expect(isLinkedInInCooldown("")).toBe(false);
    });

    it("is true when the stored cooldown timestamp is in the future", () => {
      expect(isLinkedInInCooldown("2026-08-07T13:00:00.000Z")).toBe(true);
    });

    it("is false when the stored cooldown timestamp is in the past", () => {
      expect(isLinkedInInCooldown("2026-08-07T11:00:00.000Z")).toBe(false);
    });

    it("is false when the stored value is not a parseable date", () => {
      expect(isLinkedInInCooldown("not-a-date")).toBe(false);
    });
  });

  describe("recordLinkedInFailure", () => {
    it("sets a cooldown LINKEDIN_COOLDOWN_MS in the future and reports a new trip when not already cooling down", async () => {
      vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);

      const result = await recordLinkedInFailure();

      expect(result.isNewTrip).toBe(true);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith(
        "linkedinCooldownUntil",
        new Date(Date.now() + LINKEDIN_COOLDOWN_MS).toISOString(),
      );
    });

    it("extends the cooldown but reports no new trip when already cooling down", async () => {
      vi.mocked(settingsRepo.getSetting).mockResolvedValue(
        "2026-08-07T12:30:00.000Z",
      );

      const result = await recordLinkedInFailure();

      expect(result.isNewTrip).toBe(false);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith(
        "linkedinCooldownUntil",
        new Date(Date.now() + LINKEDIN_COOLDOWN_MS).toISOString(),
      );
    });
  });
});
