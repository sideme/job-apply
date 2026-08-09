import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import type {
  ApplicationAnswerConfig,
  ApplicationQuestion,
  ApplicationQuestionKind,
  ResolvedApplicationAnswer,
  UnresolvedApplicationQuestion,
} from "@shared/types/application";
import { applicationAnswerConfigSchema } from "@shared/types/application";

const DEFAULT_CONFIG_FILE = "application-answers.json";

function disabledConfig(): ApplicationAnswerConfig {
  return {
    version: 1,
    enabled: false,
    workAuthorization: {
      country: "Not configured",
      authorizedToWork: false,
      requiresSponsorship: false,
    },
    answers: {},
  };
}

function getConfigPath(): string {
  const configuredPath = (process.env.APPLICATION_ANSWERS_FILE || "").trim();
  if (configuredPath) return resolve(configuredPath);
  return join(getDataDir(), DEFAULT_CONFIG_FILE);
}

export function getApplicationAnswerConfigPath(): string {
  return getConfigPath();
}

export function loadApplicationAnswerConfig(): ApplicationAnswerConfig {
  const path = getConfigPath();

  if (!existsSync(path)) {
    return disabledConfig();
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = applicationAnswerConfigSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("Application answer config is invalid", {
        path,
        issueCount: parsed.error.issues.length,
      });
      return disabledConfig();
    }
    return parsed.data;
  } catch (error) {
    logger.warn("Failed to load application answer config", { path, error });
    return disabledConfig();
  }
}

function normalize(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function questionText(question: ApplicationQuestion): string {
  return normalize([question.label, question.name].filter(Boolean).join(" "));
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isNegativeChoice(text: string): boolean {
  return (
    text === "no" ||
    text.startsWith("no ") ||
    text.startsWith("not ") ||
    text.startsWith("without ") ||
    text.includes("prefer not") ||
    text.includes("decline") ||
    text.includes("do not wish") ||
    text.includes("do not want")
  );
}

const DEMOGRAPHIC_ALIASES: Record<string, string[]> = {
  man: ["man", "male", "cis man", "cisgender man"],
  woman: ["woman", "female", "cis woman", "cisgender woman"],
  non_binary: ["non binary", "nonbinary", "gender nonconforming"],
  trans_man: ["trans man", "transgender man"],
  trans_woman: ["trans woman", "transgender woman"],
  genderqueer: ["genderqueer", "gender queer"],
  agender: ["agender"],
  heterosexual_or_straight: ["heterosexual", "straight"],
  gay_or_lesbian: ["gay", "lesbian", "gay or lesbian"],
  bisexual: ["bisexual"],
  pansexual: ["pansexual"],
  asexual: ["asexual"],
  queer: ["queer"],
  two_spirit: ["two spirit", "two spirited"],
  questioning: ["questioning"],
  indigenous: ["indigenous", "aboriginal", "first nations", "inuit", "metis"],
  not_indigenous: ["not indigenous", "not aboriginal"],
  disability: ["yes", "person with a disability", "disability"],
  no_disability: ["no", "without a disability", "no disability"],
  veteran: ["yes", "veteran"],
  not_veteran: ["no", "not a veteran", "non veteran"],
  prefer_not_to_say: [
    "prefer not",
    "decline",
    "do not wish",
    "do not want",
    "not disclose",
    "not answer",
  ],
  decline_to_answer: [
    "prefer not",
    "decline",
    "do not wish",
    "do not want",
    "not disclose",
    "not answer",
  ],
};

export function classifyApplicationQuestion(
  question: ApplicationQuestion,
): ApplicationQuestionKind {
  const text = questionText(question);
  if (!text) return "unknown";

  if (hasAny(text, ["first name", "given name", "prenom"])) {
    return "first_name";
  }
  if (hasAny(text, ["last name", "family name", "surname", "nom de famille"])) {
    return "last_name";
  }
  if (hasAny(text, ["full name", "legal name", "your name", "nom complet"])) {
    return "full_name";
  }
  if (
    question.type === "email" ||
    hasAny(text, ["email", "e mail", "courriel", "adresse electronique"])
  ) {
    return "email";
  }
  if (
    question.type === "tel" ||
    hasAny(text, ["phone", "telephone", "mobile", "cell number"])
  ) {
    return "phone";
  }
  if (hasAny(text, ["linkedin", "linked in"])) return "linkedin_url";
  if (
    hasAny(text, ["portfolio", "personal website", "website url", "site web"])
  ) {
    return "website_url";
  }
  if (hasAny(text, ["postal code", "zip code", "code postal"])) {
    return "postal_code";
  }
  if (hasAny(text, ["province", "state region", "state province"])) {
    return "province";
  }
  if (
    text.split(" ").some((word) => ["city", "town", "ville"].includes(word))
  ) {
    return "city";
  }
  if (hasAny(text, ["country", "pays"])) return "country";

  const mentionsSponsorship = hasAny(text, [
    "sponsor",
    "sponsorship",
    "visa sponsorship",
    "require sponsorship",
    "parrainage",
    "commandite de visa",
  ]);
  if (mentionsSponsorship) {
    return question.type === "text" || question.type === "textarea"
      ? "sponsorship_text"
      : "sponsorship";
  }

  if (
    hasAny(text, [
      "permit type",
      "visa type",
      "work permit type",
      "type of work permit",
      "type of visa",
    ])
  ) {
    return "permit_type";
  }

  if (
    hasAny(text, [
      "permit expiry",
      "permit expiration",
      "visa expiry",
      "visa expiration",
      "authorization expiry",
    ])
  ) {
    return "permit_expiry";
  }

  if (
    hasAny(text, [
      "legally authorized",
      "legally eligible",
      "authorized to work",
      "eligible to work",
      "right to work",
      "work authorization",
      "work permit",
      "visa status",
      "autorise a travailler",
      "autorisation de travail",
      "admissible a travailler",
      "droit de travailler",
    ])
  ) {
    return question.type === "text" || question.type === "textarea"
      ? "work_authorization_text"
      : "work_authorization";
  }

  if (hasAny(text, ["sex at birth", "assigned at birth", "birth sex"])) {
    return "sex_at_birth";
  }

  if (hasAny(text, ["gender identity", "current gender"])) {
    return "gender_identity";
  }

  if (
    hasAny(text, [
      "sexual orientation",
      "sexual identity",
      "lgbt",
      "lgbtq",
      "2slgbtqi",
      "two spirit",
    ])
  ) {
    return "sexual_orientation";
  }

  if (
    hasAny(text, [
      "indigenous",
      "aboriginal",
      "first nations",
      "inuit",
      "metis",
    ])
  ) {
    return "indigenous_identity";
  }

  if (
    hasAny(text, [
      "race",
      "ethnicity",
      "ethnic origin",
      "racialized",
      "racial group",
      "population group",
      "visible minority",
    ])
  ) {
    return "race_ethnicity";
  }

  if (
    hasAny(text, [
      "disability",
      "disabled",
      "accessibility",
      "person with a disability",
    ])
  ) {
    return "disability";
  }

  if (hasAny(text, ["veteran", "military service", "armed forces"])) {
    return "veteran_status";
  }

  if (hasAny(text, ["pronoun", "preferred pronoun"])) {
    return "pronouns";
  }

  if (hasAny(text, ["language", "languages spoken", "spoken language"])) {
    return "language";
  }

  if (hasAny(text, ["gender", "sex"])) {
    return "gender";
  }

  if (hasAny(text, ["salary expectation", "desired salary", "salary range"])) {
    return "salary_expectation";
  }

  if (hasAny(text, ["relocate", "relocation", "willing to move"])) {
    return "relocation";
  }

  return "unknown";
}

function valueForKind(
  kind: ApplicationQuestionKind,
  config: ApplicationAnswerConfig,
): string | boolean | string[] | undefined {
  const demographics = config.demographics;
  switch (kind) {
    case "first_name":
      return config.applicant?.firstName;
    case "last_name":
      return config.applicant?.lastName;
    case "full_name":
      return (
        config.applicant?.fullName ??
        [config.applicant?.firstName, config.applicant?.lastName]
          .filter(Boolean)
          .join(" ") ??
        undefined
      );
    case "email":
      return config.applicant?.email;
    case "phone":
      return config.applicant?.phone;
    case "city":
      return config.applicant?.city;
    case "province":
      return config.applicant?.province;
    case "country":
      return config.applicant?.country ?? config.workAuthorization.country;
    case "postal_code":
      return config.applicant?.postalCode;
    case "linkedin_url":
      return config.applicant?.linkedinUrl;
    case "website_url":
      return config.applicant?.websiteUrl;
    case "work_authorization":
      return config.workAuthorization.authorizedToWork;
    case "sponsorship":
      return config.workAuthorization.requiresSponsorship;
    case "permit_type":
      return config.workAuthorization.permitType;
    case "permit_expiry":
      return config.workAuthorization.permitExpiryDate;
    case "work_authorization_text":
      return config.answers.workAuthorizationText;
    case "sponsorship_text":
      return config.answers.sponsorshipText;
    case "salary_expectation":
      return config.answers.salaryExpectation;
    case "relocation":
      return config.answers.relocation;
    case "gender":
      return demographics?.gender;
    case "sex_at_birth":
      return demographics?.sexAtBirth;
    case "gender_identity":
      return demographics?.genderIdentity;
    case "sexual_orientation":
      return demographics?.sexualOrientation;
    case "race_ethnicity":
      return demographics?.raceEthnicity;
    case "indigenous_identity":
      return demographics?.indigenousIdentity;
    case "disability":
      return demographics?.disability;
    case "veteran_status":
      return demographics?.veteranStatus;
    case "pronouns":
      return demographics?.pronouns;
    case "language":
      return demographics?.languages;
    case "unknown":
      return undefined;
  }
}

function resolveChoice(
  value: string | boolean | string[],
  options: string[],
): string | boolean | string[] | undefined {
  if (Array.isArray(value)) {
    const resolved = value.map((item) => resolveChoice(item, options));
    if (
      resolved.some((item) => typeof item !== "string") ||
      resolved.length === 0
    ) {
      return undefined;
    }
    return resolved as string[];
  }

  if (typeof value !== "boolean") {
    const normalizedValue = normalize(value);
    const aliases = DEMOGRAPHIC_ALIASES[normalizedValue] ?? [normalizedValue];
    const allowsNegativeChoice =
      normalizedValue.includes("prefer not") ||
      normalizedValue.includes("decline") ||
      normalizedValue.startsWith("not ") ||
      normalizedValue.startsWith("no ");
    return options.find((option) => {
      const normalizedOption = normalize(option);
      if (!allowsNegativeChoice && isNegativeChoice(normalizedOption)) {
        return false;
      }
      return aliases.some(
        (alias) =>
          normalizedOption === alias ||
          normalizedOption.startsWith(`${alias} `) ||
          normalizedOption.endsWith(` ${alias}`) ||
          normalizedOption.includes(` ${alias} `),
      );
    });
  }

  const yesTerms = ["yes", "true", "i do", "authorized", "eligible"];
  const noTerms = [
    "false",
    "i don t",
    "do not",
    "not require",
    "not need",
    "unauthorized",
  ];
  return options.find((option) => {
    const normalized = normalize(option);
    const isNegative =
      normalized === "no" ||
      normalized.startsWith("no ") ||
      hasAny(normalized, noTerms);
    if (value && isNegative) return false;
    if (!value) return isNegative;
    return hasAny(normalized, yesTerms);
  });
}

export function resolveApplicationAnswer(
  question: ApplicationQuestion,
  config: ApplicationAnswerConfig = loadApplicationAnswerConfig(),
): ResolvedApplicationAnswer | UnresolvedApplicationQuestion {
  const kind = classifyApplicationQuestion(question);
  if (!config.enabled) return { kind, reason: "missing_config" };

  const normalizedQuestion = questionText(question);
  const customAnswer = config.customAnswers?.find((entry) =>
    normalizedQuestion.includes(normalize(entry.match)),
  );
  if (customAnswer) {
    const value =
      question.options && question.options.length > 0
        ? resolveChoice(customAnswer.value, question.options)
        : customAnswer.value;
    return value === undefined
      ? { kind, reason: "unsupported_options" }
      : { kind, value, source: "config" };
  }
  if (
    [
      "gender",
      "sex_at_birth",
      "gender_identity",
      "sexual_orientation",
      "race_ethnicity",
      "indigenous_identity",
      "disability",
      "veteran_status",
      "pronouns",
      "language",
    ].includes(kind) &&
    !config.demographics?.enabled
  ) {
    return { kind, reason: "missing_config" };
  }
  if (kind === "unknown") return { kind, reason: "unknown_question" };

  const value = valueForKind(kind, config);
  if (value === undefined) return { kind, reason: "missing_config" };

  if (question.options && question.options.length > 0) {
    const choice = resolveChoice(value, question.options);
    if (choice === undefined) {
      return { kind, reason: "unsupported_options" };
    }
    return { kind, value: choice, source: "config" };
  }

  return { kind, value, source: "config" };
}
