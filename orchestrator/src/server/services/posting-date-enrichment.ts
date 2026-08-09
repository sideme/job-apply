import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import { asyncPool } from "@server/utils/async-pool";
import type { Job, JobSource } from "@shared/types";
import { JSDOM } from "jsdom";

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;

export type PostingDateEnrichmentStatus =
  | "updated"
  | "already_exact"
  | "not_found"
  | "unsupported"
  | "fetch_failed";

export type PostingDateEnrichmentResult = {
  status: PostingDateEnrichmentStatus;
  datePosted: string | null;
};

function hasExplicitTime(value: string): boolean {
  const trimmed = value.trim();
  if (/^\d{10,13}$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * (trimmed.length === 10 ? 1000 : 1);
    const date = new Date(milliseconds);
    return (
      !Number.isNaN(date.getTime()) &&
      (date.getUTCHours() !== 0 ||
        date.getUTCMinutes() !== 0 ||
        date.getUTCSeconds() !== 0 ||
        date.getUTCMilliseconds() !== 0)
    );
  }
  return /(?:T|\s)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?/.test(trimmed);
}

export function normalizeExactPostingDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!hasExplicitTime(raw)) return null;
  const numeric = /^\d+$/.test(raw) ? Number(raw) : null;
  const parsed = new Date(
    numeric == null ? raw : numeric * (raw.length === 10 ? 1000 : 1),
  );
  return Number.isNaN(parsed.getTime()) ? null : String(parsed.getTime());
}

function findDatePostedInJson(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findDatePostedInJson(item);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const direct = normalizeExactPostingDate(record.datePosted);
  if (direct) return direct;
  for (const nested of Object.values(record)) {
    const result = findDatePostedInJson(nested);
    if (result) return result;
  }
  return null;
}

export function parseExactPostingDateFromHtml(html: string): string | null {
  const document = new JSDOM(html.slice(0, MAX_HTML_BYTES)).window.document;

  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      const result = findDatePostedInJson(JSON.parse(script.textContent ?? ""));
      if (result) return result;
    } catch {
      // A malformed JSON-LD block should not hide valid metadata elsewhere.
    }
  }

  const selectors = [
    '[itemprop="datePosted"][content]',
    'meta[property="article:published_time"]',
    'meta[name="datePosted"]',
    'time[itemprop="datePosted"][datetime]',
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const candidate =
      element?.getAttribute("content") ?? element?.getAttribute("datetime");
    const result = normalizeExactPostingDate(candidate);
    if (result) return result;
  }
  return null;
}

function hostnameMatchesSource(hostname: string, source: JobSource): boolean {
  const host = hostname.toLowerCase();
  if (source === "indeed") return /(^|\.)indeed\.[a-z.]+$/.test(host);
  if (source === "linkedin")
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (source === "gradcracker")
    return host === "gradcracker.com" || host.endsWith(".gradcracker.com");
  return false;
}

export function getPostingDetailUrl(job: Job): URL | null {
  try {
    const url = new URL(job.jobUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return hostnameMatchesSource(url.hostname, job.source) ? url : null;
  } catch {
    return null;
  }
}

export async function enrichJobPostingDate(
  job: Job,
  fetchImpl: typeof fetch = fetch,
): Promise<PostingDateEnrichmentResult> {
  if (job.datePosted && hasExplicitTime(job.datePosted)) {
    await jobsRepo.markPostingDateChecked(job.id);
    return { status: "already_exact", datePosted: job.datePosted };
  }

  const detailUrl = getPostingDetailUrl(job);
  if (!detailUrl) {
    await jobsRepo.markPostingDateChecked(job.id);
    return { status: "unsupported", datePosted: job.datePosted };
  }

  try {
    const response = await fetchImpl(detailUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || contentLength > MAX_HTML_BYTES) {
      await jobsRepo.markPostingDateChecked(job.id);
      return { status: "fetch_failed", datePosted: job.datePosted };
    }

    const exactDate = parseExactPostingDateFromHtml(await response.text());
    await jobsRepo.markPostingDateChecked(job.id, exactDate ?? undefined);
    return {
      status: exactDate ? "updated" : "not_found",
      datePosted: exactDate ?? job.datePosted,
    };
  } catch (error) {
    await jobsRepo.markPostingDateChecked(job.id);
    logger.warn("Posting date detail fetch failed", {
      jobId: job.id,
      source: job.source,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { status: "fetch_failed", datePosted: job.datePosted };
  }
}

export async function enrichRecentPostingDates(): Promise<{
  checked: number;
  enriched: number;
}> {
  const candidates = await jobsRepo.getJobsNeedingPostingDateCheck(8);
  const results = await asyncPool({
    items: candidates,
    concurrency: 3,
    task: (job) => enrichJobPostingDate(job),
  });
  return {
    checked: results.length,
    enriched: results.filter((result) => result.status === "updated").length,
  };
}
