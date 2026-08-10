import { describe, expect, it } from "vitest";
import { detectSkills, SKILLS_DICTIONARY } from "./skills-dictionary";

describe("detectSkills", () => {
  it("normalizes aliases to the canonical skill", () => {
    expect(detectSkills("Built UIs with ReactJS and react.js")).toContain(
      "react",
    );
    expect(detectSkills("Deployed on K8s")).toContain("kubernetes");
  });

  it("matches whole words case-insensitively, not substrings", () => {
    const skills = detectSkills("Strong JavaScript background");
    expect(skills.has("javascript")).toBe(true);
    expect(skills.has("java")).toBe(false);
  });

  it("returns an empty set when no known skill appears", () => {
    expect(detectSkills("passionate team player").size).toBe(0);
  });

  it("includes unambiguous canonical keys among their aliases", () => {
    const intentionallyQualified = new Set(["go", "rest", "spring", "vue"]);
    for (const [canonical, aliases] of Object.entries(SKILLS_DICTIONARY)) {
      if (intentionallyQualified.has(canonical)) continue;
      expect(aliases).toContain(canonical);
    }
  });
});
