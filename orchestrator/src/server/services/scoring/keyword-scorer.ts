import { detectSkills } from "@shared/skills/skills-dictionary";

export interface KeywordScore {
  coverage: number | null;
  missing: string[];
  jobSkills: string[];
  resumeSkills: string[];
}

export function scoreKeywords(
  resumeText: string,
  jobText: string,
): KeywordScore {
  const resumeSkills = detectSkills(resumeText);
  const jobSkills = detectSkills(jobText);
  const sortedResumeSkills = [...resumeSkills].sort();

  if (jobSkills.size === 0) {
    return {
      coverage: null,
      missing: [],
      jobSkills: [],
      resumeSkills: sortedResumeSkills,
    };
  }

  const missing = [...jobSkills]
    .filter((skill) => !resumeSkills.has(skill))
    .sort();
  return {
    coverage: Math.round(
      ((jobSkills.size - missing.length) / jobSkills.size) * 100,
    ),
    missing,
    jobSkills: [...jobSkills].sort(),
    resumeSkills: sortedResumeSkills,
  };
}
