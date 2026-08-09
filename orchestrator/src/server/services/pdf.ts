/**
 * Service for generating application PDF resumes.
 */

import { existsSync } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "../config/dataDir";
import { assertLocalResumePdf, getLocalResumeStatus } from "./local-resume";

const OUTPUT_DIR = join(getDataDir(), "pdfs");

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export interface TailoredPdfContent {
  summary?: string | null;
  headline?: string | null;
  skills?: Array<{ name: string; keywords: string[] }> | null;
}

export interface GeneratePdfOptions {
  requestOrigin?: string | null;
}

/**
 * Generate the application PDF for a job by copying the uploaded local resume
 * PDF unchanged. Per-job tailoring is not applied to the PDF; the tailored
 * text is surfaced separately in the UI.
 */
export async function generatePdf(
  jobId: string,
  _tailoredContent: TailoredPdfContent,
  _jobDescription: string,
  _baseResumePath?: string,
  _selectedProjectIds?: string | null,
  _options?: GeneratePdfOptions,
): Promise<PdfResult> {
  logger.info("Generating PDF resume", { jobId });

  try {
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }

    const outputPath = join(OUTPUT_DIR, `resume_${jobId}.pdf`);
    const localResume = await getLocalResumeStatus();
    if (!localResume.configured) {
      throw new Error(
        "No resume configured. Upload a PDF resume in Settings before generating applications.",
      );
    }

    const sourcePath = await assertLocalResumePdf();
    await copyFile(sourcePath, outputPath);
    logger.info("Local PDF resume copied successfully", { jobId, outputPath });
    return { success: true, pdfPath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("PDF generation failed", { jobId, error });
    return { success: false, error: message };
  }
}

/** Check if a PDF exists for a job. */
export async function pdfExists(jobId: string): Promise<boolean> {
  const pdfPath = join(OUTPUT_DIR, `resume_${jobId}.pdf`);
  try {
    await access(pdfPath);
    return true;
  } catch {
    return false;
  }
}

/** Get the path to a job's PDF. */
export function getPdfPath(jobId: string): string {
  return join(OUTPUT_DIR, `resume_${jobId}.pdf`);
}
