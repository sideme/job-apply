const DEFAULT_JOB_TIME_ZONE = "America/Toronto";
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateFilter(value: string | null): value is string {
  if (!value || !LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function getTodayDateFilter(
  now = new Date(),
  timeZone = DEFAULT_JOB_TIME_ZONE,
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isPostingDateOnFilter(
  datePosted: string | null | undefined,
  dateFilter: string,
): boolean {
  if (!datePosted || !isValidDateFilter(dateFilter)) return false;
  const value = datePosted.trim();
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  const milliseconds =
    numeric == null
      ? Date.parse(value)
      : numeric < 10_000_000_000
        ? numeric * 1000
        : numeric;
  if (!Number.isFinite(milliseconds)) return false;
  return new Date(milliseconds).toISOString().slice(0, 10) === dateFilter;
}

export function isJobOnDateFilter(
  job: {
    datePosted?: string | null;
    discoveredAt?: string | null;
  },
  dateFilter: string,
): boolean {
  if (job.datePosted) {
    return isPostingDateOnFilter(job.datePosted, dateFilter);
  }
  if (!job.discoveredAt || !isValidDateFilter(dateFilter)) return false;
  const discoveredAt = new Date(job.discoveredAt);
  if (Number.isNaN(discoveredAt.getTime())) return false;
  return getTodayDateFilter(discoveredAt) === dateFilter;
}
