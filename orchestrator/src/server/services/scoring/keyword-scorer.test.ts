import { detectSkills } from "@shared/skills/skills-dictionary";
import { describe, expect, it } from "vitest";
import { scoreKeywords } from "./keyword-scorer";

describe("scoreKeywords", () => {
  it("computes coverage and missing JD skills", () => {
    const result = scoreKeywords(
      "Experienced with React, TypeScript and Node.js",
      "We use React, TypeScript, Kubernetes and gRPC",
    );
    expect(result.coverage).toBe(50);
    expect(result.missing).toEqual(["grpc", "kubernetes"]);
  });

  it("returns null coverage when the JD has no known skills", () => {
    expect(
      scoreKeywords("React developer", "We want a team player").coverage,
    ).toBeNull();
  });

  it("avoids ambiguous natural-language aliases", () => {
    const prose = detectSkills(
      "Vue générale du poste. Go to the rest area during the spring season.",
    );
    expect([...prose]).not.toContain("vue");
    expect([...prose]).not.toContain("go");
    expect([...prose]).not.toContain("rest");
    expect([...prose]).not.toContain("spring");

    const technical = detectSkills(
      "Vue.js, Golang, Spring Boot and REST API development",
    );
    expect([...technical]).toEqual(
      expect.arrayContaining(["vue", "go", "spring", "rest"]),
    );
  });
});
