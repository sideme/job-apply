export type AtsRuleResult = {
  total: number;
  technicalScore: number;
  roleScore: number;
  seniorityScore: number;
  qualificationScore: number;
  semanticScore: number | null;
  confidenceCap: number;
  reason: string;
};

type AtsRuleInput = {
  resumeText: string;
  jobTitle: string;
  jobDescription: string;
  keywordCoverage: number | null;
  jobSkills: string[];
  missingSkills: string[];
  semanticScore: number | null;
  semanticWeight: number;
};

const ROLE_FAMILIES: Array<[string, RegExp]> = [
  ["backend", /\b(back[ -]?end|server[ -]?side|api)\b/i],
  ["frontend", /\b(front[ -]?end|ui engineer|web ui)\b/i],
  ["fullstack", /\b(full[ -]?stack)\b/i],
  ["mobile", /\b(mobile|ios|android)\b/i],
  ["data", /\b(data engineer|data platform|etl|analytics engineer)\b/i],
  [
    "ml",
    /\b(machine learning|artificial intelligence|ai engineer|ml engineer)\b/i,
  ],
  ["devops", /\b(devops|site reliability|sre|infrastructure engineer)\b/i],
  ["cloud", /\b(cloud engineer|cloud platform|cloud architect)\b/i],
  ["security", /\b(security|cybersecurity|application security)\b/i],
  ["qa", /\b(qa|quality assurance|test analyst|sdet|software tester)\b/i],
  ["embedded", /\b(embedded|firmware)\b/i],
  ["platform", /\b(platform engineer|developer platform)\b/i],
  ["manufacturing", /\b(cnc|machinist|manufacturing programmer)\b/i],
];

const GENERIC_ROLE = /\b(engineer|developer|programmer|analyst|architect)\b/i;

function detectRoleFamilies(text: string): Set<string> {
  return new Set(
    ROLE_FAMILIES.filter(([, pattern]) => pattern.test(text)).map(
      ([family]) => family,
    ),
  );
}

function roleAlignment(resumeText: string, jobTitle: string): number {
  const jobFamilies = detectRoleFamilies(jobTitle);
  const resumeFamilies = detectRoleFamilies(resumeText);
  const hasGenericJobRole = GENERIC_ROLE.test(jobTitle);
  const hasGenericResumeRole = GENERIC_ROLE.test(resumeText);

  if (jobFamilies.size === 0) {
    if (!hasGenericJobRole) return 45;
    return hasGenericResumeRole ? 75 : 30;
  }
  if ([...jobFamilies].some((family) => resumeFamilies.has(family))) {
    return 95;
  }
  return hasGenericJobRole && hasGenericResumeRole ? 55 : 20;
}

function seniorityLevel(text: string): number | null {
  if (/\b(principal|director|head of|vp|vice president)\b/i.test(text)) {
    return 5;
  }
  if (/\b(staff|lead|manager|architect)\b/i.test(text)) return 4;
  if (/\b(senior|sr\.?|experienced)\b/i.test(text)) return 3;
  if (/\b(junior|jr\.?|entry[ -]?level|new grad|associate)\b/i.test(text)) {
    return 1;
  }
  if (/\b(intern|internship|co[ -]?op|student)\b/i.test(text)) return 0;
  return null;
}

function seniorityAlignment(resumeText: string, jobTitle: string): number {
  const jobLevel = seniorityLevel(jobTitle);
  if (jobLevel === null) return 75;

  const resumeLevel = seniorityLevel(resumeText) ?? 2;
  if (jobLevel === 0 && resumeLevel >= 1) return 90;
  if (resumeLevel >= jobLevel) return 95;
  return jobLevel - resumeLevel === 1 ? 50 : 15;
}

function qualificationAlignment(
  resumeText: string,
  jobDescription: string,
): number {
  const asksForMaster = /\b(master'?s|m\.?(?:sc|eng|s)\.?)\b/i.test(
    jobDescription,
  );
  const asksForBachelor =
    /\b(bachelor'?s|b\.?(?:sc|eng|s)\.?|undergraduate degree)\b/i.test(
      jobDescription,
    );
  const resumeHasMaster = /\b(master'?s|m\.?(?:sc|eng|s)\.?)\b/i.test(
    resumeText,
  );
  const resumeHasBachelor =
    /\b(bachelor'?s|b\.?(?:sc|eng|s)\.?|undergraduate degree)\b/i.test(
      resumeText,
    );

  if (asksForMaster) {
    if (resumeHasMaster) return 100;
    return resumeHasBachelor ? 50 : 30;
  }
  if (asksForBachelor) return resumeHasBachelor || resumeHasMaster ? 100 : 45;
  return 75;
}

function technicalAlignment(
  coverage: number | null,
  skillCount: number,
): number {
  if (coverage === null || skillCount === 0) return 35;
  // A 100% match across only one or two detected words is weak evidence. The
  // confidence factor reaches 1 only when the JD exposes at least five skills.
  const evidenceFactor = Math.min(1, 0.55 + skillCount * 0.1);
  return Math.round(coverage * evidenceFactor);
}

function calculateConfidenceCap(args: AtsRuleInput): number {
  const semanticBonus = args.semanticScore === null ? 0 : 5;
  const skillCap =
    args.jobSkills.length === 0
      ? 70
      : args.jobSkills.length === 1
        ? 78
        : args.jobSkills.length === 2
          ? 86
          : args.jobSkills.length === 3
            ? 92
            : 95;
  const descriptionLength = args.jobDescription.trim().length;
  const descriptionCap =
    descriptionLength < 120 ? 60 : descriptionLength < 300 ? 82 : 95;
  return Math.min(95, skillCap + semanticBonus, descriptionCap);
}

/** Convert raw cosine similarity into a conservative 0-95 ATS signal. */
export function calibrateSemanticSimilarity(similarity: number): number {
  const bounded = Math.min(1, Math.max(-1, similarity));
  if (bounded <= 0.25) return 0;
  return Math.round(Math.min(95, ((bounded - 0.25) / 0.65) * 95));
}

/**
 * Conservative, explainable ATS-style score. Rules always retain at least 75%
 * of the final weight; embeddings are optional supporting evidence only.
 */
export function calculateAtsScore(args: AtsRuleInput): AtsRuleResult {
  if (!args.resumeText.trim()) {
    return {
      total: 0,
      technicalScore: 0,
      roleScore: 0,
      seniorityScore: 0,
      qualificationScore: 0,
      semanticScore: args.semanticScore,
      confidenceCap: 0,
      reason: "ATS 0 · No extractable resume text",
    };
  }

  const technicalScore = technicalAlignment(
    args.keywordCoverage,
    args.jobSkills.length,
  );
  const roleScore = roleAlignment(args.resumeText, args.jobTitle);
  const seniorityScore = seniorityAlignment(args.resumeText, args.jobTitle);
  const qualificationScore = qualificationAlignment(
    args.resumeText,
    args.jobDescription,
  );
  const rulesScore =
    technicalScore * 0.55 +
    roleScore * 0.25 +
    seniorityScore * 0.12 +
    qualificationScore * 0.08;
  const semanticWeight =
    args.semanticScore === null
      ? 0
      : Math.min(0.25, Math.max(0, args.semanticWeight) * 0.25);
  const blended =
    rulesScore * (1 - semanticWeight) +
    (args.semanticScore ?? 0) * semanticWeight;
  const confidenceCap = calculateConfidenceCap(args);
  const total = Math.min(confidenceCap, Math.max(0, Math.round(blended)));
  const matched = args.jobSkills.length - args.missingSkills.length;
  const parts = [
    `ATS ${total}`,
    `skills ${technicalScore} (${matched}/${args.jobSkills.length})`,
    `role ${roleScore}`,
    `seniority ${seniorityScore}`,
    `qualifications ${qualificationScore}`,
    args.semanticScore === null ? null : `semantic ${args.semanticScore}`,
    confidenceCap < 95 ? `confidence cap ${confidenceCap}` : null,
    args.missingSkills.length > 0
      ? `Missing: ${args.missingSkills.slice(0, 6).join(", ")}`
      : null,
  ].filter((part): part is string => Boolean(part));

  return {
    total,
    technicalScore,
    roleScore,
    seniorityScore,
    qualificationScore,
    semanticScore: args.semanticScore,
    confidenceCap,
    reason: parts.join(" · "),
  };
}
