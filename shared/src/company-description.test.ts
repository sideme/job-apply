import { describe, expect, it } from "vitest";
import { resolveCompanyDescription } from "./company-description";

describe("resolveCompanyDescription", () => {
  it("prefers the source company profile and removes HTML", () => {
    expect(
      resolveCompanyDescription({
        employer: "Acme",
        companyDescription:
          "<p>Acme builds reliable payment infrastructure.</p>",
        jobDescription: "## About Acme\nThis fallback should not be used.",
      }),
    ).toEqual({
      description: "Acme builds reliable payment infrastructure.",
      source: "source",
    });
  });

  it("extracts an explicit company section from the job description", () => {
    const result = resolveCompanyDescription({
      employer: "Acme Labs",
      companyDescription: null,
      jobDescription: [
        "# Backend Engineer",
        "## About Acme Labs",
        "Acme Labs builds tools that help teams ship reliable software globally.",
        "We support customers across North America.",
        "## About the role",
        "You will build APIs.",
      ].join("\n"),
    });

    expect(result).toEqual({
      description:
        "Acme Labs builds tools that help teams ship reliable software globally.\nWe support customers across North America.",
      source: "job_description",
    });
  });

  it("does not guess a company description without an explicit section", () => {
    expect(
      resolveCompanyDescription({
        employer: "Acme",
        companyDescription: null,
        jobDescription:
          "About the role\nBuild services and collaborate with product teams.",
      }),
    ).toBeNull();
  });
});
