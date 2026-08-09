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
});
