import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertLocalResumePdf,
  extractLocalResumeText,
  getLocalResumePdfPath,
  getLocalResumeStatus,
  saveLocalResumePdf,
} from "./local-resume";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.RESUME_PDF_PATH;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createResumePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "job-apply-resume-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "resume.pdf");
  process.env.RESUME_PDF_PATH = path;
  return path;
}

describe("local resume service", () => {
  it("reports an unconfigured resume without creating a file", async () => {
    const path = await createResumePath();

    await expect(getLocalResumeStatus()).resolves.toMatchObject({
      configured: false,
      filename: "resume.pdf",
      sizeBytes: null,
    });
    expect(getLocalResumePdfPath()).toBe(path);
  });

  it("stores and validates a local PDF", async () => {
    const path = await createResumePath();
    const pdf = Buffer.from("%PDF-1.7\nresume content\n%%EOF");

    await expect(saveLocalResumePdf(pdf)).resolves.toMatchObject({
      configured: true,
      filename: "resume.pdf",
      sizeBytes: pdf.length,
    });
    await expect(assertLocalResumePdf()).resolves.toBe(path);
    await expect(readFile(path)).resolves.toEqual(pdf);
  });

  it("rejects non-PDF content", async () => {
    await createResumePath();

    await expect(saveLocalResumePdf(Buffer.from("not a pdf"))).rejects.toThrow(
      "not a valid PDF",
    );
  });

  it("extracts no text when no resume is configured", async () => {
    await createResumePath();

    await expect(extractLocalResumeText()).resolves.toBe("");
  });

  it("returns an empty string (not a throw) for an unparseable PDF", async () => {
    await createResumePath();
    // Passes the %PDF- header check but has no real PDF structure to parse.
    await saveLocalResumePdf(Buffer.from("%PDF-1.7\ngarbage\n%%EOF"));

    await expect(extractLocalResumeText()).resolves.toBe("");
  });
});
