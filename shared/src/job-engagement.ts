export const EMPLOYMENT_TYPE_CATEGORIES = [
  "permanent_full_time",
  "full_time",
  "contract",
  "temporary",
  "part_time",
  "internship",
  "unknown",
] as const;

export type EmploymentTypeCategory =
  (typeof EMPLOYMENT_TYPE_CATEGORIES)[number];

export const HIRING_ORGANIZATION_CATEGORIES = [
  "staffing_agency",
  "consulting_firm",
  "unknown",
] as const;

export type HiringOrganizationCategory =
  (typeof HIRING_ORGANIZATION_CATEGORIES)[number];

export type JobEngagementClassification = {
  employmentTypeCategory: EmploymentTypeCategory;
  employmentTypeReason: string | null;
  hiringOrganizationCategory: HiringOrganizationCategory;
  hiringOrganizationReason: string | null;
};

type JobEngagementInput = {
  title?: string | null;
  employer?: string | null;
  jobType?: string | null;
  listingType?: string | null;
  jobDescription?: string | null;
  companyDescription?: string | null;
};

const normalize = (value?: string | null): string =>
  value?.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() ?? "";

function hasPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const CONTRACT_PATTERNS = [
  /\bcontract(?:or|ual)?\s+(?:role|position|opportunity|employment|basis|engagement)\b/i,
  /\bon\s+(?:an?\s+)?contract\s+basis\b/i,
  /\b(?:\d{1,2}|three|six|nine|twelve)[- ]?(?:month|months|mo)\b.{0,30}\bcontract\b/i,
  /\bcontract\b.{0,30}\b(?:\d{1,2}|three|six|nine|twelve)[- ]?(?:month|months|mo)\b/i,
  /\bcontract[- ]to[- ]hire\b/i,
  /\bfixed[- ]term\b/i,
  /\bindependent contractor\b/i,
  /\bcontract duration\b/i,
  /\btemporary contract\b/i,
];

const TEMPORARY_PATTERNS = [
  /\btemporary\s+(?:role|position|employment|assignment)\b/i,
  /\bseasonal\s+(?:role|position|employment|job)\b/i,
];

const PART_TIME_PATTERNS = [
  /\bpart[- ]time\s+(?:role|position|employment|job|opportunity)\b/i,
  /\bemployment type\s*:?\s*part[- ]time\b/i,
];

const INTERNSHIP_TITLE_PATTERNS = [/\b(?:intern|internship|co[- ]?op)\b/i];

const INTERNSHIP_DESCRIPTION_PATTERNS = [
  /\b(?:internship|co[- ]?op|student placement)\s+(?:role|position|program|opportunity)\b/i,
];

const PERMANENT_FULL_TIME_PATTERNS = [
  /\bpermanent[, /-]+full[- ]time\b/i,
  /\bfull[- ]time[, /-]+permanent\b/i,
  /\bregular[, /-]+full[- ]time\b/i,
];

const FULL_TIME_PATTERNS = [
  /\bfull[- ]time\s+(?:role|position|employment|job|opportunity)\b/i,
  /\bemployment type\s*:?\s*full[- ]time\b/i,
];

const STAFFING_NAME_PATTERNS = [
  /\bstaffing\b/i,
  /\brecruit(?:ing|ment|ers?)\b/i,
  /\btalent solutions\b/i,
  /\bworkforce solutions\b/i,
  /\bemployment agency\b/i,
  /\bplacement services?\b/i,
  /\bheadhunt(?:ing|ers?)\b/i,
];

const STAFFING_DESCRIPTION_PATTERNS = [
  /\b(?:recruiting|hiring|seeking candidates?) on behalf of (?:one of )?our client(?:s)?\b/i,
  /\bon behalf of (?:one of )?our client(?:s)?\b.{0,80}\b(?:seeking|hiring|looking for)\b/i,
  /\bour client (?:is|,? a .{0,50},? is) (?:seeking|hiring|looking for)\b/i,
  /\b(?:staffing|recruitment|employment) agency\b/i,
  /\bplaced (?:with|at) (?:one of )?our client(?:s)?\b/i,
];

const CONSULTING_NAME_PATTERNS = [
  /\bconsult(?:ing|ancy|ants?)\b/i,
  /\badvisory services\b/i,
  /\bprofessional services\b/i,
];

const CONSULTING_DESCRIPTION_PATTERNS = [
  /\bjoin our consulting (?:practice|team)\b/i,
  /\bconsulting (?:firm|practice)\b/i,
  /\bclient[- ]facing consulting (?:role|position|work)\b/i,
];

function classifyEmploymentType(
  input: JobEngagementInput,
): Pick<
  JobEngagementClassification,
  "employmentTypeCategory" | "employmentTypeReason"
> {
  const sourceType = normalize(
    [input.jobType, input.listingType].filter(Boolean).join(" "),
  );
  const title = normalize(input.title);
  const description = normalize(input.jobDescription).slice(0, 20_000);
  const searchable = `${title} ${description}`;

  if (/\b(?:contract|contractor|fixed[- ]term)\b/i.test(sourceType)) {
    return {
      employmentTypeCategory: "contract",
      employmentTypeReason: `Source employment type: ${[input.jobType, input.listingType].filter(Boolean).join(" / ")}`,
    };
  }
  if (hasPattern(searchable, CONTRACT_PATTERNS)) {
    return {
      employmentTypeCategory: "contract",
      employmentTypeReason:
        "Title or job description explicitly describes a contract or fixed-term role.",
    };
  }
  if (/\b(?:temporary|temp|seasonal)\b/i.test(sourceType)) {
    return {
      employmentTypeCategory: "temporary",
      employmentTypeReason: `Source employment type: ${[input.jobType, input.listingType].filter(Boolean).join(" / ")}`,
    };
  }
  if (hasPattern(searchable, TEMPORARY_PATTERNS)) {
    return {
      employmentTypeCategory: "temporary",
      employmentTypeReason:
        "Title or job description explicitly describes temporary employment.",
    };
  }
  if (/\bpart[- ]?time\b/i.test(sourceType)) {
    return {
      employmentTypeCategory: "part_time",
      employmentTypeReason: `Source employment type: ${[input.jobType, input.listingType].filter(Boolean).join(" / ")}`,
    };
  }
  if (hasPattern(searchable, PART_TIME_PATTERNS)) {
    return {
      employmentTypeCategory: "part_time",
      employmentTypeReason:
        "Title or job description explicitly describes part-time employment.",
    };
  }
  if (/\b(?:internship|intern|co[- ]?op)\b/i.test(sourceType)) {
    return {
      employmentTypeCategory: "internship",
      employmentTypeReason: `Source employment type: ${[input.jobType, input.listingType].filter(Boolean).join(" / ")}`,
    };
  }
  if (
    hasPattern(title, INTERNSHIP_TITLE_PATTERNS) ||
    hasPattern(description, INTERNSHIP_DESCRIPTION_PATTERNS)
  ) {
    return {
      employmentTypeCategory: "internship",
      employmentTypeReason:
        "Title or job description explicitly describes an internship or co-op.",
    };
  }
  if (hasPattern(`${sourceType} ${searchable}`, PERMANENT_FULL_TIME_PATTERNS)) {
    return {
      employmentTypeCategory: "permanent_full_time",
      employmentTypeReason:
        "The source, title, or job description explicitly states permanent full-time employment.",
    };
  }
  if (/\bfull[- ]?time\b/i.test(sourceType)) {
    return {
      employmentTypeCategory: "full_time",
      employmentTypeReason: `Source employment type: ${[input.jobType, input.listingType].filter(Boolean).join(" / ")}`,
    };
  }
  if (hasPattern(searchable, FULL_TIME_PATTERNS)) {
    return {
      employmentTypeCategory: "full_time",
      employmentTypeReason:
        "Title or job description explicitly states full-time employment; permanence is not stated.",
    };
  }

  return {
    employmentTypeCategory: "unknown",
    employmentTypeReason: null,
  };
}

function classifyHiringOrganization(
  input: JobEngagementInput,
): Pick<
  JobEngagementClassification,
  "hiringOrganizationCategory" | "hiringOrganizationReason"
> {
  const employer = normalize(input.employer);
  const description = normalize(
    [input.companyDescription, input.jobDescription].filter(Boolean).join(" "),
  ).slice(0, 30_000);

  if (hasPattern(employer, STAFFING_NAME_PATTERNS)) {
    return {
      hiringOrganizationCategory: "staffing_agency",
      hiringOrganizationReason:
        "The employer name contains a staffing or recruitment indicator.",
    };
  }
  if (hasPattern(description, STAFFING_DESCRIPTION_PATTERNS)) {
    return {
      hiringOrganizationCategory: "staffing_agency",
      hiringOrganizationReason:
        "The company or job description explicitly says the role is being recruited for a client.",
    };
  }
  if (hasPattern(employer, CONSULTING_NAME_PATTERNS)) {
    return {
      hiringOrganizationCategory: "consulting_firm",
      hiringOrganizationReason:
        "The employer name contains a consulting or advisory indicator.",
    };
  }
  if (hasPattern(description, CONSULTING_DESCRIPTION_PATTERNS)) {
    return {
      hiringOrganizationCategory: "consulting_firm",
      hiringOrganizationReason:
        "The company or job description explicitly describes a consulting practice.",
    };
  }

  return {
    hiringOrganizationCategory: "unknown",
    hiringOrganizationReason: null,
  };
}

export function classifyJobEngagement(
  input: JobEngagementInput,
): JobEngagementClassification {
  return {
    ...classifyEmploymentType(input),
    ...classifyHiringOrganization(input),
  };
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentTypeCategory, string> = {
  permanent_full_time: "Permanent · Full-time",
  full_time: "Full-time",
  contract: "Contract",
  temporary: "Temporary",
  part_time: "Part-time",
  internship: "Internship / Co-op",
  unknown: "Unknown",
};

export const HIRING_ORGANIZATION_LABELS: Record<
  HiringOrganizationCategory,
  string
> = {
  staffing_agency: "Staffing agency",
  consulting_firm: "Consulting firm",
  unknown: "Unknown",
};
