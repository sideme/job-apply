import type { ApplicationAnswerConfig } from "@shared/types/application";
import { describe, expect, it } from "vitest";
import {
  classifyApplicationQuestion,
  resolveApplicationAnswer,
} from "./application-answer-config";

const config: ApplicationAnswerConfig = {
  version: 1,
  enabled: true,
  applicant: {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+1 416 555 0100",
    city: "Toronto",
    province: "Ontario",
    country: "Canada",
    postalCode: "M5V 2T6",
    linkedinUrl: "https://www.linkedin.com/in/ada",
  },
  workAuthorization: {
    country: "Canada",
    authorizedToWork: true,
    permitType: "Open work permit",
    permitExpiryDate: "2029-03-23",
    requiresSponsorship: false,
  },
  answers: {
    workAuthorizationText: "I am legally authorized to work in Canada.",
    sponsorshipText: "I do not require employer sponsorship.",
    relocation: "depends",
  },
  demographics: {
    enabled: true,
    gender: "man",
    sexAtBirth: "male",
    genderIdentity: "man",
    sexualOrientation: "prefer_not_to_say",
    raceEthnicity: ["south_asian"],
    indigenousIdentity: "not_indigenous",
    disability: "no_disability",
    veteranStatus: "not_veteran",
    pronouns: "he/him",
    languages: ["English", "Mandarin"],
  },
  customAnswers: [
    { match: "available to start", value: "Two weeks after offer" },
  ],
};

describe("application answer config", () => {
  it("classifies work authorization and sponsorship questions", () => {
    expect(
      classifyApplicationQuestion({
        label: "Are you legally authorized to work in Canada?",
        type: "radio",
      }),
    ).toBe("work_authorization");
    expect(
      classifyApplicationQuestion({
        label: "Will you now or in the future require visa sponsorship?",
        type: "radio",
      }),
    ).toBe("sponsorship");
  });

  it("resolves applicant identity fields and custom answers", () => {
    expect(
      resolveApplicationAnswer({ label: "First name", type: "text" }, config),
    ).toEqual({ kind: "first_name", value: "Ada", source: "config" });
    expect(
      resolveApplicationAnswer(
        { label: "When are you available to start?", type: "text" },
        config,
      ),
    ).toEqual({
      kind: "unknown",
      value: "Two weeks after offer",
      source: "config",
    });
  });

  it("recognizes common Canadian French authorization questions", () => {
    expect(
      classifyApplicationQuestion({
        label: "Êtes-vous autorisé à travailler au Canada?",
        type: "radio",
      }),
    ).toBe("work_authorization");
  });

  it("resolves configured boolean answers to the form's option labels", () => {
    expect(
      resolveApplicationAnswer(
        {
          label: "Are you authorized to work in Canada?",
          type: "radio",
          options: ["Yes", "No"],
        },
        config,
      ),
    ).toEqual({
      kind: "work_authorization",
      value: "Yes",
      source: "config",
    });

    expect(
      resolveApplicationAnswer(
        {
          label: "Do you require employer sponsorship?",
          type: "radio",
          options: ["Yes", "No"],
        },
        config,
      ),
    ).toEqual({
      kind: "sponsorship",
      value: "No",
      source: "config",
    });
  });

  it("does not answer an unconfigured question", () => {
    expect(
      resolveApplicationAnswer(
        { label: "What is your preferred start date?", type: "text" },
        config,
      ),
    ).toEqual({ kind: "unknown", reason: "unknown_question" });
  });

  it("does not guess when configured text does not match the form options", () => {
    expect(
      resolveApplicationAnswer(
        {
          label: "What type of work permit do you hold?",
          type: "select",
          options: ["Citizen", "Permanent resident"],
        },
        config,
      ),
    ).toEqual({ kind: "permit_type", reason: "unsupported_options" });
  });

  it("does not confuse a non-applicable option with a configured no answer", () => {
    expect(
      resolveApplicationAnswer(
        {
          label: "Do you require employer sponsorship?",
          type: "radio",
          options: ["Not applicable", "Yes", "No"],
        },
        config,
      ),
    ).toEqual({
      kind: "sponsorship",
      value: "No",
      source: "config",
    });
  });

  it("resolves sensitive demographic answers only when demographics are enabled", () => {
    expect(
      resolveApplicationAnswer(
        {
          label: "What is your gender?",
          type: "select",
          options: ["Female", "Male", "Non-binary", "Prefer not to say"],
        },
        config,
      ),
    ).toEqual({ kind: "gender", value: "Male", source: "config" });

    expect(
      resolveApplicationAnswer(
        {
          label: "What is your sexual orientation?",
          type: "select",
          options: ["Straight", "Bisexual", "Prefer not to say"],
        },
        config,
      ),
    ).toEqual({
      kind: "sexual_orientation",
      value: "Prefer not to say",
      source: "config",
    });

    expect(
      resolveApplicationAnswer(
        {
          label: "Which race or ethnicity best describes you?",
          type: "select",
          options: ["South Asian", "East Asian", "Prefer not to say"],
        },
        config,
      ),
    ).toEqual({
      kind: "race_ethnicity",
      value: ["South Asian"],
      source: "config",
    });
  });

  it("keeps demographic questions blocked when the section is disabled", () => {
    expect(
      resolveApplicationAnswer(
        { label: "What is your gender?", type: "select", options: ["Male"] },
        { ...config, demographics: { ...config.demographics, enabled: false } },
      ),
    ).toEqual({ kind: "gender", reason: "missing_config" });
  });
});
