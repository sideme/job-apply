import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfileCache, getProfile } from "./profile";

vi.mock("./local-resume", () => ({
  getLocalResumeStatus: vi.fn(),
  extractLocalResumeText: vi.fn(),
}));

import { extractLocalResumeText, getLocalResumeStatus } from "./local-resume";

const configuredStatus = {
  configured: true,
  filename: "resume.pdf",
  sizeBytes: 1234,
  modifiedAt: "2026-08-08T00:00:00.000Z",
};

describe("getProfile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearProfileCache();
  });

  it("builds the profile from the extracted local PDF text", async () => {
    vi.mocked(getLocalResumeStatus).mockResolvedValue(configuredStatus);
    vi.mocked(extractLocalResumeText).mockResolvedValue(
      "Side Mi\nSenior Software Engineer\nJava, TypeScript",
    );

    const profile = await getProfile();

    expect(profile.rawText).toContain("Senior Software Engineer");
    expect(profile.basics?.name).toBe("Side Mi");
  });

  it("throws when no local resume is uploaded", async () => {
    vi.mocked(getLocalResumeStatus).mockResolvedValue({
      configured: false,
      filename: "resume.pdf",
      sizeBytes: null,
      modifiedAt: null,
    });

    await expect(getProfile()).rejects.toThrow(/No resume configured/);
  });

  it("caches the profile until forceRefresh or the source changes", async () => {
    vi.mocked(getLocalResumeStatus).mockResolvedValue(configuredStatus);
    vi.mocked(extractLocalResumeText).mockResolvedValue("resume text");

    await getProfile();
    await getProfile();
    expect(extractLocalResumeText).toHaveBeenCalledTimes(1);

    await getProfile(true);
    expect(extractLocalResumeText).toHaveBeenCalledTimes(2);
  });
});
