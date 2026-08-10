import { describe, expect, it } from "vitest";
import { calculateAtsScore, calibrateSemanticSimilarity } from "./ats-rules";

const resume = `Backend Software Developer
Bachelor of Computer Science
React TypeScript Node.js Java PostgreSQL Docker AWS`;

describe("ATS scoring rules", () => {
  it("does not award 100 for a full match on only two detected skills", () => {
    const result = calculateAtsScore({
      resumeText: resume,
      jobTitle: "Backend Software Developer",
      jobDescription:
        "Build backend services using React and TypeScript. Work with the engineering team to deliver production APIs.",
      keywordCoverage: 100,
      jobSkills: ["react", "typescript"],
      missingSkills: [],
      semanticScore: null,
      semanticWeight: 0.7,
    });

    expect(result.total).toBeLessThanOrEqual(60);
    expect(result.technicalScore).toBe(75);
    expect(result.confidenceCap).toBe(60);
  });

  it("scores a detailed strong match highly but never above 95", () => {
    const result = calculateAtsScore({
      resumeText: resume,
      jobTitle: "Backend Software Developer",
      jobDescription: `${"Develop production backend APIs and services. ".repeat(8)}
        Required technologies: React, TypeScript, Node.js, Java, PostgreSQL, Docker and AWS.
        Bachelor's degree required.`,
      keywordCoverage: 100,
      jobSkills: [
        "aws",
        "docker",
        "java",
        "node.js",
        "postgresql",
        "react",
        "typescript",
      ],
      missingSkills: [],
      semanticScore: 95,
      semanticWeight: 1,
    });

    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.total).toBeLessThanOrEqual(95);
  });

  it("penalizes missing skills and a seniority mismatch", () => {
    const result = calculateAtsScore({
      resumeText: "Junior frontend developer with React",
      jobTitle: "Principal Backend Engineer",
      jobDescription: `${"Lead architecture for distributed backend systems. ".repeat(8)}
        Kubernetes, Kafka, Java, AWS and Terraform are required.`,
      keywordCoverage: 0,
      jobSkills: ["aws", "java", "kafka", "kubernetes", "terraform"],
      missingSkills: ["aws", "java", "kafka", "kubernetes", "terraform"],
      semanticScore: null,
      semanticWeight: 0.7,
    });

    expect(result.total).toBeLessThan(30);
    expect(result.seniorityScore).toBe(15);
    expect(result.roleScore).toBe(55);
  });

  it("returns zero without extractable resume text", () => {
    expect(
      calculateAtsScore({
        resumeText: "",
        jobTitle: "Software Engineer",
        jobDescription: "React and TypeScript",
        keywordCoverage: 100,
        jobSkills: ["react", "typescript"],
        missingSkills: [],
        semanticScore: null,
        semanticWeight: 0.7,
      }).total,
    ).toBe(0);
  });

  it("calibrates cosine similarity instead of treating it as a percentage", () => {
    expect(calibrateSemanticSimilarity(0.25)).toBe(0);
    expect(calibrateSemanticSimilarity(0.7)).toBeGreaterThan(60);
    expect(calibrateSemanticSimilarity(0.7)).toBeLessThan(70);
    expect(calibrateSemanticSimilarity(1)).toBe(95);
  });
});
