import { afterEach, describe, expect, it } from "vitest";
import {
  clearApplicationFillSessionsForTests,
  createApplicationFillSession,
  resolveApplicationFillSession,
} from "./application-fill-session";

describe("application fill sessions", () => {
  afterEach(clearApplicationFillSessionsForTests);

  it("resolves a short-lived opaque code without exposing the job in it", () => {
    const session = createApplicationFillSession("job-sensitive-id", {
      now: 1_000,
      ttlMs: 5_000,
    });
    expect(session.code).not.toContain("job-sensitive-id");
    expect(resolveApplicationFillSession(session.code, 2_000)).toEqual({
      jobId: "job-sensitive-id",
      expiresAt: new Date(6_000).toISOString(),
    });
  });

  it("survives a service-memory reset because the code is encrypted", () => {
    const session = createApplicationFillSession("job-after-restart", {
      now: 1_000,
      ttlMs: 5_000,
    });
    clearApplicationFillSessionsForTests();
    expect(resolveApplicationFillSession(session.code, 2_000)?.jobId).toBe(
      "job-after-restart",
    );
  });

  it("rejects expired and unknown codes", () => {
    const session = createApplicationFillSession("job-1", {
      now: 1_000,
      ttlMs: 500,
    });
    expect(resolveApplicationFillSession(session.code, 1_500)).toBeNull();
    expect(resolveApplicationFillSession("unknown", 1_200)).toBeNull();
  });
});
