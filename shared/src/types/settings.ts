export interface ResumeProjectCatalogItem {
  id: string;
  name: string;
  description: string;
  date: string;
  isVisibleInBase: boolean;
}

export interface ResumeProjectsSettings {
  maxProjects: number;
  lockedProjectIds: string[];
  aiSelectableProjectIds: string[];
}

export const CHAT_STYLE_LANGUAGE_MODE_VALUES = [
  "manual",
  "match-resume",
] as const;

export type ChatStyleLanguageMode =
  (typeof CHAT_STYLE_LANGUAGE_MODE_VALUES)[number];

export const CHAT_STYLE_MANUAL_LANGUAGE_VALUES = [
  "english",
  "german",
  "french",
  "spanish",
] as const;

export type ChatStyleManualLanguage =
  (typeof CHAT_STYLE_MANUAL_LANGUAGE_VALUES)[number];

export const CHAT_STYLE_MANUAL_LANGUAGE_LABELS: Record<
  ChatStyleManualLanguage,
  string
> = {
  english: "English",
  german: "German",
  french: "French",
  spanish: "Spanish",
};

export interface ResumeProfile {
  /**
   * Plain text extracted from the local resume PDF, when that is the profile
   * source. Fed into the scoring and tailoring prompts so the LLM sees the
   * candidate's actual resume content.
   */
  rawText?: string;
  basics?: {
    name?: string;
    label?: string;
    image?: string;
    email?: string;
    phone?: string;
    url?: string;
    summary?: string;
    headline?: string;
    location?: {
      address?: string;
      postalCode?: string;
      city?: string;
      countryCode?: string;
      region?: string;
    };
    profiles?: Array<{
      network?: string;
      username?: string;
      url?: string;
    }>;
  };
  sections?: {
    summary?: {
      id?: string;
      visible?: boolean;
      name?: string;
      content?: string;
    };
    skills?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        name: string;
        description: string;
        level: number;
        keywords: string[];
        visible: boolean;
      }>;
    };
    projects?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        name: string;
        description: string;
        date: string;
        summary: string;
        visible: boolean;
        keywords?: string[];
        url?: string;
      }>;
    };
    experience?: {
      id?: string;
      visible?: boolean;
      name?: string;
      items?: Array<{
        id: string;
        company: string;
        position: string;
        location: string;
        date: string;
        summary: string;
        visible: boolean;
      }>;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ProfileStatusResponse {
  exists: boolean;
  error: string | null;
}

export interface ValidationResult {
  valid: boolean;
  message: string | null;
}

export interface DemoInfoResponse {
  demoMode: boolean;
  resetCadenceHours: number;
  lastResetAt: string | null;
  nextResetAt: string | null;
  baselineVersion: string | null;
  baselineName: string | null;
}

export type Resolved<T> = { value: T; default: T; override: T | null };
export type ModelResolved = { value: string; override: string | null };

export interface AppSettings {
  // Typed settings (Resolved):
  model: Resolved<string>;
  llmProvider: Resolved<string>;
  llmBaseUrl: Resolved<string>;
  agenticDiscoveryEnabled: Resolved<boolean>;
  agenticFitJudgeEnabled: Resolved<boolean>;
  agentMaxRunsPerLocalDay: Resolved<number>;
  agentMaxSearchIterations: Resolved<number>;
  agentMaxSearchesPerRun: Resolved<number>;
  agentMaxLinkedinSearches: Resolved<number>;
  agentMaxAdzunaSearches: Resolved<number>;
  agentStopWhenNewBelow: Resolved<number>;
  agentMaxFitJudgments: Resolved<number>;
  agentFitPendingTtlDays: Resolved<number>;
  agentMaxInputTokensPerRun: Resolved<number>;
  agentMaxOutputTokensPerRun: Resolved<number>;
  agentMaxJdChars: Resolved<number>;
  agentRequestTimeoutMs: Resolved<number>;
  pipelineWebhookUrl: Resolved<string>;
  jobCompleteWebhookUrl: Resolved<string>;
  whatsappEnabled: Resolved<boolean>;
  whatsappPhone: Resolved<string>;
  resumeProjects: Resolved<ResumeProjectsSettings>;
  adzunaMaxJobsPerTerm: Resolved<number>;
  searchTerms: Resolved<string[]>;
  blockedCompanyKeywords: Resolved<string[]>;
  scoringInstructions: Resolved<string>;
  searchCities: Resolved<string>;
  jobspyResultsWanted: Resolved<number>;
  jobspyCountryIndeed: Resolved<string>;
  chatStyleTone: Resolved<string>;
  chatStyleFormality: Resolved<string>;
  chatStyleConstraints: Resolved<string>;
  chatStyleDoNotUse: Resolved<string>;
  chatStyleLanguageMode: Resolved<ChatStyleLanguageMode>;
  chatStyleManualLanguage: Resolved<ChatStyleManualLanguage>;
  backupEnabled: Resolved<boolean>;
  backupHour: Resolved<number>;
  backupMaxCount: Resolved<number>;
  penalizeMissingSalary: Resolved<boolean>;
  missingSalaryPenalty: Resolved<number>;
  autoSkipScoreThreshold: Resolved<number | null>;
  semanticScoreWeight: Resolved<number>;
  embeddingEnabled: Resolved<boolean>;
  embeddingMaxJobsPerRun: Resolved<number>;
  embeddingMaxInputChars: Resolved<number>;
  embeddingModel: Resolved<string>;
  companyModelRules: Resolved<CompanyModelRule[]>;

  // Model variants (no own default, fallback to model.value):
  modelScorer: ModelResolved;
  agentModel: ModelResolved;
  modelTailoring: ModelResolved;
  modelProjectSelection: ModelResolved;

  // Simple strings:
  adzunaAppId: string | null;
  basicAuthUser: string | null;
  embeddingProvider: string | null;
  embeddingBaseUrl: string | null;

  // Secret hints:
  llmApiKeyHint: string | null;
  embeddingApiKeyHint: string | null;
  adzunaAppKeyHint: string | null;
  basicAuthPasswordHint: string | null;
  webhookSecretHint: string | null;
  whatsappApiKeyHint: string | null;

  // Computed:
  basicAuthActive: boolean;
  profileProjects: ResumeProjectCatalogItem[];
}

import type { CompanyModelRule } from "../company-model-rules";
