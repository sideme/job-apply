import {
  access,
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { logger } from "@infra/logger";
import { extractText, getDocumentProxy } from "unpdf";
import { getDataDir } from "../config/dataDir";

export const LOCAL_RESUME_MAX_BYTES = 15 * 1024 * 1024;

export type LocalResumeStatus = {
  configured: boolean;
  filename: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
};

function getConfiguredPath(): string {
  const configured = (process.env.RESUME_PDF_PATH || "").trim();
  return configured ? resolve(configured) : join(getDataDir(), "resume.pdf");
}

export function getLocalResumePdfPath(): string {
  return getConfiguredPath();
}

async function isPdfFile(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString("utf8") === "%PDF-";
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function getLocalResumeStatus(): Promise<LocalResumeStatus> {
  const path = getConfiguredPath();
  try {
    const metadata = await stat(path);
    const valid =
      metadata.isFile() &&
      metadata.size > 0 &&
      metadata.size <= LOCAL_RESUME_MAX_BYTES &&
      (await isPdfFile(path));

    return {
      configured: valid,
      filename: basename(path),
      sizeBytes: valid ? metadata.size : null,
      modifiedAt: valid ? metadata.mtime.toISOString() : null,
    };
  } catch {
    return {
      configured: false,
      filename: basename(path),
      sizeBytes: null,
      modifiedAt: null,
    };
  }
}

export async function saveLocalResumePdf(
  pdf: Buffer,
): Promise<LocalResumeStatus> {
  if (pdf.length === 0 || pdf.length > LOCAL_RESUME_MAX_BYTES) {
    throw new Error("PDF must be between 1 byte and 15 MB.");
  }
  if (!pdf.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw new Error("Uploaded file is not a valid PDF.");
  }

  const path = getConfiguredPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pdf, { mode: 0o600 });
  return getLocalResumeStatus();
}

export async function assertLocalResumePdf(): Promise<string> {
  const path = getConfiguredPath();
  await access(path);
  const status = await getLocalResumeStatus();
  if (!status.configured) {
    throw new Error(
      `Local resume PDF is missing or invalid. Add a PDF at ${path}.`,
    );
  }
  return path;
}

/**
 * Extract plain text from the configured local resume PDF. Returns an empty
 * string when no valid local resume is present or the PDF yields no text
 * (for example a scanned/image-only PDF, which would need OCR).
 */
export async function extractLocalResumeText(): Promise<string> {
  const status = await getLocalResumeStatus();
  if (!status.configured) return "";

  try {
    const bytes = await readFile(getConfiguredPath());
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    // Collapse the runs of whitespace pdf extraction leaves behind.
    return merged
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (error) {
    logger.warn("Failed to extract text from local resume PDF", {
      filename: status.filename,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return "";
  }
}
