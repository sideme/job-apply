import { z } from "zod";

export const APPLICATION_ANSWER_CONFIG_VERSION = 1 as const;

const demographicValue = z.enum([
  "man",
  "woman",
  "non_binary",
  "trans_man",
  "trans_woman",
  "genderqueer",
  "agender",
  "self_describe",
  "heterosexual_or_straight",
  "gay_or_lesbian",
  "bisexual",
  "pansexual",
  "asexual",
  "queer",
  "two_spirit",
  "questioning",
  "indigenous",
  "not_indigenous",
  "disability",
  "no_disability",
  "veteran",
  "not_veteran",
  "prefer_not_to_say",
  "decline_to_answer",
]);

const demographicProfileSchema = z.object({
  enabled: z.boolean().default(false),
  gender: demographicValue.optional(),
  sexAtBirth: z
    .enum([
      "male",
      "female",
      "intersex",
      "prefer_not_to_say",
      "decline_to_answer",
    ])
    .optional(),
  genderIdentity: demographicValue.optional(),
  sexualOrientation: demographicValue.optional(),
  raceEthnicity: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  indigenousIdentity: z
    .enum([
      "indigenous",
      "not_indigenous",
      "prefer_not_to_say",
      "decline_to_answer",
    ])
    .optional(),
  disability: z
    .enum([
      "disability",
      "no_disability",
      "prefer_not_to_say",
      "decline_to_answer",
    ])
    .optional(),
  veteranStatus: z
    .enum(["veteran", "not_veteran", "prefer_not_to_say", "decline_to_answer"])
    .optional(),
  pronouns: z.string().trim().max(100).optional(),
  languages: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
});

export const applicationAnswerConfigSchema = z.object({
  version: z.literal(APPLICATION_ANSWER_CONFIG_VERSION),
  enabled: z.boolean().default(false),
  applicant: z
    .object({
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().trim().min(1).max(100).optional(),
      fullName: z.string().trim().min(1).max(200).optional(),
      email: z.string().trim().email().max(320).optional(),
      phone: z.string().trim().min(5).max(50).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      province: z.string().trim().min(1).max(100).optional(),
      country: z.string().trim().min(1).max(100).optional(),
      postalCode: z.string().trim().min(1).max(30).optional(),
      linkedinUrl: z.string().trim().url().max(500).optional(),
      websiteUrl: z.string().trim().url().max(500).optional(),
    })
    .optional(),
  workAuthorization: z.object({
    country: z.string().trim().min(1).max(100),
    authorizedToWork: z.boolean(),
    permitType: z.string().trim().min(1).max(200).optional(),
    permitExpiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD")
      .optional(),
    requiresSponsorship: z.boolean(),
  }),
  answers: z
    .object({
      workAuthorizationText: z.string().trim().max(1000).optional(),
      sponsorshipText: z.string().trim().max(1000).optional(),
      salaryExpectation: z.string().trim().max(300).optional(),
      relocation: z.enum(["yes", "no", "depends"]).optional(),
    })
    .default({}),
  demographics: demographicProfileSchema.optional(),
  customAnswers: z
    .array(
      z.object({
        match: z.string().trim().min(2).max(300),
        value: z.union([
          z.string().max(4000),
          z.boolean(),
          z.array(z.string().trim().min(1).max(300)).max(20),
        ]),
      }),
    )
    .max(100)
    .optional(),
});

export type ApplicationAnswerConfig = z.infer<
  typeof applicationAnswerConfigSchema
>;

export type ApplicationQuestionKind =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "city"
  | "province"
  | "country"
  | "postal_code"
  | "linkedin_url"
  | "website_url"
  | "work_authorization"
  | "sponsorship"
  | "permit_type"
  | "permit_expiry"
  | "work_authorization_text"
  | "sponsorship_text"
  | "salary_expectation"
  | "relocation"
  | "gender"
  | "sex_at_birth"
  | "gender_identity"
  | "sexual_orientation"
  | "race_ethnicity"
  | "indigenous_identity"
  | "disability"
  | "veteran_status"
  | "pronouns"
  | "language"
  | "unknown";

export interface ApplicationQuestion {
  label: string;
  name?: string | null;
  type?: string | null;
  options?: string[];
}

export const applicationQuestionSchema = z.object({
  label: z.string().trim().min(1).max(500),
  name: z.string().trim().max(300).nullable().optional(),
  type: z.string().trim().max(100).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
});

export interface ResolvedApplicationAnswer {
  kind: ApplicationQuestionKind;
  value: string | boolean | string[];
  source: "config";
}

export interface UnresolvedApplicationQuestion {
  kind: ApplicationQuestionKind;
  reason:
    | "missing_config"
    | "ambiguous_question"
    | "unsupported_options"
    | "unknown_question";
}

export interface ApplicationFillPlanAnswer {
  index: number;
  answer: ResolvedApplicationAnswer;
}

export interface ApplicationFillPlanUnresolved {
  index: number;
  question: Pick<ApplicationQuestion, "label" | "name">;
  unresolved: UnresolvedApplicationQuestion;
}

export interface ApplicationFillPlan {
  jobId: string;
  answers: ApplicationFillPlanAnswer[];
  unresolved: ApplicationFillPlanUnresolved[];
  requiresReview: boolean;
  submission: {
    allowed: boolean;
    requiresConfirmation: true;
    reason: "unresolved_questions" | null;
  };
}
