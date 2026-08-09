import type { ApplicationAnswerConfig } from "@shared/types/application";
import { describe, expect, it } from "vitest";
import { createApplicationFillPlan } from "./application-fill-plan";

const config: ApplicationAnswerConfig = {
  version: 1,
  enabled: true,
  workAuthorization: {
    country: "Canada",
    authorizedToWork: true,
    requiresSponsorship: false,
  },
  answers: {},
};

describe("createApplicationFillPlan", () => {
  it("returns only configured answers and requires review for unknown fields", () => {
    expect(
      createApplicationFillPlan(
        "job-1",
        [
          {
            label: "Are you legally authorized to work in Canada?",
            type: "radio",
            options: ["Yes", "No"],
          },
          { label: "What is your preferred start date?", type: "text" },
        ],
        config,
      ),
    ).toEqual({
      jobId: "job-1",
      answers: [
        {
          index: 0,
          answer: {
            kind: "work_authorization",
            value: "Yes",
            source: "config",
          },
        },
      ],
      unresolved: [
        {
          index: 1,
          question: { label: "What is your preferred start date?" },
          unresolved: { kind: "unknown", reason: "unknown_question" },
        },
      ],
      requiresReview: true,
      submission: {
        allowed: false,
        requiresConfirmation: true,
        reason: "unresolved_questions",
      },
    });
  });

  it("still requires a manual confirmation when every field is resolved", () => {
    const plan = createApplicationFillPlan(
      "job-1",
      [
        {
          label: "Do you require employer sponsorship?",
          type: "radio",
          options: ["Yes", "No"],
        },
      ],
      config,
    );

    expect(plan.requiresReview).toBe(true);
    expect(plan.submission).toEqual({
      allowed: true,
      requiresConfirmation: true,
      reason: null,
    });
  });
});
