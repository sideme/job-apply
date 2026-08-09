type JobIdentity = {
  id?: string;
  source: string;
  sourceJobId?: string | null;
  title: string;
  employer: string;
  location?: string | null;
  datePosted?: string | null;
  jobUrl?: string | null;
  jobUrlDirect?: string | null;
  applicationLink?: string | null;
  status?: string | null;
  suitabilityScore?: number | null;
  jobDescription?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_POST_DATE_DIFFERENCE_MS = 3 * DAY_MS;

function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bsr\.?\b/g, "senior")
    .replace(/\bjr\.?\b/g, "junior")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmployer(value: string): string {
  return normalizeWords(value)
    .replace(/\s+(?:incorporated|inc|limited|ltd|corporation|corp|llc)$/, "")
    .trim();
}

function normalizeLocation(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const firstSegment = value.split(",", 1)[0];
  return normalizeWords(firstSegment) || null;
}

function parsePostedAt(value?: string | null): number | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const parsed =
    numeric == null
      ? Date.parse(trimmed)
      : numeric < 10_000_000_000
        ? numeric * 1000
        : numeric;
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalizeUrl(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["ref", "refid", "trackingid", "trk"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function canonicalUrls(job: JobIdentity): string[] {
  return Array.from(
    new Set(
      [job.jobUrlDirect, job.applicationLink, job.jobUrl]
        .map(canonicalizeUrl)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function identityKey(job: JobIdentity): string {
  return `${normalizeWords(job.title)}\u0000${normalizeEmployer(job.employer)}`;
}

function descriptionSimilarity(left?: string | null, right?: string | null) {
  if (!left || !right) return 0;
  const normalizedLeft = normalizeWords(left);
  const normalizedRight = normalizeWords(right);
  if (normalizedLeft.length < 120 || normalizedRight.length < 120) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return (
      Math.min(normalizedLeft.length, normalizedRight.length) /
      Math.max(normalizedLeft.length, normalizedRight.length)
    );
  }

  const leftWords = new Set(normalizedLeft.split(" "));
  const rightWords = new Set(normalizedRight.split(" "));
  let intersection = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) intersection += 1;
  }
  const union = new Set([...leftWords, ...rightWords]).size;
  return union === 0 ? 0 : intersection / union;
}

export function areCrossSourceDuplicates(
  left: JobIdentity,
  right: JobIdentity,
): boolean {
  const rightUrls = new Set(canonicalUrls(right));
  if (canonicalUrls(left).some((url) => rightUrls.has(url))) return true;

  if (normalizeWords(left.title) !== normalizeWords(right.title)) return false;
  if (normalizeEmployer(left.employer) !== normalizeEmployer(right.employer)) {
    return false;
  }

  const leftLocation = normalizeLocation(left.location);
  const rightLocation = normalizeLocation(right.location);
  if (leftLocation && rightLocation && leftLocation !== rightLocation) {
    return false;
  }

  const leftPostedAt = parsePostedAt(left.datePosted);
  const rightPostedAt = parsePostedAt(right.datePosted);
  if (leftPostedAt != null && rightPostedAt != null) {
    if (Math.abs(leftPostedAt - rightPostedAt) > MAX_POST_DATE_DIFFERENCE_MS) {
      return false;
    }
  }

  if (left.source !== right.source) return true;

  if (
    left.sourceJobId &&
    right.sourceJobId &&
    left.sourceJobId === right.sourceJobId
  ) {
    return true;
  }

  // Same-source search APIs can return the same advertisement under different
  // result URLs. Require a near-identical JD so legitimate parallel openings
  // with the same generic title are preserved.
  return (
    descriptionSimilarity(left.jobDescription, right.jobDescription) >= 0.92
  );
}

export function findDuplicateJob<T extends JobIdentity>(
  candidate: JobIdentity,
  existingJobs: T[],
): T | null {
  return (
    existingJobs.find((existing) =>
      areCrossSourceDuplicates(candidate, existing),
    ) ?? null
  );
}

export function createJobDuplicateIndex<T extends JobIdentity>(jobs: T[] = []) {
  const byUrl = new Map<string, T>();
  const byIdentity = new Map<string, T[]>();

  const add = (job: T): void => {
    for (const url of canonicalUrls(job)) {
      if (!byUrl.has(url)) byUrl.set(url, job);
    }
    const key = identityKey(job);
    const matches = byIdentity.get(key);
    if (matches) matches.push(job);
    else byIdentity.set(key, [job]);
  };

  const find = (candidate: JobIdentity): T | null => {
    for (const url of canonicalUrls(candidate)) {
      const match = byUrl.get(url);
      if (match) return match;
    }
    return findDuplicateJob(
      candidate,
      byIdentity.get(identityKey(candidate)) ?? [],
    );
  };

  for (const job of jobs) add(job);
  return { add, find };
}

function preferenceScore(job: JobIdentity): number {
  const statusRank: Record<string, number> = {
    in_progress: 7,
    applied: 6,
    ready: 5,
    processing: 4,
    discovered: 3,
    skipped: 2,
    expired: 1,
  };
  const sourceRank: Record<string, number> = {
    indeed: 4,
    linkedin: 3,
    glassdoor: 2,
    adzuna: 1,
  };
  const descriptionBonus = Math.min(job.jobDescription?.length ?? 0, 20_000);
  return (
    (statusRank[job.status ?? ""] ?? 0) * 1_000_000 +
    descriptionBonus * 10 +
    (job.suitabilityScore ?? 0) * 10 +
    (sourceRank[job.source] ?? 0)
  );
}

export function buildDuplicateAssignments<
  T extends JobIdentity & { id: string },
>(jobs: T[]): Array<{ duplicateId: string; winnerId: string }> {
  const ordered = [...jobs].sort(
    (left, right) => preferenceScore(right) - preferenceScore(left),
  );
  const winners = createJobDuplicateIndex<T>();
  const assignments: Array<{ duplicateId: string; winnerId: string }> = [];

  for (const job of ordered) {
    const winner = winners.find(job);
    if (winner) {
      assignments.push({ duplicateId: job.id, winnerId: winner.id });
    } else {
      winners.add(job);
    }
  }

  return assignments;
}
