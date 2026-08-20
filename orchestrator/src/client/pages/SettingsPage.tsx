import * as api from "@client/api";
import { PageHeader } from "@client/components/layout";
import { useUpdateSettingsMutation } from "@client/hooks/queries/useSettingsMutation";
import { AgentRunsSection } from "@client/pages/settings/components/AgentRunsSection";
import { AgentSettingsSection } from "@client/pages/settings/components/AgentSettingsSection";
import { BackupSettingsSection } from "@client/pages/settings/components/BackupSettingsSection";
import { ChatSettingsSection } from "@client/pages/settings/components/ChatSettingsSection";
import { DangerZoneSection } from "@client/pages/settings/components/DangerZoneSection";
import { EnvironmentSettingsSection } from "@client/pages/settings/components/EnvironmentSettingsSection";
import { LocalResumeSection } from "@client/pages/settings/components/LocalResumeSection";
import { ModelSettingsSection } from "@client/pages/settings/components/ModelSettingsSection";
import { ScoringSettingsSection } from "@client/pages/settings/components/ScoringSettingsSection";
import { WebhooksSection } from "@client/pages/settings/components/WebhooksSection";
import {
  type LlmProviderId,
  normalizeLlmProvider,
  resumeProjectsEqual,
} from "@client/pages/settings/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { normalizeStringArray } from "@shared/normalize-string-array.js";
import {
  type UpdateSettingsInput,
  updateSettingsSchema,
} from "@shared/settings-schema.js";
import type { AppSettings, JobStatus } from "@shared/types.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { FormProvider, type Resolver, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

const DEFAULT_FORM_VALUES: UpdateSettingsInput = {
  model: "",
  modelScorer: "",
  modelTailoring: "",
  modelProjectSelection: "",
  agentModel: "",
  agenticDiscoveryEnabled: null,
  agenticFitJudgeEnabled: null,
  agentMaxRunsPerLocalDay: null,
  agentMaxSearchIterations: null,
  agentMaxSearchesPerRun: null,
  agentMaxLinkedinSearches: null,
  agentMaxAdzunaSearches: null,
  agentStopWhenNewBelow: null,
  agentMaxFitJudgments: null,
  agentFitPendingTtlDays: null,
  agentMaxInputTokensPerRun: null,
  agentMaxOutputTokensPerRun: null,
  agentMaxJdChars: null,
  agentRequestTimeoutMs: null,
  companyModelRules: [],
  llmProvider: null,
  llmBaseUrl: "",
  llmApiKey: "",
  embeddingProvider: "",
  embeddingBaseUrl: "",
  embeddingEnabled: null,
  embeddingMaxJobsPerRun: null,
  embeddingMaxInputChars: null,
  embeddingModel: "",
  embeddingApiKey: "",
  pipelineWebhookUrl: "",
  jobCompleteWebhookUrl: "",
  whatsappEnabled: null,
  whatsappPhone: "",
  whatsappApiKey: "",
  resumeProjects: null,
  chatStyleTone: "",
  chatStyleFormality: "",
  chatStyleConstraints: "",
  chatStyleDoNotUse: "",
  chatStyleLanguageMode: null,
  chatStyleManualLanguage: null,
  basicAuthUser: "",
  basicAuthPassword: "",
  adzunaAppId: "",
  adzunaAppKey: "",
  webhookSecret: "",
  enableBasicAuth: false,
  backupEnabled: null,
  backupHour: null,
  backupMaxCount: null,
  penalizeMissingSalary: null,
  missingSalaryPenalty: null,
  autoSkipScoreThreshold: null,
  semanticScoreWeight: null,
  blockedCompanyKeywords: [],
  scoringInstructions: "",
};

type LlmProviderValue = LlmProviderId | null;

const normalizeLlmProviderValue = (
  value: string | null | undefined,
): LlmProviderValue => (value ? normalizeLlmProvider(value) : null);

const NULL_SETTINGS_PAYLOAD: UpdateSettingsInput = {
  model: null,
  modelScorer: null,
  modelTailoring: null,
  modelProjectSelection: null,
  agentModel: null,
  agenticDiscoveryEnabled: null,
  agenticFitJudgeEnabled: null,
  agentMaxRunsPerLocalDay: null,
  agentMaxSearchIterations: null,
  agentMaxSearchesPerRun: null,
  agentMaxLinkedinSearches: null,
  agentMaxAdzunaSearches: null,
  agentStopWhenNewBelow: null,
  agentMaxFitJudgments: null,
  agentFitPendingTtlDays: null,
  agentMaxInputTokensPerRun: null,
  agentMaxOutputTokensPerRun: null,
  agentMaxJdChars: null,
  agentRequestTimeoutMs: null,
  companyModelRules: null,
  llmProvider: null,
  llmBaseUrl: null,
  llmApiKey: null,
  embeddingProvider: null,
  embeddingBaseUrl: null,
  embeddingEnabled: null,
  embeddingMaxJobsPerRun: null,
  embeddingMaxInputChars: null,
  embeddingModel: null,
  embeddingApiKey: null,
  pipelineWebhookUrl: null,
  jobCompleteWebhookUrl: null,
  whatsappEnabled: null,
  whatsappPhone: null,
  whatsappApiKey: null,
  resumeProjects: null,
  chatStyleTone: null,
  chatStyleFormality: null,
  chatStyleConstraints: null,
  chatStyleDoNotUse: null,
  chatStyleLanguageMode: null,
  chatStyleManualLanguage: null,
  basicAuthUser: null,
  basicAuthPassword: null,
  adzunaAppId: null,
  adzunaAppKey: null,
  adzunaMaxJobsPerTerm: null,
  webhookSecret: null,
  enableBasicAuth: undefined,
  backupEnabled: null,
  backupHour: null,
  backupMaxCount: null,
  penalizeMissingSalary: null,
  missingSalaryPenalty: null,
  autoSkipScoreThreshold: null,
  semanticScoreWeight: null,
  blockedCompanyKeywords: null,
  scoringInstructions: null,
};

const mapSettingsToForm = (data: AppSettings): UpdateSettingsInput => ({
  model: data.model.override ?? "",
  modelScorer: data.modelScorer.override ?? "",
  modelTailoring: data.modelTailoring.override ?? "",
  modelProjectSelection: data.modelProjectSelection.override ?? "",
  agentModel: data.agentModel.override ?? "",
  agenticDiscoveryEnabled: data.agenticDiscoveryEnabled.override,
  agenticFitJudgeEnabled: data.agenticFitJudgeEnabled.override,
  agentMaxRunsPerLocalDay: data.agentMaxRunsPerLocalDay.override,
  agentMaxSearchIterations: data.agentMaxSearchIterations.override,
  agentMaxSearchesPerRun: data.agentMaxSearchesPerRun.override,
  agentMaxLinkedinSearches: data.agentMaxLinkedinSearches.override,
  agentMaxAdzunaSearches: data.agentMaxAdzunaSearches.override,
  agentStopWhenNewBelow: data.agentStopWhenNewBelow.override,
  agentMaxFitJudgments: data.agentMaxFitJudgments.override,
  agentFitPendingTtlDays: data.agentFitPendingTtlDays.override,
  agentMaxInputTokensPerRun: data.agentMaxInputTokensPerRun.override,
  agentMaxOutputTokensPerRun: data.agentMaxOutputTokensPerRun.override,
  agentMaxJdChars: data.agentMaxJdChars.override,
  agentRequestTimeoutMs: data.agentRequestTimeoutMs.override,
  companyModelRules: data.companyModelRules.override ?? [],
  llmProvider: normalizeLlmProviderValue(data.llmProvider.override),
  llmBaseUrl: data.llmBaseUrl.override ?? "",
  llmApiKey: "",
  embeddingProvider: data.embeddingProvider ?? "",
  embeddingBaseUrl: data.embeddingBaseUrl ?? "",
  embeddingEnabled: data.embeddingEnabled.override,
  embeddingMaxJobsPerRun: data.embeddingMaxJobsPerRun.override,
  embeddingMaxInputChars: data.embeddingMaxInputChars.override,
  embeddingModel: data.embeddingModel.override ?? "",
  embeddingApiKey: "",
  pipelineWebhookUrl: data.pipelineWebhookUrl.override ?? "",
  jobCompleteWebhookUrl: data.jobCompleteWebhookUrl.override ?? "",
  whatsappEnabled: data.whatsappEnabled.override,
  whatsappPhone: data.whatsappPhone.override ?? "",
  whatsappApiKey: "",
  resumeProjects: data.resumeProjects.override,
  chatStyleTone: data.chatStyleTone.override ?? "",
  chatStyleFormality: data.chatStyleFormality.override ?? "",
  chatStyleConstraints: data.chatStyleConstraints.override ?? "",
  chatStyleDoNotUse: data.chatStyleDoNotUse.override ?? "",
  chatStyleLanguageMode: data.chatStyleLanguageMode.override ?? null,
  chatStyleManualLanguage: data.chatStyleManualLanguage.override ?? null,
  basicAuthUser: data.basicAuthUser ?? "",
  basicAuthPassword: "",
  adzunaAppId: data.adzunaAppId ?? "",
  adzunaAppKey: "",
  webhookSecret: "",
  enableBasicAuth: data.basicAuthActive,
  backupEnabled: data.backupEnabled.override,
  backupHour: data.backupHour.override,
  backupMaxCount: data.backupMaxCount.override,
  penalizeMissingSalary: data.penalizeMissingSalary.override,
  missingSalaryPenalty: data.missingSalaryPenalty.override,
  autoSkipScoreThreshold: data.autoSkipScoreThreshold.override,
  semanticScoreWeight: data.semanticScoreWeight.override,
  blockedCompanyKeywords: data.blockedCompanyKeywords.override ?? [],
  scoringInstructions: data.scoringInstructions.override ?? "",
});

const normalizeString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizePrivateInput = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (trimmed === "") return null;
  return trimmed || undefined;
};

const stringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const nullIfSame = <T,>(value: T | null | undefined, defaultValue: T) =>
  value === defaultValue ? null : (value ?? null);

const getDerivedSettings = (settings: AppSettings | null) => {
  return {
    model: {
      effective: settings?.model?.value ?? "",
      default: settings?.model?.default ?? "",
      scorer: settings?.modelScorer?.value ?? "",
      tailoring: settings?.modelTailoring?.value ?? "",
      projectSelection: settings?.modelProjectSelection?.value ?? "",
      companyModelRules: settings?.companyModelRules?.value ?? [],
      llmProvider: settings?.llmProvider?.value ?? "",
      llmBaseUrl: settings?.llmBaseUrl?.value ?? "",
      llmApiKeyHint: settings?.llmApiKeyHint ?? null,
      embeddingProvider: settings?.embeddingProvider ?? "",
      embeddingBaseUrl: settings?.embeddingBaseUrl ?? "",
      embeddingEnabled: {
        effective: settings?.embeddingEnabled?.value ?? false,
        default: settings?.embeddingEnabled?.default ?? false,
      },
      embeddingMaxJobsPerRun: {
        effective: settings?.embeddingMaxJobsPerRun?.value ?? 20,
        default: settings?.embeddingMaxJobsPerRun?.default ?? 20,
      },
      embeddingMaxInputChars: {
        effective: settings?.embeddingMaxInputChars?.value ?? 6000,
        default: settings?.embeddingMaxInputChars?.default ?? 6000,
      },
      embeddingModel: {
        effective: settings?.embeddingModel?.value ?? "text-embedding-3-small",
        default: settings?.embeddingModel?.default ?? "text-embedding-3-small",
      },
      embeddingApiKeyHint: settings?.embeddingApiKeyHint ?? null,
    },
    pipelineWebhook: {
      effective: settings?.pipelineWebhookUrl?.value ?? "",
      default: settings?.pipelineWebhookUrl?.default ?? "",
    },
    jobCompleteWebhook: {
      effective: settings?.jobCompleteWebhookUrl?.value ?? "",
      default: settings?.jobCompleteWebhookUrl?.default ?? "",
    },
    whatsapp: {
      enabled: {
        effective: settings?.whatsappEnabled?.value ?? false,
        default: settings?.whatsappEnabled?.default ?? false,
      },
      phone: {
        effective: settings?.whatsappPhone?.value ?? "",
        default: settings?.whatsappPhone?.default ?? "",
      },
      apiKeyHint: settings?.whatsappApiKeyHint ?? null,
    },
    chat: {
      tone: {
        effective: settings?.chatStyleTone?.value ?? "professional",
        default: settings?.chatStyleTone?.default ?? "professional",
      },
      formality: {
        effective: settings?.chatStyleFormality?.value ?? "medium",
        default: settings?.chatStyleFormality?.default ?? "medium",
      },
      constraints: {
        effective: settings?.chatStyleConstraints?.value ?? "",
        default: settings?.chatStyleConstraints?.default ?? "",
      },
      doNotUse: {
        effective: settings?.chatStyleDoNotUse?.value ?? "",
        default: settings?.chatStyleDoNotUse?.default ?? "",
      },
      languageMode: {
        effective: settings?.chatStyleLanguageMode?.value ?? "manual",
        default: settings?.chatStyleLanguageMode?.default ?? "manual",
      },
      manualLanguage: {
        effective: settings?.chatStyleManualLanguage?.value ?? "english",
        default: settings?.chatStyleManualLanguage?.default ?? "english",
      },
    },
    envSettings: {
      readable: {
        adzunaAppId: settings?.adzunaAppId ?? "",
        basicAuthUser: settings?.basicAuthUser ?? "",
      },
      private: {
        adzunaAppKeyHint: settings?.adzunaAppKeyHint ?? null,
        basicAuthPasswordHint: settings?.basicAuthPasswordHint ?? null,
        webhookSecretHint: settings?.webhookSecretHint ?? null,
      },
      basicAuthActive: settings?.basicAuthActive ?? false,
    },
    defaultResumeProjects: settings?.resumeProjects?.default ?? null,

    agent: {
      model: settings?.agentModel?.value ?? "",
      discoveryEnabled: {
        effective: settings?.agenticDiscoveryEnabled?.value ?? false,
        default: settings?.agenticDiscoveryEnabled?.default ?? false,
      },
      fitJudgeEnabled: {
        effective: settings?.agenticFitJudgeEnabled?.value ?? false,
        default: settings?.agenticFitJudgeEnabled?.default ?? false,
      },
      maxRunsPerLocalDay: {
        effective: settings?.agentMaxRunsPerLocalDay?.value ?? 1,
        default: settings?.agentMaxRunsPerLocalDay?.default ?? 1,
      },
      maxSearchIterations: {
        effective: settings?.agentMaxSearchIterations?.value ?? 6,
        default: settings?.agentMaxSearchIterations?.default ?? 6,
      },
      maxSearchesPerRun: {
        effective: settings?.agentMaxSearchesPerRun?.value ?? 10,
        default: settings?.agentMaxSearchesPerRun?.default ?? 10,
      },
      maxLinkedinSearches: {
        effective: settings?.agentMaxLinkedinSearches?.value ?? 2,
        default: settings?.agentMaxLinkedinSearches?.default ?? 2,
      },
      maxAdzunaSearches: {
        effective: settings?.agentMaxAdzunaSearches?.value ?? 3,
        default: settings?.agentMaxAdzunaSearches?.default ?? 3,
      },
      stopWhenNewBelow: {
        effective: settings?.agentStopWhenNewBelow?.value ?? 3,
        default: settings?.agentStopWhenNewBelow?.default ?? 3,
      },
      maxFitJudgments: {
        effective: settings?.agentMaxFitJudgments?.value ?? 20,
        default: settings?.agentMaxFitJudgments?.default ?? 20,
      },
      fitPendingTtlDays: {
        effective: settings?.agentFitPendingTtlDays?.value ?? 7,
        default: settings?.agentFitPendingTtlDays?.default ?? 7,
      },
      maxInputTokensPerRun: {
        effective: settings?.agentMaxInputTokensPerRun?.value ?? 100000,
        default: settings?.agentMaxInputTokensPerRun?.default ?? 100000,
      },
      maxOutputTokensPerRun: {
        effective: settings?.agentMaxOutputTokensPerRun?.value ?? 12000,
        default: settings?.agentMaxOutputTokensPerRun?.default ?? 12000,
      },
      maxJdChars: {
        effective: settings?.agentMaxJdChars?.value ?? 12000,
        default: settings?.agentMaxJdChars?.default ?? 12000,
      },
      requestTimeoutMs: {
        effective: settings?.agentRequestTimeoutMs?.value ?? 60000,
        default: settings?.agentRequestTimeoutMs?.default ?? 60000,
      },
    },

    backup: {
      backupEnabled: {
        effective: settings?.backupEnabled?.value ?? false,
        default: settings?.backupEnabled?.default ?? false,
      },
      backupHour: {
        effective: settings?.backupHour?.value ?? 2,
        default: settings?.backupHour?.default ?? 2,
      },
      backupMaxCount: {
        effective: settings?.backupMaxCount?.value ?? 5,
        default: settings?.backupMaxCount?.default ?? 5,
      },
    },
    scoring: {
      penalizeMissingSalary: {
        effective: settings?.penalizeMissingSalary?.value ?? false,
        default: settings?.penalizeMissingSalary?.default ?? false,
      },
      missingSalaryPenalty: {
        effective: settings?.missingSalaryPenalty?.value ?? 10,
        default: settings?.missingSalaryPenalty?.default ?? 10,
      },
      autoSkipScoreThreshold: {
        effective: settings?.autoSkipScoreThreshold?.value ?? null,
        default: settings?.autoSkipScoreThreshold?.default ?? null,
      },
      semanticScoreWeight: {
        effective: settings?.semanticScoreWeight?.value ?? 0.7,
        default: settings?.semanticScoreWeight?.default ?? 0.7,
      },
      blockedCompanyKeywords: {
        effective: settings?.blockedCompanyKeywords?.value ?? [],
        default: settings?.blockedCompanyKeywords?.default ?? [],
      },
      scoringInstructions: {
        effective: settings?.scoringInstructions?.value ?? "",
        default: settings?.scoringInstructions?.default ?? "",
      },
    },
  };
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusesToClear, setStatusesToClear] = useState<JobStatus[]>([
    "discovered",
  ]);

  // Backup state
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isDeletingBackup, setIsDeletingBackup] = useState(false);

  const methods = useForm<UpdateSettingsInput>({
    resolver: zodResolver(
      updateSettingsSchema,
    ) as Resolver<UpdateSettingsInput>,
    mode: "onChange",
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const {
    handleSubmit,
    reset,
    setError,
    formState: { isDirty, errors, isValid, dirtyFields },
  } = methods;
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.current(),
    queryFn: api.getSettings,
  });
  const backupsQuery = useQuery({
    queryKey: queryKeys.backups.list(),
    queryFn: api.getBackups,
  });
  const updateSettingsMutation = useUpdateSettingsMutation();
  const isLoading = settingsQuery.isLoading;
  const backups = backupsQuery.data?.backups ?? [];
  const nextScheduled = backupsQuery.data?.nextScheduled ?? null;
  const isLoadingBackups = backupsQuery.isLoading;
  useQueryErrorToast(backupsQuery.error, "Failed to load backups");

  useEffect(() => {
    if (!settingsQuery.data) return;
    setSettings(settingsQuery.data);
    reset(mapSettingsToForm(settingsQuery.data));
  }, [settingsQuery.data, reset]);

  useQueryErrorToast(settingsQuery.error, "Failed to load settings");

  const derived = getDerivedSettings(settings);
  const {
    model,
    pipelineWebhook,
    jobCompleteWebhook,
    whatsapp,
    chat,
    envSettings,
    defaultResumeProjects,
    agent,
    backup,
    scoring,
  } = derived;

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      await api.createManualBackup();
      toast.success("Backup created successfully");
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create backup";
      toast.error(message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    const confirmed = window.confirm(
      `Delete backup "${filename}"? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setIsDeletingBackup(true);
    try {
      await api.deleteBackup(filename);
      toast.success("Backup deleted successfully");
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete backup";
      toast.error(message);
    } finally {
      setIsDeletingBackup(false);
    }
  };

  const canSave = isDirty && isValid;

  const onSave = async (data: UpdateSettingsInput) => {
    if (!settings) return;
    if (data.enableBasicAuth && !settings.basicAuthActive) {
      const password = data.basicAuthPassword?.trim() ?? "";
      if (!password) {
        setError("basicAuthPassword", {
          type: "manual",
          message: "Password is required when basic auth is enabled",
        });
        return;
      }
    }
    try {
      setIsSaving(true);

      // Prepare payload: nullify if equal to default
      const resumeProjectsData = data.resumeProjects;
      const resumeProjectsOverride =
        resumeProjectsData &&
        defaultResumeProjects &&
        resumeProjectsEqual(resumeProjectsData, defaultResumeProjects)
          ? null
          : resumeProjectsData;

      const envPayload: Partial<UpdateSettingsInput> = {};

      if (dirtyFields.adzunaAppId || dirtyFields.adzunaAppKey) {
        envPayload.adzunaAppId = normalizeString(data.adzunaAppId);
      }

      if (data.enableBasicAuth === false) {
        envPayload.basicAuthUser = null;
        envPayload.basicAuthPassword = null;
      } else if (
        dirtyFields.enableBasicAuth ||
        dirtyFields.basicAuthUser ||
        dirtyFields.basicAuthPassword
      ) {
        // If enabling basic auth or changing either field, ensure we send at least the username
        // to keep the pair consistent in the backend.
        envPayload.basicAuthUser = normalizeString(data.basicAuthUser);

        if (dirtyFields.basicAuthPassword) {
          const value = normalizePrivateInput(data.basicAuthPassword);
          if (value !== undefined) envPayload.basicAuthPassword = value;
        }
      }

      if (dirtyFields.llmProvider) {
        envPayload.llmProvider = data.llmProvider ?? null;
      }

      if (dirtyFields.llmBaseUrl) {
        envPayload.llmBaseUrl = normalizeString(data.llmBaseUrl);
      }

      if (dirtyFields.llmApiKey) {
        const value = normalizePrivateInput(data.llmApiKey);
        if (value !== undefined) envPayload.llmApiKey = value;
      }

      if (dirtyFields.embeddingProvider) {
        envPayload.embeddingProvider = normalizeString(data.embeddingProvider);
      }

      if (dirtyFields.embeddingBaseUrl) {
        envPayload.embeddingBaseUrl = normalizeString(data.embeddingBaseUrl);
      }

      if (dirtyFields.embeddingApiKey) {
        const value = normalizePrivateInput(data.embeddingApiKey);
        if (value !== undefined) envPayload.embeddingApiKey = value;
      }

      if (dirtyFields.adzunaAppKey) {
        const value = normalizePrivateInput(data.adzunaAppKey);
        if (value !== undefined) envPayload.adzunaAppKey = value;
      }

      if (dirtyFields.webhookSecret) {
        const value = normalizePrivateInput(data.webhookSecret);
        if (value !== undefined) envPayload.webhookSecret = value;
      }

      if (dirtyFields.whatsappApiKey) {
        const value = normalizePrivateInput(data.whatsappApiKey);
        if (value !== undefined) envPayload.whatsappApiKey = value;
      }

      const payload: UpdateSettingsInput = {
        model: normalizeString(data.model),
        modelScorer: normalizeString(data.modelScorer),
        modelTailoring: normalizeString(data.modelTailoring),
        modelProjectSelection: normalizeString(data.modelProjectSelection),
        agentModel: normalizeString(data.agentModel),
        agenticDiscoveryEnabled: nullIfSame(
          data.agenticDiscoveryEnabled,
          agent.discoveryEnabled.default,
        ),
        agenticFitJudgeEnabled: nullIfSame(
          data.agenticFitJudgeEnabled,
          agent.fitJudgeEnabled.default,
        ),
        agentMaxRunsPerLocalDay: nullIfSame(
          data.agentMaxRunsPerLocalDay,
          agent.maxRunsPerLocalDay.default,
        ),
        agentMaxSearchIterations: nullIfSame(
          data.agentMaxSearchIterations,
          agent.maxSearchIterations.default,
        ),
        agentMaxSearchesPerRun: nullIfSame(
          data.agentMaxSearchesPerRun,
          agent.maxSearchesPerRun.default,
        ),
        agentMaxLinkedinSearches: nullIfSame(
          data.agentMaxLinkedinSearches,
          agent.maxLinkedinSearches.default,
        ),
        agentMaxAdzunaSearches: nullIfSame(
          data.agentMaxAdzunaSearches,
          agent.maxAdzunaSearches.default,
        ),
        agentStopWhenNewBelow: nullIfSame(
          data.agentStopWhenNewBelow,
          agent.stopWhenNewBelow.default,
        ),
        agentMaxFitJudgments: nullIfSame(
          data.agentMaxFitJudgments,
          agent.maxFitJudgments.default,
        ),
        agentFitPendingTtlDays: nullIfSame(
          data.agentFitPendingTtlDays,
          agent.fitPendingTtlDays.default,
        ),
        agentMaxInputTokensPerRun: nullIfSame(
          data.agentMaxInputTokensPerRun,
          agent.maxInputTokensPerRun.default,
        ),
        agentMaxOutputTokensPerRun: nullIfSame(
          data.agentMaxOutputTokensPerRun,
          agent.maxOutputTokensPerRun.default,
        ),
        agentMaxJdChars: nullIfSame(
          data.agentMaxJdChars,
          agent.maxJdChars.default,
        ),
        agentRequestTimeoutMs: nullIfSame(
          data.agentRequestTimeoutMs,
          agent.requestTimeoutMs.default,
        ),
        companyModelRules:
          data.companyModelRules && data.companyModelRules.length > 0
            ? data.companyModelRules
            : null,
        pipelineWebhookUrl: normalizeString(data.pipelineWebhookUrl),
        jobCompleteWebhookUrl: normalizeString(data.jobCompleteWebhookUrl),
        whatsappEnabled: nullIfSame(
          data.whatsappEnabled,
          whatsapp.enabled.default,
        ),
        whatsappPhone: normalizeString(data.whatsappPhone),
        resumeProjects: resumeProjectsOverride,
        chatStyleTone: normalizeString(data.chatStyleTone),
        chatStyleFormality: normalizeString(data.chatStyleFormality),
        chatStyleConstraints: normalizeString(data.chatStyleConstraints),
        chatStyleDoNotUse: normalizeString(data.chatStyleDoNotUse),
        chatStyleLanguageMode: data.chatStyleLanguageMode ?? null,
        chatStyleManualLanguage: data.chatStyleManualLanguage ?? null,
        backupEnabled: nullIfSame(
          data.backupEnabled,
          backup.backupEnabled.default,
        ),
        backupHour: nullIfSame(data.backupHour, backup.backupHour.default),
        backupMaxCount: nullIfSame(
          data.backupMaxCount,
          backup.backupMaxCount.default,
        ),
        penalizeMissingSalary: nullIfSame(
          data.penalizeMissingSalary,
          scoring.penalizeMissingSalary.default,
        ),
        missingSalaryPenalty: nullIfSame(
          data.missingSalaryPenalty,
          scoring.missingSalaryPenalty.default,
        ),
        semanticScoreWeight: nullIfSame(
          data.semanticScoreWeight,
          scoring.semanticScoreWeight.default,
        ),
        embeddingEnabled: nullIfSame(
          data.embeddingEnabled,
          model.embeddingEnabled.default,
        ),
        embeddingMaxJobsPerRun: nullIfSame(
          data.embeddingMaxJobsPerRun,
          model.embeddingMaxJobsPerRun.default,
        ),
        embeddingMaxInputChars: nullIfSame(
          data.embeddingMaxInputChars,
          model.embeddingMaxInputChars.default,
        ),
        embeddingModel: normalizeString(data.embeddingModel),
        blockedCompanyKeywords: (() => {
          const normalized = normalizeStringArray(data.blockedCompanyKeywords);
          const normalizedDefault = normalizeStringArray(
            scoring.blockedCompanyKeywords.default,
          );
          return stringArraysEqual(normalized, normalizedDefault)
            ? null
            : normalized;
        })(),
        scoringInstructions: nullIfSame(
          normalizeString(data.scoringInstructions),
          scoring.scoringInstructions.default,
        ),
        ...envPayload,
      };

      // Remove virtual field because the backend doesn't expect it
      // this exists only to toggle the UI
      // need to track it so that the save button is enabled when it changes
      delete payload.enableBasicAuth;

      const updated = await updateSettingsMutation.mutateAsync(payload);
      setSettings(updated);
      reset(mapSettingsToForm(updated));
      toast.success("Settings saved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearDatabase = async () => {
    try {
      setIsSaving(true);
      const result = await api.clearDatabase();
      toast.success("Database cleared", {
        description: `Deleted ${result.jobsDeleted} jobs.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear database";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearByStatuses = async () => {
    if (statusesToClear.length === 0) {
      toast.error("No statuses selected");
      return;
    }
    try {
      setIsSaving(true);
      let totalDeleted = 0;
      const results: string[] = [];

      for (const status of statusesToClear) {
        const result = await api.deleteJobsByStatus(status);
        totalDeleted += result.count;
        if (result.count > 0) {
          results.push(`${result.count} ${status}`);
        }
      }

      if (totalDeleted > 0) {
        toast.success("Jobs cleared", {
          description: `Deleted ${totalDeleted} jobs: ${results.join(", ")}`,
        });
      } else {
        toast.info("No jobs found", {
          description: `No jobs with selected statuses found`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear jobs";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearByScore = async (threshold: number) => {
    try {
      setIsSaving(true);
      const result = await api.deleteJobsBelowScore(threshold);

      if (result.count > 0) {
        toast.success("Jobs cleared", {
          description: `Deleted ${result.count} jobs with score below ${threshold}. Applied jobs were preserved.`,
        });
      } else {
        toast.info("No jobs found", {
          description: `No jobs with score below ${threshold} found`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to clear jobs by score";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatusToClear = (status: JobStatus) => {
    setStatusesToClear((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );
  };
  const handleReset = async () => {
    try {
      setIsSaving(true);
      const updated = await updateSettingsMutation.mutateAsync(
        NULL_SETTINGS_PAYLOAD,
      );
      setSettings(updated);
      reset(mapSettingsToForm(updated));
      toast.success("Reset to default");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reset settings";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormProvider {...methods}>
      <PageHeader
        icon={Settings}
        title="Settings"
        subtitle="Configure runtime behavior for this app."
        actions={
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => navigate("/overview")}
            aria-label="Close settings"
            title="Close settings"
          >
            <X className="h-4 w-4" />
          </Button>
        }
      />

      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6 pb-12">
        <Accordion type="multiple" className="w-full space-y-4">
          <ModelSettingsSection
            values={model}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <AgentSettingsSection
            values={agent}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <AgentRunsSection />
          <WebhooksSection
            pipelineWebhook={pipelineWebhook}
            jobCompleteWebhook={jobCompleteWebhook}
            whatsapp={whatsapp}
            webhookSecretHint={envSettings.private.webhookSecretHint}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <LocalResumeSection isLoading={isLoading} isSaving={isSaving} />
          <ChatSettingsSection
            values={chat}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <ScoringSettingsSection
            values={scoring}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <EnvironmentSettingsSection
            values={envSettings}
            isLoading={isLoading}
            isSaving={isSaving}
          />
          <BackupSettingsSection
            values={backup}
            backups={backups}
            nextScheduled={nextScheduled}
            isLoading={isLoading || isLoadingBackups}
            isSaving={isSaving}
            onCreateBackup={handleCreateBackup}
            onDeleteBackup={handleDeleteBackup}
            isCreatingBackup={isCreatingBackup}
            isDeletingBackup={isDeletingBackup}
          />
          <DangerZoneSection
            statusesToClear={statusesToClear}
            toggleStatusToClear={toggleStatusToClear}
            handleClearByStatuses={handleClearByStatuses}
            handleClearDatabase={handleClearDatabase}
            handleClearByScore={handleClearByScore}
            isLoading={isLoading}
            isSaving={isSaving}
          />
        </Accordion>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSubmit(onSave)}
            disabled={isLoading || isSaving || !canSave}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={isLoading || isSaving || !settings}
          >
            Reset to default
          </Button>
        </div>
        {Object.keys(errors).length > 0 && (
          <div className="text-destructive text-sm mt-2">
            Please fix the errors before saving.
          </div>
        )}
      </main>
    </FormProvider>
  );
};
