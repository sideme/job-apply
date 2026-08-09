/**
 * Convert every supported source date representation to fixed-width epoch
 * milliseconds. Keeping one representation makes SQLite TEXT ordering
 * chronological across extractors.
 */
export function normalizePostingDate(
  value?: string | number | null,
): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const numeric = /^\d+$/.test(raw) ? Number(raw) : null;
  const milliseconds =
    numeric == null
      ? Date.parse(raw)
      : numeric < 10_000_000_000
        ? numeric * 1000
        : numeric;

  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return String(date.getTime());
}
