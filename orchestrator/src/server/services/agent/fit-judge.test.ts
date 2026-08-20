// @vitest-environment node

import { createJob } from "@shared/testing/factories";
import { describe, expect, it } from "vitest";
import {
  buildFitInputHash,
  buildFitMessages,
  createFitJudgeTools,
  type FitJudgment,
} from "./fit-judge";

describe("Fit Judge", () => {
  it("uses normalized inputs and invalidates cache identity on material change", () => {
    const base = {
      resumeText: "React   TypeScript\nNode.js",
      job: createJob({
        title: "Frontend Engineer",
        jobDescription: "Build React products",
      }),
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: "fit-judge-v1",
      applicationConstraints: {
        country: "Canada",
        authorizedToWork: true,
        requiresSponsorship: false,
      },
    };

    expect(buildFitInputHash(base)).toBe(
      buildFitInputHash({ ...base, resumeText: "React TypeScript Node.js" }),
    );
    expect(buildFitInputHash(base)).not.toBe(
      buildFitInputHash({ ...base, model: "deepseek-v4-pro" }),
    );
    expect(buildFitInputHash(base)).not.toBe(
      buildFitInputHash({ ...base, resumeText: "Python Django" }),
    );
  });

  it("binds full-JD access to one job and truncates the returned text", async () => {
    const job = createJob({
      id: "87890754-9a35-42e4-a478-cbb5f8494a1a",
      jobDescription: "x".repeat(4_000),
    });
    const [fetchTool] = createFitJudgeTools({ job, maxJdChars: 1_000 });

    await expect(
      fetchTool?.execute(
        { jobId: "47bbb81a-3316-48e0-ab57-405236274c88" },
        { signal: new AbortController().signal, toolCallId: "call-1" },
      ),
    ).rejects.toThrow(/outside this Fit Judge scope/);

    const execution = await fetchTool?.execute(
      { jobId: job.id },
      { signal: new AbortController().signal, toolCallId: "call-2" },
    );
    expect(execution?.result).toMatchObject({
      jobId: job.id,
      truncated: true,
    });
    expect(
      (execution?.result as { jobDescription: string }).jobDescription,
    ).toHaveLength(1_000);
  });

  it("includes the bound job ID when offering full-JD access", () => {
    const job = createJob({
      id: "87890754-9a35-42e4-a478-cbb5f8494a1a",
      jobDescription: "A bounded excerpt",
    });

    const messages = buildFitMessages({
      job,
      resumeText: "TypeScript engineer",
      applicationConstraints: {
        country: "Canada",
        authorizedToWork: true,
        requiresSponsorship: false,
        relocation: null,
      },
      maxJdChars: 12_000,
    });

    expect(messages.at(-1)?.content).toContain(`job_id: ${job.id}`);
  });

  it("places one bounded JD in the initial judgment request", () => {
    const job = createJob({
      jobDescription: "x".repeat(4_000),
    });

    const messages = buildFitMessages({
      job,
      resumeText: "TypeScript engineer",
      applicationConstraints: {
        country: "Canada",
        authorizedToWork: true,
        requiresSponsorship: false,
        relocation: null,
      },
      maxJdChars: 1_000,
    });
    const prompt = messages.at(-1)?.content ?? "";

    expect(prompt).toContain("job_description_truncated: true");
    expect(prompt).toContain(
      `<job_description>${"x".repeat(1_000)}</job_description>`,
    );
    expect(prompt).not.toContain("fetch_full_jd");
  });

  it("normalizes verbose model output before storing a judgment", async () => {
    const job = createJob();
    const submitTool = createFitJudgeTools({ job, maxJdChars: 1_000 }).find(
      (tool) => tool.definition.name === "submit_judgment",
    );
    const execution = await submitTool?.execute(
      {
        verdict: "STRONG FIT",
        llmFitScore: 101.4,
        fitPoints: Array.from(
          { length: 8 },
          (_, index) => `${index}-${"x".repeat(300)}`,
        ),
        gaps: ["  one gap  "],
        extraExplanation: "ignored",
      },
      { signal: new AbortController().signal, toolCallId: "call-1" },
    );

    expect(execution?.terminalValue).toMatchObject({
      verdict: "strong",
      llmFitScore: 100,
      gaps: ["one gap"],
    });
    expect((execution?.terminalValue as FitJudgment).fitPoints).toHaveLength(6);
    expect((execution?.terminalValue as FitJudgment).fitPoints[0]).toHaveLength(
      240,
    );
  });
});
