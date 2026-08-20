import type {
  ChatStyleLanguageMode,
  ChatStyleManualLanguage,
  CompanyModelRule,
} from "@shared/types.js";

export type EffectiveDefault<T> = {
  effective: T;
  default: T;
};

export type ModelValues = EffectiveDefault<string> & {
  scorer: string;
  tailoring: string;
  projectSelection: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKeyHint: string | null;
  embeddingProvider: string;
  embeddingBaseUrl: string;
  embeddingEnabled: EffectiveDefault<boolean>;
  embeddingMaxJobsPerRun: EffectiveDefault<number>;
  embeddingMaxInputChars: EffectiveDefault<number>;
  embeddingModel: EffectiveDefault<string>;
  embeddingApiKeyHint: string | null;
  companyModelRules: CompanyModelRule[];
};

export type WebhookValues = EffectiveDefault<string>;
export type WhatsAppValues = {
  enabled: EffectiveDefault<boolean>;
  phone: EffectiveDefault<string>;
  apiKeyHint: string | null;
};
export type ChatValues = {
  tone: EffectiveDefault<string>;
  formality: EffectiveDefault<string>;
  constraints: EffectiveDefault<string>;
  doNotUse: EffectiveDefault<string>;
  languageMode: EffectiveDefault<ChatStyleLanguageMode>;
  manualLanguage: EffectiveDefault<ChatStyleManualLanguage>;
};

export type EnvSettingsValues = {
  readable: {
    adzunaAppId: string;
    basicAuthUser: string;
  };
  private: {
    adzunaAppKeyHint: string | null;
    basicAuthPasswordHint: string | null;
    webhookSecretHint: string | null;
  };
  basicAuthActive: boolean;
};

export type BackupValues = {
  backupEnabled: EffectiveDefault<boolean>;
  backupHour: EffectiveDefault<number>;
  backupMaxCount: EffectiveDefault<number>;
};

export type ScoringValues = {
  penalizeMissingSalary: EffectiveDefault<boolean>;
  missingSalaryPenalty: EffectiveDefault<number>;
  autoSkipScoreThreshold: EffectiveDefault<number | null>;
  semanticScoreWeight: EffectiveDefault<number>;
  blockedCompanyKeywords: EffectiveDefault<string[]>;
  scoringInstructions: EffectiveDefault<string>;
};

export type AgentValues = {
  model: string;
  discoveryEnabled: EffectiveDefault<boolean>;
  fitJudgeEnabled: EffectiveDefault<boolean>;
  maxRunsPerLocalDay: EffectiveDefault<number>;
  maxSearchIterations: EffectiveDefault<number>;
  maxSearchesPerRun: EffectiveDefault<number>;
  maxLinkedinSearches: EffectiveDefault<number>;
  maxAdzunaSearches: EffectiveDefault<number>;
  stopWhenNewBelow: EffectiveDefault<number>;
  maxFitJudgments: EffectiveDefault<number>;
  fitPendingTtlDays: EffectiveDefault<number>;
  maxInputTokensPerRun: EffectiveDefault<number>;
  maxOutputTokensPerRun: EffectiveDefault<number>;
  maxJdChars: EffectiveDefault<number>;
  requestTimeoutMs: EffectiveDefault<number>;
};
