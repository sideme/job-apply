export const JOB_LEVELS = [
  "internship",
  "entry_level",
  "associate",
  "mid_level",
  "senior",
  "lead",
  "manager",
  "director",
  "executive",
] as const;

export type JobLevel = (typeof JOB_LEVELS)[number];

export const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
  internship: "Internship",
  entry_level: "Entry level",
  associate: "Associate",
  mid_level: "Mid level",
  senior: "Senior",
  lead: "Lead / Principal",
  manager: "Manager",
  director: "Director / Head",
  executive: "Executive",
};

const UNKNOWN_LEVEL_PATTERN =
  /^(?:n\/?a|not applicable|not specified|unspecified|unknown|none|-)?$/i;

const LEVEL_PATTERNS: ReadonlyArray<{
  level: JobLevel;
  pattern: RegExp;
}> = [
  {
    level: "executive",
    pattern:
      /\b(?:executive|c[- ]?suite|chief|ceo|cto|cio|cfo|coo|vice president|v\.?p\.?)\b/i,
  },
  { level: "director", pattern: /\b(?:director|head of)\b/i },
  { level: "manager", pattern: /\b(?:manager|management)\b/i },
  {
    level: "lead",
    pattern: /\b(?:team lead|tech lead|technical lead|lead|staff|principal)\b/i,
  },
  {
    level: "senior",
    pattern: /\b(?:mid[- ]senior|senior|sr\.?|expert|level (?:iii|3))\b/i,
  },
  {
    level: "mid_level",
    pattern: /\b(?:mid[- ]level|intermediate|level (?:ii|2))\b/i,
  },
  { level: "associate", pattern: /\bassociate\b/i },
  {
    level: "entry_level",
    pattern:
      /\b(?:entry[- ]level|entry|junior|jr\.?|new grad(?:uate)?|graduate|early career|level (?:i|1))\b/i,
  },
  {
    level: "internship",
    pattern: /\b(?:internship|intern|co[- ]?op|student)\b/i,
  },
];

function detectLevel(text: string): JobLevel | null {
  for (const candidate of LEVEL_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.level;
  }
  return null;
}

/**
 * Converts source-specific level labels into a stable category. Explicit
 * source metadata wins; the title is used only when the source omitted the
 * level or returned a placeholder such as "not applicable".
 */
export function inferJobLevel(
  rawLevel?: string | null,
  title?: string | null,
): JobLevel | null {
  const normalizedRaw = rawLevel?.trim() ?? "";
  if (!UNKNOWN_LEVEL_PATTERN.test(normalizedRaw)) {
    const explicitLevel = detectLevel(normalizedRaw);
    if (explicitLevel) return explicitLevel;
  }

  const normalizedTitle = title?.trim() ?? "";
  return normalizedTitle ? detectLevel(normalizedTitle) : null;
}

export function formatJobLevel(level?: JobLevel | null): string | null {
  return level ? JOB_LEVEL_LABELS[level] : null;
}
