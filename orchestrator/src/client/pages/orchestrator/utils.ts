import type { AppSettings, JobListItem, JobSource } from "@shared/types";
import type { FilterTab, JobSort } from "./constants";
import { DEFAULT_PIPELINE_SOURCES, orderedSources } from "./constants";

const dateValue = (value: string | null) => {
  if (!value) return null;
  if (/^\d{10,13}$/.test(value)) {
    const numeric = Number(value);
    const epochMs = value.length === 10 ? numeric * 1000 : numeric;
    return Number.isFinite(epochMs) ? epochMs : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareString = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });
const compareNumber = (a: number, b: number) => a - b;

const DAY_MS = 86_400_000;

/** Floor an epoch-ms timestamp to its calendar day so postings from the same
 * day compare equal regardless of an enriched intra-day time. */
const dayBucket = (epochMs: number | null) =>
  epochMs == null ? null : Math.floor(epochMs / DAY_MS);

/** Higher suitability score first; unscored jobs sort last. Direction-independent
 * so it can break posting-day ties without the outer sort direction flipping it. */
const compareScoreDescNullsLast = (a: JobListItem, b: JobListItem) => {
  const aScore = a.suitabilityScore;
  const bScore = b.suitabilityScore;
  if (aScore == null && bScore == null) return 0;
  if (aScore == null) return 1;
  if (bScore == null) return -1;
  return bScore - aScore;
};

export const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const parseSalaryBounds = (
  job: JobListItem,
): { min: number; max: number } | null => {
  if (
    typeof job.salaryMinAmount === "number" &&
    Number.isFinite(job.salaryMinAmount)
  ) {
    if (
      typeof job.salaryMaxAmount === "number" &&
      Number.isFinite(job.salaryMaxAmount)
    ) {
      return { min: job.salaryMinAmount, max: job.salaryMaxAmount };
    }
    return { min: job.salaryMinAmount, max: job.salaryMinAmount };
  }
  if (
    typeof job.salaryMaxAmount === "number" &&
    Number.isFinite(job.salaryMaxAmount)
  ) {
    return { min: job.salaryMaxAmount, max: job.salaryMaxAmount };
  }
  if (!job.salary) return null;

  const normalized = job.salary.toLowerCase().replace(/,/g, "");
  const values: number[] = [];

  const kPattern = /(\d+(?:\.\d+)?)\s*k\b/g;
  for (const match of normalized.matchAll(kPattern)) {
    values.push(Math.round(Number.parseFloat(match[1]) * 1000));
  }

  const plainPattern = /(\d{4,6}(?:\.\d+)?)/g;
  for (const match of normalized.matchAll(plainPattern)) {
    values.push(Math.round(Number.parseFloat(match[1])));
  }

  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
};

export const compareJobs = (a: JobListItem, b: JobListItem, sort: JobSort) => {
  let value = 0;

  switch (sort.key) {
    case "title":
      value = compareString(a.title, b.title);
      break;
    case "employer":
      value = compareString(a.employer, b.employer);
      break;
    case "score": {
      const aScore = a.suitabilityScore;
      const bScore = b.suitabilityScore;

      if (aScore == null && bScore == null) {
        value = 0;
        break;
      }
      if (aScore == null) return 1;
      if (bScore == null) return -1;
      value = compareNumber(aScore, bScore);
      break;
    }
    case "salary": {
      const aSalary = parseSalaryBounds(a);
      const bSalary = parseSalaryBounds(b);
      if (aSalary == null && bSalary == null) {
        value = 0;
        break;
      }
      if (aSalary == null) return 1;
      if (bSalary == null) return -1;
      value = compareNumber(aSalary.max, bSalary.max);
      if (value === 0) {
        value = compareNumber(aSalary.min, bSalary.min);
      }
      break;
    }
    case "discoveredAt": {
      const aDate = dayBucket(
        dateValue(a.datePosted) ?? dateValue(a.discoveredAt),
      );
      const bDate = dayBucket(
        dateValue(b.datePosted) ?? dateValue(b.discoveredAt),
      );
      if (aDate == null && bDate == null) {
        value = 0;
      } else if (aDate == null) {
        return 1;
      } else if (bDate == null) {
        return -1;
      } else {
        value = compareNumber(aDate, bDate);
      }
      // Within the same posting day, rank the higher ATS match first (always
      // descending, regardless of the date sort direction).
      if (value === 0) {
        const scoreTie = compareScoreDescNullsLast(a, b);
        if (scoreTie !== 0) return scoreTie;
      }
      break;
    }
    default:
      value = 0;
  }

  if (value !== 0) return sort.direction === "asc" ? value : -value;
  return a.id.localeCompare(b.id);
};

export const jobMatchesQuery = (job: JobListItem, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    job.title,
    job.employer,
    job.location,
    job.source,
    job.status,
    job.jobType,
    job.jobFunction,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
};

export const getJobCounts = (
  jobs: JobListItem[],
): Record<FilterTab, number> => {
  const byTab: Record<FilterTab, number> = {
    ready: 0,
    discovered: 0,
    applied: 0,
    all: jobs.length,
  };

  for (const job of jobs) {
    if (job.closedAt != null) continue;
    if (job.status === "in_progress") continue;
    if (job.status === "ready" || job.status === "processing") byTab.ready += 1;
    if (job.status === "applied") byTab.applied += 1;
    if (job.status === "discovered" || job.status === "processing")
      byTab.discovered += 1;
  }

  return byTab;
};

export const getEnabledSources = (
  settings: AppSettings | null,
): JobSource[] => {
  if (!settings) return [...DEFAULT_PIPELINE_SOURCES];

  const enabled: JobSource[] = [];
  const hasAdzunaAuth = Boolean(
    settings.adzunaAppId?.trim() && settings.adzunaAppKeyHint,
  );

  for (const source of orderedSources) {
    if (source === "adzuna") {
      if (hasAdzunaAuth) enabled.push(source);
      continue;
    }
    if (source === "indeed" || source === "linkedin") {
      enabled.push(source);
    }
  }

  return enabled.length > 0 ? enabled : [...DEFAULT_PIPELINE_SOURCES];
};
