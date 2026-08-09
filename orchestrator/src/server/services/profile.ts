import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import { extractLocalResumeText, getLocalResumeStatus } from "./local-resume";

let cachedProfile: ResumeProfile | null = null;
let cachedKey: string | null = null;

/** Best-effort candidate name from the first non-empty line of the resume. */
function deriveName(text: string): string | undefined {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : undefined;
}

/**
 * Get the candidate resume profile used for scoring and tailoring, built from
 * the locally uploaded PDF's extracted text. Cached until clearProfileCache()
 * is called or the uploaded file changes.
 *
 * @param forceRefresh Force re-extraction from the PDF.
 * @throws Error if no local resume PDF is configured.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  if (forceRefresh) {
    cachedProfile = null;
    cachedKey = null;
  }

  const status = await getLocalResumeStatus();
  if (!status.configured) {
    throw new Error("No resume configured. Upload a PDF resume in Settings.");
  }

  const key = `local:${status.modifiedAt ?? ""}:${status.sizeBytes ?? ""}`;
  if (cachedProfile && cachedKey === key) return cachedProfile;

  const rawText = await extractLocalResumeText();
  if (!rawText) {
    logger.warn("Local resume PDF produced no extractable text", {
      filename: status.filename,
    });
  }

  const profile: ResumeProfile = {
    rawText,
    basics: { name: deriveName(rawText) },
  };
  cachedProfile = profile;
  cachedKey = key;
  return profile;
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
  const profile = await getProfile();
  return profile?.basics?.name || "Resume";
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  cachedProfile = null;
  cachedKey = null;
}
